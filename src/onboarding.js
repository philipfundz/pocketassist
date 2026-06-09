const { setOnboarded } = require('./database');

const onboardingFlow = async (user, message, sendMessage) => {
  const phone = user.phone;

  // If already onboarded, skip
  if (user.onboarded) return false;

  // First time user
  await sendMessage(phone, `👋 Welcome to *PocketAssist!*

I'm your personal AI-powered student assistant built for COOU students.

Here's what I can do for you:
🆓 *FREE* (9 uses/day):
- AI Q&A
- OCR (extract text from images)
- CGPA Calculator
- URL Shortener
- QR Code Generator
- File Converter
- Voice Transcriber
- Webpage Reader
- AI Smart Reply

⭐ *PREMIUM* (₦1,000/month):
- 18 powerful tools including CV Builder, Assignment Writer, Past Q Solver & more!

Your Pocket ID: *${user.pocket_id}*

Type *MENU* to see all options or just ask me anything! 🚀`);

  await setOnboarded(phone);
  return true;
};

module.exports = { onboardingFlow };