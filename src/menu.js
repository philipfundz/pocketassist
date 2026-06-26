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
*Support:* Contact us on WhatsApp
*Version:* PocketAssist v1.0 🚀`;

const getPremiumMessage = () => `⭐ *Upgrade to Premium*
━━━━━━━━━━━━━━
Unlock powerful premium tools!

💰 *Pricing*
- ₦1,000/month
- ₦5,000/year _(5 months free!)_

✅ *Premium tools include:*
- Translator
- Caption Generator
- CV Builder
- Assignment Writer
- Past Question Solver
- Social Downloader
- Watermark, E-Sign & more!

_(Monnify payment coming soon)_
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