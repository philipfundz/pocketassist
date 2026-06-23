const { setOnboarded, linkPhoneToAccount } = require('./database');

// Call this FIRST in your message router — BEFORE getOrCreateUser/checkAccess —
// so a fresh account isn't auto-created for this phone before we check for LINK.
const LINK_PATTERN = /^LINK\s+(PA-[A-Z0-9]{8})$/i;

const handleLinkCommand = async (phone, messageText, sendMessage) => {
  const match = messageText.trim().match(LINK_PATTERN);
  if (!match) return false; // not a link command — let the router continue normally

  const pocketId = match[1].toUpperCase();
  const result = await linkPhoneToAccount(phone, pocketId);

  if (!result.success) {
    if (result.reason === 'ALREADY_LINKED_HERE') {
      await sendMessage(phone, `✅ This phone is already linked to *${pocketId}*.`);
    } else {
      await sendMessage(phone, `❌ No account found with Pocket ID *${pocketId}*.\n\nDouble-check the code and try again.`);
    }
    return true; // handled (even on failure) — don't fall through to onboarding
  }

  await sendMessage(phone, `✅ *Linked successfully!*\n\nThis phone is now connected to account *${pocketId}*.\n\nPremium status, usage, and history are now shared across both numbers.\n\nType *MENU* to get started.`);
  return true;
};

const onboardingFlow = async (user, message, sendMessage) => {
  const phone = user.phone;

  if (user.onboarded) return false;

  await sendMessage(phone, `👋 Welcome to *PocketAssist!*

I'm your personal AI-powered assistant — here to save you time on everyday tasks.

🆓 *FREE* (9 uses/day):
- AI Q&A
- OCR (extract text from images)
- Calculator
- URL Shortener
- QR Code Generator
- File Converter
- Voice Transcriber
- Webpage Reader
- AI Smart Reply

⭐ *PREMIUM* (₦1,000/month):
- 18 powerful tools including CV Builder, Document Writer, Research Helper & more!

Your Pocket ID: *${user.pocket_id}*

Got another phone? Text *LINK ${user.pocket_id}* from it to connect both numbers to the same account.

Type *MENU* to see all options or just ask me anything! 🚀`);

  await setOnboarded(phone);
  return true;
};

module.exports = { onboardingFlow, handleLinkCommand };