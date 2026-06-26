const { setOnboarded, linkPhoneToAccount } = require('./database');

const LINK_PATTERN = /^LINK\s+(PA-[A-Z0-9]{8})$/i;

const handleLinkCommand = async (phone, messageText, sendMessage) => {
  const match = messageText.trim().match(LINK_PATTERN);
  if (!match) return false;

  const pocketId = match[1].toUpperCase();
  const result = await linkPhoneToAccount(phone, pocketId);

  if (!result.success) {
    if (result.reason === 'ALREADY_LINKED_HERE') {
      await sendMessage(phone, `✅ This phone is already linked to *${pocketId}*.`);
    } else {
      await sendMessage(phone, `❌ No account found with Pocket ID *${pocketId}*.\n\nDouble-check the code and try again.`);
    }
    return true;
  }

  await sendMessage(phone,
    `━━━━━━━━━━━━━━━━━━
✅ *Phone Linked*
━━━━━━━━━━━━━━━━━━

This number is now connected to account *${pocketId}*.

Premium status and daily usage are shared across all linked numbers.

Type *MENU* to get started.`
  );
  return true;
};

const onboardingFlow = async (user, message, sendMessage, sendImageUrl) => {
  const phone = user.phone;
  if (user.onboarded) return false;

  await sendImageUrl(
    phone,
    'https://res.cloudinary.com/dmldf1kno/image/upload/v1782468657/file_000000006e2071f4ba790c82ccffd6f3_qzslkz.png',
    `👋 *Welcome to PocketAssist!*

Your AI-powered utility bot — built to save you time.

🆓 *Free plan* (9 uses/day):
• AI Q&A & Smart Reply
• OCR (image → text)
• File Converter
• Voice Transcriber
• URL Shortener & QR Code
• Webpage Reader

⭐ *Premium* — ₦1,000/month:
• All 18 tools unlocked
• CV Builder, Doc Writer, Research Helper & more

Your Pocket ID: *${user.pocket_id}*
_Use this to link other phones to your account._

Type *LINK ${user.pocket_id}* from another number to connect it.

Type *MENU* to see all tools.`
  );

  await setOnboarded(phone);
  return true;
};

module.exports = { onboardingFlow, handleLinkCommand };
