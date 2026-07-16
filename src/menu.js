const getMainMenu = () => `🤖 *PocketAssist*
_Your everyday AI assistant_
━━━━━━━━━━━━━━
*1.* 🧠 AI Tools
*2.* 📁 File Tools
*3.* 🎓 Student Tools
*4.* 👤 My Account
━━━━━━━━━━━━━━
Reply with a number 👇`;

const getAIToolsMenu = () => `🧠 *AI Tools*
━━━━━━━━━━━━━━
*1.* AI Q&A — Ask me anything
*2.* AI Smart Reply
*3.* Translate text 💎
*4.* Caption Generator 💎
*5.* Plagiarism Rewriter 💎
*6.* AI Image Generator 💎
━━━━━━━━━━━━━━
💎 Premium only
*0.* 🔙 Back to Main Menu`;

const getFileToolsMenu = () => `📁 *File Tools*
━━━━━━━━━━━━━━
*1.* OCR — Extract text from image
*2.* File Converter
*3.* Voice Transcriber
*4.* URL Shortener
*5.* QR Code Generator
*6.* Web Reader
*7.* Watermark 💎
*8.* E-Sign 💎
*9.* Sticker Creator 💎
*10.* Social Downloader 💎
*11.* WhatsApp Link Generator
━━━━━━━━━━━━━━
💎 Premium only
*0.* 🔙 Back to Main Menu`;

const getStudentToolsMenu = () => `🎓 *Student Tools*
━━━━━━━━━━━━━━
*1.* CGPA Calculator
*2.* CV Builder 💎
*3.* Assignment Writer 💎
*4.* Past Question Solver 💎
*5.* Cover Letter 💎
*6.* AI Image Generator 💎
━━━━━━━━━━━━━━
💎 Premium only
*0.* 🔙 Back to Main Menu`;

const getAccountMenu = (user, remainingFree) => `👤 *My Account*
━━━━━━━━━━━━━━
🆔 Pocket ID: *${user?.pocket_id || 'N/A'}*
📊 Free uses left today: *${remainingFree}*
⭐ Status: *${user?.is_premium ? 'Premium ✅' : 'Free'}*
━━━━━━━━━━━━━━
💡 Type *PREMIUM* to upgrade
*0.* 🔙 Back to Main Menu`;

const getHelpMessage = () => `❓ *PocketAssist Help*
━━━━━━━━━━━━━━
*Quick commands:*
- *MENU* — Main menu
- *STATS* — Your usage
- *PREMIUM* — Upgrade
- *0* / *BACK* — Go back
━━━━━━━━━━━━━━
*Examples:*
- "What is photosynthesis?" → AI Q&A
- Send an image → OCR text extraction
- Send a file → File Converter
━━━━━━━━━━━━━━
*Support:*
📱 WhatsApp: +2349139958775
📧 Email: pocketassistng@gmail.com
━━━━━━━━━━━━━━
_PocketAssist v1.0_ ⚡`;

const getPremiumMessage = () => `⭐ *Upgrade to Premium*
━━━━━━━━━━━━━━
Unlock powerful premium tools!

💰 *Pricing*
- ₦1,000/month

✅ *Premium tools include:*
- Translator
- Caption Generator
- CV Builder
- Assignment Writer
- Past Question Solver
- Social Downloader
- Watermark, E-Sign & more!

👉 *Pay here:* https://paylink.monnify.com/GxouFr

⚠️ *IMPORTANT:* In the payment form's Name field, type your WhatsApp number exactly like this:
*234XXXXXXXXXX*

_(This is how we activate your premium — without it we can't match your payment automatically.)_

Takes effect within seconds of payment ✅
━━━━━━━━━━━━━━
Type *BACK* to return to menu`;

module.exports = {
  getMainMenu,
  getAIToolsMenu,
  getFileToolsMenu,
  getStudentToolsMenu,
  getAccountMenu,
  getHelpMessage,
  getPremiumMessage
};
