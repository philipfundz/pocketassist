const { sha512 } = require('js-sha512');
const supabase = require('./database'); // adjust to your actual supabase client export

const MONNIFY_CLIENT_SECRET = process.env.MONNIFY_CLIENT_SECRET; // from Monnify dashboard
const PAYLINK_URL = 'https://paylink.monnify.com/GxouFr';

// --- Verify Monnify sent this webhook, not a spoofed request ---
function verifyMonnifyHash(rawBody, receivedHash) {
  const computed = sha512.hmac(MONNIFY_CLIENT_SECRET, rawBody);
  return computed === receivedHash;
}

// --- Extract a Nigerian phone number (234XXXXXXXXXX) from free text ---
function extractPhoneNumber(text = '') {
  const match = text.match(/234\d{10}/);
  return match ? match[0] : null;
}

// --- Express route: mount this at e.g. app.post('/webhooks/monnify', ...) ---
async function handleMonnifyWebhook(req, res) {
  try {
    const rawBody = req.rawBody; // see note below re: express.json verify
    const receivedHash = req.headers['monnify-signature'];

    if (!verifyMonnifyHash(rawBody, receivedHash)) {
      console.warn('[Monnify] Invalid signature, ignoring webhook');
      return res.status(401).send('Invalid signature');
    }

    // Always 200 fast, process after — avoids Monnify retry storms
    res.status(200).send('OK');

    const { eventType, eventData } = req.body;
    if (eventType !== 'SUCCESSFUL_TRANSACTION') return;

    const {
      transactionReference,
      paymentReference,
      amountPaid,
      paymentDescription,
      customer,
    } = eventData;

    // Idempotency check — don't double-credit on retries
    const { data: existing } = await supabase
      .from('transactions')
      .select('id')
      .eq('transaction_reference', transactionReference)
      .maybeSingle();

    if (existing) {
      console.log('[Monnify] Duplicate webhook, already processed:', transactionReference);
      return;
    }

    // Try to find the phone number in whatever field they typed it into
    const phone =
      extractPhoneNumber(customer?.name) ||
      extractPhoneNumber(paymentDescription) ||
      extractPhoneNumber(customer?.email);

    // Log every transaction regardless of match, for reconciliation
    await supabase.from('transactions').insert({
      transaction_reference: transactionReference,
      payment_reference: paymentReference,
      amount: amountPaid,
      matched_phone: phone,
      raw_customer_name: customer?.name || null,
      status: phone ? 'matched' : 'unmatched',
    });

    if (!phone) {
      console.warn('[Monnify] Could not match phone number, needs manual review:', eventData);
      await notifyAdminUnmatchedPayment(eventData);
      return;
    }

    await upgradeToPremium(phone, amountPaid);
  } catch (err) {
    console.error('[Monnify webhook] Error:', err);
  }
}

// --- Upgrade user in Supabase + send WhatsApp confirmation ---
async function upgradeToPremium(phone, amountPaid) {
  const durationDays = amountPaid >= 5000 ? 365 : 30; // ₦5000/yr vs ₦1000/mo
  const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

  const { error } = await supabase
    .from('accounts')
    .update({ is_premium: true, premium_expires_at: expiresAt.toISOString() })
    .eq('phone_number', phone);

  if (error) {
    console.error('[Monnify] Failed to upgrade user:', phone, error);
    return;
  }

  const sendWhatsAppMessage = require('./whatsapp').sendMessage; // adjust to your actual sender
  await sendWhatsAppMessage(
    phone,
    `⚡ Payment confirmed! You're now Premium until ${expiresAt.toDateString()}. Enjoy all tools 🎉`
  );
}

// --- Notify yourself when a payment can't be auto-matched ---
async function notifyAdminUnmatchedPayment(eventData) {
  const sendWhatsAppMessage = require('./whatsapp').sendMessage;
  const ADMIN_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER;
  await sendWhatsAppMessage(
    ADMIN_NUMBER,
    `⚠️ Unmatched Monnify payment: ₦${eventData.amountPaid} from "${eventData.customer?.name}". Ref: ${eventData.transactionReference}`
  );
}

module.exports = { handleMonnifyWebhook, PAYLINK_URL };
  
