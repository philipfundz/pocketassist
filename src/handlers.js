const Groq = require('groq-sdk');
const { canUseTools } = require('./auth');
const { incrementDailyCount } = require('./database');
const { guardMessage } = require('./premiumGuard');
const PROMPTS = require('./prompts');
const {
  getMainMenu,
  getAIToolsMenu,
  getFileToolsMenu,
  getStudentToolsMenu,
  getAccountMenu,
  getPremiumMessage
} = require('./menu');
const {
  handleOCR,
  handleURLShortener,
  handleQRCode,
  handleVoiceTranscriber,
  handleWebpageReader,
  handleSocialDL
} = require('./fileProcessor');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// In-memory session store
const sessions = new Map();

const getSession = (phone) => sessions.get(phone) || { menu: 'main', step: null, data: {} };
const setSession = (phone, session) => sessions.set(phone, session);
const clearSession = (phone) => sessions.set(phone, { menu: 'main', step: null, data: {} });

// Groq AI call
const askGroq = async (prompt) => {
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1024,
  });
  return response.choices[0].message.content;
};

// ─── MAIN ROUTER ─────────────────────────────────────────
const handleMessage = async (phone, message, mediaUrl, mediaType, sendMessage, sendImage, sendVideo, user, access) => {
  const text = message?.trim() || '';
  const upper = text.toUpperCase();
  const session = getSession(phone);

  // Global commands
  if (upper === 'MENU' || upper === 'HI' || upper === 'HELLO' || upper === 'START') {
    clearSession(phone);
    return sendMessage(phone, getMainMenu());
  }

  if (upper === 'HELP') return sendMessage(phone, require('./menu').getHelpMessage());
  if (upper === 'PREMIUM') return sendMessage(phone, getPremiumMessage());

  if (upper === 'STATS') {
    return sendMessage(phone, getAccountMenu(user, access.remainingFree));
  }

  // Back button
  if (upper === '0' || upper === 'BACK') {
    if (session.menu === 'main') {
      return sendMessage(phone, getMainMenu());
    }
    clearSession(phone);
    return sendMessage(phone, getMainMenu());
  }

  // ─── MAIN MENU ───────────────────────────────────────
  if (session.menu === 'main') {
    if (text === '1') { setSession(phone, { menu: 'ai', step: null, data: {} }); return sendMessage(phone, getAIToolsMenu()); }
    if (text === '2') { setSession(phone, { menu: 'file', step: null, data: {} }); return sendMessage(phone, getFileToolsMenu()); }
    if (text === '3') { setSession(phone, { menu: 'student', step: null, data: {} }); return sendMessage(phone, getStudentToolsMenu()); }
    if (text === '4') { return sendMessage(phone, getAccountMenu(user, access.remainingFree)); }
  }

  // ─── AI TOOLS SUBMENU ────────────────────────────────
  if (session.menu === 'ai') {
    // AI Q&A
    if (text === '1' && !session.step) {
      setSession(phone, { menu: 'ai', step: 'aiqa', data: {} });
      return sendMessage(phone, '🧠 *AI Q&A*\n\nAsk me anything! Type your question:');
    }
    if (session.step === 'aiqa') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      const block = guardMessage(acc, false);
      if (!allowed) return sendMessage(phone, block);
      await sendMessage(phone, '🤔 Thinking...');
      const answer = await askGroq(PROMPTS.aiQA(text));
      await incrementDailyCount(phone);
      clearSession(phone);
      return sendMessage(phone, `💡 *Answer:*\n\n${answer}\n\n_${acc.remainingFree - 1} free uses left today_\n\nType *MENU* to return`);
    }

    // Smart Reply
    if (text === '2' && !session.step) {
      setSession(phone, { menu: 'ai', step: 'smartreply', data: {} });
      return sendMessage(phone, '✍️ *AI Smart Reply*\n\nPaste the message you want to reply to:');
    }
    if (session.step === 'smartreply') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      const block = guardMessage(acc, false);
      if (!allowed) return sendMessage(phone, block);
      await sendMessage(phone, '✍️ Generating replies...');
      const replies = await askGroq(PROMPTS.smartReply(text));
      await incrementDailyCount(phone);
      clearSession(phone);
      return sendMessage(phone, `💬 *Smart Reply Options:*\n\n${replies}\n\n_${acc.remainingFree - 1} free uses left today_\n\nType *MENU* to return`);
    }

    // Translator (Premium)
    if (text === '3' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      const block = guardMessage(acc, true);
      if (!allowed) return sendMessage(phone, block);
      setSession(phone, { menu: 'ai', step: 'translate_text', data: {} });
      return sendMessage(phone, '🌍 *Translator*\n\nEnter text and target language:\nFormat: *text | language*\nExample: _Hello | Igbo_');
    }
    if (session.step === 'translate_text') {
      const parts = text.split('|');
      if (parts.length < 2) return sendMessage(phone, '❌ Wrong format. Use: *text | language*\nExample: _Hello | Yoruba_');
      await sendMessage(phone, '🌍 Translating...');
      const translated = await askGroq(PROMPTS.translator(parts[0].trim(), parts[1].trim()));
      await incrementDailyCount(phone);
      clearSession(phone);
      return sendMessage(phone, `🌍 *Translation:*\n\n${translated}\n\nType *MENU* to return`);
    }

    // Caption Generator (Premium)
    if (text === '4' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      const block = guardMessage(acc, true);
      if (!allowed) return sendMessage(phone, block);
      setSession(phone, { menu: 'ai', step: 'caption', data: {} });
      return sendMessage(phone, '📱 *Caption Generator*\n\nDescribe your post and platform:\nFormat: *description | platform*\nExample: _Sunset photo | Instagram_');
    }
    if (session.step === 'caption') {
      const parts = text.split('|');
      if (parts.length < 2) return sendMessage(phone, '❌ Wrong format. Use: *description | platform*');
      await sendMessage(phone, '✨ Generating captions...');
      const captions = await askGroq(PROMPTS.captionGen(parts[0].trim(), parts[1].trim()));
      await incrementDailyCount(phone);
      clearSession(phone);
      return sendMessage(phone, `📱 *Captions:*\n\n${captions}\n\nType *MENU* to return`);
    }

    // Plagiarism Rewriter (Premium)
    if (text === '5' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      const block = guardMessage(acc, true);
      if (!allowed) return sendMessage(phone, block);
      setSession(phone, { menu: 'ai', step: 'rewrite', data: {} });
      return sendMessage(phone, '🔄 *Plagiarism Rewriter*\n\nPaste the text you want rewritten:');
    }
    if (session.step === 'rewrite') {
      await sendMessage(phone, '🔄 Rewriting...');
      const rewritten = await askGroq(PROMPTS.plagiarismRewriter(text));
      await incrementDailyCount(phone);
      clearSession(phone);
      return sendMessage(phone, `✅ *Rewritten:*\n\n${rewritten}\n\nType *MENU* to return`);
    }
  }

  // ─── FILE TOOLS SUBMENU ──────────────────────────────
  if (session.menu === 'file') {
    // OCR
    if (text === '1' && !session.step) {
      setSession(phone, { menu: 'file', step: 'ocr', data: {} });
      return sendMessage(phone, '🔍 *OCR — Extract Text*\n\nSend me an image and I\'ll extract the text from it:');
    }
    if (session.step === 'ocr' && mediaUrl && mediaType?.includes('image')) {
      const { allowed, access: acc } = await canUseTools(phone, false);
      const block = guardMessage(acc, false);
      if (!allowed) return sendMessage(phone, block);
      await incrementDailyCount(phone);
      clearSession(phone);
      return handleOCR(phone, mediaUrl, sendMessage);
    }

    // URL Shortener
    if (text === '4' && !session.step) {
      setSession(phone, { menu: 'file', step: 'url', data: {} });
      return sendMessage(phone, '🔗 *URL Shortener*\n\nPaste the link you want to shorten:');
    }
    if (session.step === 'url') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      const block = guardMessage(acc, false);
      if (!allowed) return sendMessage(phone, block);
      await incrementDailyCount(phone);
      clearSession(phone);
      return handleURLShortener(phone, text, sendMessage);
    }

    // QR Code
    if (text === '5' && !session.step) {
      setSession(phone, { menu: 'file', step: 'qr', data: {} });
      return sendMessage(phone, '📱 *QR Code Generator*\n\nEnter the text or link for your QR code:');
    }
    if (session.step === 'qr') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      const block = guardMessage(acc, false);
      if (!allowed) return sendMessage(phone, block);
      await incrementDailyCount(phone);
      clearSession(phone);
      return handleQRCode(phone, text, sendMessage, sendImage);
    }

    // Web Reader
    if (text === '6' && !session.step) {
      setSession(phone, { menu: 'file', step: 'web', data: {} });
      return sendMessage(phone, '🌐 *Webpage Reader*\n\nPaste the URL you want me to read and summarize:');
    }
    if (session.step === 'web') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      const block = guardMessage(acc, false);
      if (!allowed) return sendMessage(phone, block);
      await incrementDailyCount(phone);
      clearSession(phone);
      return handleWebpageReader(phone, text, sendMessage);
    }

    // Voice Transcriber
    if (text === '3' && !session.step) {
      setSession(phone, { menu: 'file', step: 'voice', data: {} });
      return sendMessage(phone, '🎙️ *Voice Transcriber*\n\nSend me a voice message and I\'ll transcribe it:');
    }
    if (session.step === 'voice' && mediaUrl && mediaType?.includes('audio')) {
      const { allowed, access: acc } = await canUseTools(phone, false);
      const block = guardMessage(acc, false);
      if (!allowed) return sendMessage(phone, block);
      await incrementDailyCount(phone);
      clearSession(phone);
      return handleVoiceTranscriber(phone, mediaUrl, sendMessage);
    }

    // Social Downloader (Premium)
    if (text === '11' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      const block = guardMessage(acc, true);
      if (!allowed) return sendMessage(phone, block);
      setSession(phone, { menu: 'file', step: 'socialdl', data: {} });
      return sendMessage(phone, '⬇️ *Social Downloader*\n\nPaste the video link:\nSupports: YouTube Shorts, TikTok, Instagram, Twitter/X, Facebook\n_(Max 5 min / 15MB)_');
    }
    if (session.step === 'socialdl') {
      clearSession(phone);
      return handleSocialDL(phone, text, sendMessage, sendVideo);
    }
  }

  // ─── STUDENT TOOLS SUBMENU ───────────────────────────
  if (session.menu === 'student') {
    // CGPA Calculator
    if (text === '1' && !session.step) {
      setSession(phone, { menu: 'student', step: 'cgpa', data: { courses: [] } });
      return sendMessage(phone, `📊 *CGPA Calculator*\n\nEnter courses one per line:\nFormat: *CourseCode Grade Units*\nExample: _MTH101 A 3_\n\nType *DONE* when finished.`);
    }
    if (session.step === 'cgpa') {
      if (upper === 'DONE') {
        const courses = session.data.courses;
        if (!courses.length) return sendMessage(phone, '❌ No courses entered. Send at least one course.');
        const gradePoints = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };
        let totalPoints = 0, totalUnits = 0;
        courses.forEach(c => {
          totalPoints += (gradePoints[c.grade.toUpperCase()] || 0) * c.units;
          totalUnits += c.units;
        });
        const cgpa = totalUnits > 0 ? (totalPoints / totalUnits).toFixed(2) : 0;
        const classification = cgpa >= 4.5 ? 'First Class 🏆' : cgpa >= 3.5 ? 'Second Class Upper 🥈' : cgpa >= 2.5 ? 'Second Class Lower 🥉' : cgpa >= 1.5 ? 'Third Class' : 'Pass/Fail';
        const { allowed, access: acc } = await canUseTools(phone, false);
        const block = guardMessage(acc, false);
        if (!allowed) return sendMessage(phone, block);
        await incrementDailyCount(phone);
        clearSession(phone);
        return sendMessage(phone, `📊 *CGPA Result*\n\nCourses: ${courses.length}\nTotal Units: ${totalUnits}\n\n🎓 *CGPA: ${cgpa}*\n🏅 *${classification}*\n\n_${acc.remainingFree - 1} free uses left today_\n\nType *MENU* to return`);
      }
      const parts = text.trim().split(/\s+/);
      if (parts.length >= 3) {
        const course = { code: parts[0], grade: parts[1], units: parseInt(parts[2]) };
        session.data.courses.push(course);
        setSession(phone, session);
        return sendMessage(phone, `✅ Added: ${course.code} (${course.grade}, ${course.units} units)\nTotal so far: ${session.data.courses.length} course(s)\n\nContinue adding or type *DONE*`);
      }
      return sendMessage(phone, `❌ Wrong format. Use:\n*CourseCode Grade Units*\nExample: _MTH101 A 3_`);
    }

    // CV Builder (Premium)
    if (text === '2' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      const block = guardMessage(acc, true);
      if (!allowed) return sendMessage(phone, block);
      setSession(phone, { menu: 'student', step: 'cv', data: {} });
      return sendMessage(phone, '📋 *CV Builder*\n\nSend your details in this format:\n\n*Name:*\n*Email:*\n*Phone:*\n*Education:*\n*Skills:*\n*Experience:*\n*Objective:*');
    }
    if (session.step === 'cv') {
      await sendMessage(phone, '📋 Building your CV...');
      const cv = await askGroq(PROMPTS.cvBuilder(text));
      await incrementDailyCount(phone);
      clearSession(phone);
      return sendMessage(phone, `📄 *Your CV:*\n\n${cv}\n\nType *MENU* to return`);
    }

    // Assignment Writer (Premium)
    if (text === '3' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      const block = guardMessage(acc, true);
      if (!allowed) return sendMessage(phone, block);
      setSession(phone, { menu: 'student', step: 'assign_topic', data: {} });
      return sendMessage(phone, '📝 *Assignment Writer*\n\nWhat is the topic of your assignment?');
    }
    if (session.step === 'assign_topic') {
      setSession(phone, { menu: 'student', step: 'assign_details', data: { topic: text } });
      return sendMessage(phone, `📝 Topic: *${text}*\n\nAny specific instructions or details? (or type *SKIP*):`);
    }
    if (session.step === 'assign_details') {
      const details = upper === 'SKIP' ? 'No additional details' : text;
      await sendMessage(phone, '📝 Writing your assignment...');
      const assignment = await askGroq(PROMPTS.assignmentWriter(session.data.topic, details));
      await incrementDailyCount(phone);
      clearSession(phone);
      return sendMessage(phone, `📄 *Assignment:*\n\n${assignment}\n\nType *MENU* to return`);
    }

    // Past Question Solver (Premium)
    if (text === '4' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      const block = guardMessage(acc, true);
      if (!allowed) return sendMessage(phone, block);
      setSession(phone, { menu: 'student', step: 'pastq_course', data: {} });
      return sendMessage(phone, '📚 *Past Question Solver*\n\nWhat course is this question from?');
    }
    if (session.step === 'pastq_course') {
      setSession(phone, { menu: 'student', step: 'pastq_question', data: { course: text } });
      return sendMessage(phone, `📚 Course: *${text}*\n\nNow paste your question:`);
    }
    if (session.step === 'pastq_question') {
      await sendMessage(phone, '📚 Solving...');
      const solution = await askGroq(PROMPTS.pastQSolver(text, session.data.course));
      await incrementDailyCount(phone);
      clearSession(phone);
      return sendMessage(phone, `📚 *Solution:*\n\n${solution}\n\nType *MENU* to return`);
    }

    // Cover Letter (Premium)
    if (text === '5' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      const block = guardMessage(acc, true);
      if (!allowed) return sendMessage(phone, block);
      setSession(phone, { menu: 'student', step: 'cover', data: {} });
      return sendMessage(phone, '📨 *Cover Letter*\n\nSend your details:\nFormat: *Name | Position | Company | Skills*\nExample: _Philip | Software Intern | Google | Python, Node.js_');
    }
    if (session.step === 'cover') {
      const parts = text.split('|');
      if (parts.length < 4) return sendMessage(phone, '❌ Wrong format. Use:\n*Name | Position | Company | Skills*');
      await sendMessage(phone, '📨 Writing your cover letter...');
      const letter = await askGroq(PROMPTS.coverLetter(parts[0].trim(), parts[1].trim(), parts[2].trim(), parts[3].trim()));
      await incrementDailyCount(phone);
      clearSession(phone);
      return sendMessage(phone, `📄 *Cover Letter:*\n\n${letter}\n\nType *MENU* to return`);
    }
  }

  // ─── FALLBACK ────────────────────────────────────────
  return sendMessage(phone, `🤖 I didn't understand that.\n\nType *MENU* to see all options or *HELP* for guidance.`);
};

module.exports = { handleMessage };