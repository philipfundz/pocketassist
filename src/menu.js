const getMainMenu = () => `🤖 *PocketAssist*
_Your everyday AI assistant_
━━━━━━━━━━━━━━
1️⃣ 🧠 AI Tools
2️⃣ 📁 File Tools
3️⃣ 🎓 Student Tools
4️⃣ 👤 My Account
Reply a number 👇`;

const getAIToolsMenu = () => `🧠 *AI Tools*
━━━━━━━━━━━━━━
1️⃣ AI Q&A — Ask me anything
2️⃣ AI Smart Reply
3️⃣ Translate text 💎
4️⃣ Caption Generator 💎
5️⃣ Plagiarism Rewriter 💎
💎 = Premium only
0️⃣ Back to Main Menu`;

const getFileToolsMenu = () => `📁 *File Tools*
━━━━━━━━━━━━━━
1️⃣ OCR — Extract text from image
2️⃣ File Converter
3️⃣ Voice Transcriber
4️⃣ URL Shortener
5️⃣ QR Code Generator
6️⃣ Web Reader
7️⃣ Watermark 💎
8️⃣ E-Sign 💎
9️⃣ Sticker Creator 💎
🔟 Social Downloader 💎
1️⃣1️⃣ WhatsApp Link Generator
💎 = Premium only
0️⃣ Back to Main Menu`;

const getStudentToolsMenu = () => `🎓 *Student Tools*
━━━━━━━━━━━━━━
1️⃣ CGPA Calculator
2️⃣ CV Builder 💎
3️⃣ Assignment Writer 💎
4️⃣ Past Question Solver 💎
5️⃣ Cover Letter 💎
💎 = Premium only
0️⃣ Back to Main Menu`;

const getAccountMenu = (user, remainingFree) => `👤 *My Account*
━━━━━━━━━━━━━━
🆔 Pocket ID: *${user?.pocket_id || 'N/A'}*
📊 Free uses left today: *${remainingFree}*
⭐ Status: *${user?.is_premium ? 'Premium ✅' : 'Free'}*
💡 Type *PREMIUM* to upgrade
0️⃣ Back to Main Menu`;

const getHelpMessage = () => `❓ *PocketAssist Help*
━━━━━━━━━━━━━━
*Quick commands:*
- *MENU* — Main menu
- *STATS* — Your usage
- *PREMIUM* — Upgrade
- *0* or *BACK* — Go back

*Examples:*
- "What is photosynthesis?" → AI Q&A
- Send image → OCR text extraction
- Send file → File Converter

*Support:* Contact us on WhatsApp
*Version:* PocketAssist v1.0 🚀`;

const getPremiumMessage = () => `⭐ *Upgrade to Premium*
━━━━━━━━━━━━━━
Unlock powerful premium tools!

💰 *Pricing:*
- ₦1,000/month
- ₦5,000/year *(5 months free!)*

*Premium tools include:*
✅ Translator
✅ Caption Generator
✅ CV Builder
✅ Assignment Writer
✅ Past Question Solver
✅ Social Downloader
✅ Watermark, E-Sign & more!

_(Monnify payment coming soon)_
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