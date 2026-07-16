const { sha512 } = require('js-sha512');
const { supabase } = require('./database');
const MONNIFY_CLIENT_SECRET = process.env.MONNIFY_CLIENT_SECRET;

// --- Verify Monnify actually sent this webhook ---
function verifyMonnifyHash(rawBody, receivedHash) {
  const computed = sha512.hmac(MONNIFY_CLIENT_SECRET, rawBody);
  return computed === receivedHash;
}

// --- Extract a Nigerian phone number (234XXXXXXXXXX) from free text ---
function extractPhoneNumber(text = '') {
  const match = text.match(/234\d{10}/);
  return match ? match[0] : null;
}

// --- Factory: pass in your index.js sendMessage so this route can notify users ---
function createMonnifyWebhookHandler(sendMessage) {
  return async function handleMonnifyWebhook(req, res) {
    try {
      const rawBody = req.rawBody;
      const receivedHash = req.headers['monnify-signature'];

      if (!verifyMonnifyHash(rawBody, receivedHash)) {
        console.warn('[Monnify] Invalid signature, ignoring webhook');
        return res.status(401).send('Invalid signature');
      }

      // Respond fast, process after — avoids Monnify retry storms
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

      // Idempotency check — don't double-credit on webhook retries
      const { data: existing } = await supabase
        .from('transactions')
        .select('id')
        .eq('transaction_reference', transactionReference)
        .maybeSingle();

      if (existing) {
        console.log('[Monnify] Duplicate webhook, already processed:', transactionReference);
        return;
      }

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
        console.warn('[Monnify] Could not match phone number:', eventData);
        await notifyAdminUnmatchedPayment(sendMessage, eventData);
        return;
      }

      await upgradeToPremium(sendMessage, phone, amountPaid);
    } catch (err) {
      console.error('[Monnify webhook] Error:', err);
    }
  };
}

// --- Look up account via linked_phones, activate subscription, flag premium ---
async function upgradeToPremium(sendMessage, phone, amountPaid) {
  const { data: linkedPhone, error: lookupErr } = await supabase
    .from('linked_phones')
    .select('account_id')
    .eq('phone', phone)
    .maybeSingle();

  if (lookupErr || !linkedPhone) {
    console.warn('[Monnify] Phone not found in linked_phones:', phone);
    await notifyAdminUnmatchedPayment(sendMessage, { amountPaid, customer: { name: phone } });
    return;
  }

  const plan = amountPaid >= 5000 ? 'yearly' : 'monthly';
  const durationDays = plan === 'yearly' ? 365 : 30;
  const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

  // Record the subscription
  await supabase.from('subscriptions').insert({
    phone,
    plan,
    amount: amountPaid,
    status: 'active',
    expires_at: expiresAt.toISOString(),
  });

  // Flip the account to premium
  const { error: updateErr } = await supabase
    .from('accounts')
    .update({ is_premium: true })
    .eq('id', linkedPhone.account_id);

  if (updateErr) {
    console.error('[Monnify] Failed to set is_premium:', updateErr);
    return;
  }

  await sendMessage(
    phone,
    `⚡ Payment confirmed! You're now Premium until ${expiresAt.toDateString()}. Enjoy all tools 🎉`
  );
}

// --- Notify admin when a payment can't be auto-matched to a user ---
async function notifyAdminUnmatchedPayment(sendMessage, eventData) {
  const ADMIN_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER;
  if (!ADMIN_NUMBER) return;
  await sendMessage(
    ADMIN_NUMBER,
    `⚠️ Unmatched Monnify payment: ₦${eventData.amountPaid} from "${eventData.customer?.name}". Check transactions table.`
  );
}

module.exports = { createMonnifyWebhookHandler };
    
