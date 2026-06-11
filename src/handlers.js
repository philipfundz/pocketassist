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
  handleSocialDL,
  handleFileConvert,
  handleWatermark,
  handleESign,
  handleStickerCreator,
} = require('./fileProcessor');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── SESSION STORE ────────────────────────────────────────────────────────────
const sessions = new Map();

const getSession = (phone) => sessions.get(phone) || { menu: 'main', step: null, data: {} };
const setSession = (phone, session) => sessions.set(phone, session);
const clearSession = (phone) => sessions.set(phone, { menu: 'main', step: null, data: {} });
const resetToSubmenu = (phone, menu) => sessions.set(phone, { menu, step: null, data: {} });

const getSubmenuMessage = (menu) => {
  if (menu === 'ai') return getAIToolsMenu();
  if (menu === 'file') return getFileToolsMenu();
  if (menu === 'student') return getStudentToolsMenu();
  return getMainMenu();
};

// ─── GROQ AI CALL ─────────────────────────────────────────────────────────────
const askGroq = async (prompt) => {
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1024,
  });
  return response.choices[0].message.content;
};

// ─── MAIN ROUTER ──────────────────────────────────────────────────────────────
const handleMessage = async (phone, message, mediaUrl, mediaType, sendMessage, sendImage, sendVideo, sendDocument, sendSticker, user, access) => {
  const text = message?.trim() || '';
  const upper = text.toUpperCase();
  const session = getSession(phone);

  // ── Global commands ──────────────────────────────────────────────────────
  if (upper === 'MENU' || upper === 'HI' || upper === 'HELLO' || upper === 'START') {
    clearSession(phone);
    return sendMessage(phone, getMainMenu());
  }

  if (upper === 'HELP') return sendMessage(phone, require('./menu').getHelpMessage());
  if (upper === 'PREMIUM') return sendMessage(phone, getPremiumMessage());
  if (upper === 'STATS') return sendMessage(phone, getAccountMenu(user, access.remainingFree));

  // ── Back / 0 ─────────────────────────────────────────────────────────────
  if (upper === '0' || upper === 'BACK') {
    if (session.step) {
      resetToSubmenu(phone, session.menu);
      return sendMessage(phone, getSubmenuMessage(session.menu));
    }
    clearSession(phone);
    return sendMessage(phone, getMainMenu());
  }

  // ─── MAIN MENU ────────────────────────────────────────────────────────────
  if (session.menu === 'main') {
    if (text === '1') { setSession(phone, { menu: 'ai',      step: null, data: {} }); return sendMessage(phone, getAIToolsMenu()); }
    if (text === '2') { setSession(phone, { menu: 'file',    step: null, data: {} }); return sendMessage(phone, getFileToolsMenu()); }
    if (text === '3') { setSession(phone, { menu: 'student', step: null, data: {} }); return sendMessage(phone, getStudentToolsMenu()); }
    if (text === '4') { return sendMessage(phone, getAccountMenu(user, access.remainingFree)); }
  }

  // ─── AI TOOLS ─────────────────────────────────────────────────────────────
  if (session.menu === 'ai') {

    // 1 ── AI Q&A (Free)
    if (text === '1' && !session.step) {
      setSession(phone, { menu: 'ai', step: 'aiqa', data: {} });
      return sendMessage(phone, '🧠 *AI Q&A*\n\nAsk me anything! Type your question:');
    }
    if (session.step === 'aiqa') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      if (!allowed) return sendMessage(phone, guardMessage(acc, false));
      await sendMessage(phone, '🤔 Thinking...');
      const answer = await askGroq(PROMPTS.aiQA(text));
      await incrementDailyCount(phone);
      return sendMessage(phone, `💡 *Answer:*\n\n${answer}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n─────────────────\nAsk another question or type *0* to go back`);
    }

    // 2 ── Smart Reply (Free)
    if (text === '2' && !session.step) {
      setSession(phone, { menu: 'ai', step: 'smartreply', data: {} });
      return sendMessage(phone, '✍️ *AI Smart Reply*\n\nPaste the message you want to reply to:');
    }
    if (session.step === 'smartreply') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      if (!allowed) return sendMessage(phone, guardMessage(acc, false));
      await sendMessage(phone, '✍️ Generating replies...');
      const replies = await askGroq(PROMPTS.smartReply(text));
      await incrementDailyCount(phone);
      return sendMessage(phone, `💬 *Smart Reply Options:*\n\n${replies}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n─────────────────\nPaste another message or type *0* to go back`);
    }

    // 3 ── Translator (Premium) — natural 2-step flow
    if (text === '3' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      setSession(phone, { menu: 'ai', step: 'translate_text', data: {} });
      return sendMessage(phone, '🌍 *Translator*\n\nWhat text do you want to translate?\n\nType it below:');
    }
    if (session.step === 'translate_text') {
      setSession(phone, { menu: 'ai', step: 'translate_lang', data: { text } });
      return sendMessage(phone, `📝 Got it!\n\n_"${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"_\n\nWhat language should I translate it to?\n(e.g. Igbo, Yoruba, French, Arabic)`);
    }
    if (session.step === 'translate_lang') {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await sendMessage(phone, '🌍 Translating...');
      const translated = await askGroq(PROMPTS.translator(session.data.text, text));
      await incrementDailyCount(phone);
      resetToSubmenu(phone, 'ai');
      return sendMessage(phone, `🌍 *Translation (${text}):*\n\n${translated}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n─────────────────\nType *3* to translate another or *0* to go back`);
    }

    // 4 ── Caption Generator (Premium) — natural 2-step flow
    if (text === '4' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      setSession(phone, { menu: 'ai', step: 'caption_desc', data: {} });
      return sendMessage(phone, '📱 *Caption Generator*\n\nDescribe your post or photo:\n(e.g. _Sunset at the beach with friends_)');
    }
    if (session.step === 'caption_desc') {
      setSession(phone, { menu: 'ai', step: 'caption_platform', data: { description: text } });
      return sendMessage(phone, `✅ Got it!\n\n_"${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"_\n\nWhich platform is this for?\n(e.g. Instagram, TikTok, Twitter, Facebook, LinkedIn)`);
    }
    if (session.step === 'caption_platform') {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await sendMessage(phone, '✨ Generating captions...');
      const captions = await askGroq(PROMPTS.captionGen(session.data.description, text));
      await incrementDailyCount(phone);
      resetToSubmenu(phone, 'ai');
      return sendMessage(phone, `📱 *Captions for ${text}:*\n\n${captions}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n─────────────────\nType *4* to generate more or *0* to go back`);
    }

    // 5 ── Plagiarism Rewriter (Premium)
    if (text === '5' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      setSession(phone, { menu: 'ai', step: 'rewrite', data: {} });
      return sendMessage(phone, '🔄 *Plagiarism Rewriter*\n\nPaste the text you want rewritten:\n_(Tip: one paragraph at a time works best)_');
    }
    if (session.step === 'rewrite') {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await sendMessage(phone, '🔄 Rewriting your text...\n\n_This may take a few seconds ⏳_');
      try {
        const rewritten = await Promise.race([
          askGroq(PROMPTS.plagiarismRewriter(text)),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000))
        ]);
        await incrementDailyCount(phone);
        return sendMessage(phone, `✅ *Rewritten:*\n\n${rewritten}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n─────────────────\nPaste another passage or type *0* to go back`);
      } catch (err) {
        if (err.message === 'timeout') {
          return sendMessage(phone, '⏱️ This is taking longer than expected.\n\nTry sending a *shorter passage* (one paragraph at a time).\n\nPaste a shorter text or type *0* to go back.');
        }
        return sendMessage(phone, '❌ Rewrite failed. Please try again.\n\nType *0* to go back.');
      }
    }
  }

  // ─── FILE TOOLS ───────────────────────────────────────────────────────────
  if (session.menu === 'file') {

    // 1 ── OCR (Free)
    if (text === '1' && !session.step) {
      setSession(phone, { menu: 'file', step: 'ocr', data: {} });
      return sendMessage(phone, '🔍 *OCR — Extract Text*\n\nSend me an image and I\'ll extract the text from it:');
    }
    if (session.step === 'ocr') {
      if (!mediaUrl || !mediaType?.includes('image')) {
        return sendMessage(phone, '📷 Please send an *image* for OCR extraction.');
      }
      const { allowed, access: acc } = await canUseTools(phone, false);
      if (!allowed) return sendMessage(phone, guardMessage(acc, false));
      await incrementDailyCount(phone);
      await handleOCR(phone, mediaUrl, sendMessage);
      return;
    }

    // 2 ── File Convert (Free)
    if (text === '2' && !session.step) {
      setSession(phone, { menu: 'file', step: 'convert_file', data: {} });
      return sendMessage(phone, `🔄 *File Converter*\n\nSend me the file you want to convert.\n\n*Supported formats:*\nPDF, Word (DOCX), PowerPoint (PPTX), Excel (XLSX), JPG, PNG, WEBP\n\n_Send your file now:_`);
    }
    if (session.step === 'convert_file') {
      if (!mediaUrl) {
        return sendMessage(phone, '📎 Please send a *file* to convert.');
      }
      setSession(phone, { menu: 'file', step: 'convert_format', data: { mediaUrl, mediaType } });
      return sendMessage(phone, `✅ File received!\n\nWhat format do you want to convert it to?\n\nExamples: *PDF, DOCX, JPG, PNG, XLSX*\n\nType the format name:`);
    }
    if (session.step === 'convert_format') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      if (!allowed) return sendMessage(phone, guardMessage(acc, false));
      await incrementDailyCount(phone);
      await handleFileConvert(phone, session.data.mediaUrl, session.data.mediaType, text.toLowerCase(), sendMessage, sendDocument);
      resetToSubmenu(phone, 'file');
      return;
    }

    // 3 ── Voice Transcriber (Free)
    if (text === '3' && !session.step) {
      setSession(phone, { menu: 'file', step: 'voice', data: {} });
      return sendMessage(phone, '🎙️ *Voice Transcriber*\n\nSend me a voice message and I\'ll transcribe it:');
    }
    if (session.step === 'voice') {
      if (!mediaUrl || !mediaType?.includes('audio')) {
        return sendMessage(phone, '🎙️ Please send a *voice message* to transcribe.');
      }
      const { allowed, access: acc } = await canUseTools(phone, false);
      if (!allowed) return sendMessage(phone, guardMessage(acc, false));
      await incrementDailyCount(phone);
      await handleVoiceTranscriber(phone, mediaUrl, sendMessage);
      return sendMessage(phone, '─────────────────\nSend another voice message or type *0* to go back');
    }

    // 4 ── URL Shortener (Free)
    if (text === '4' && !session.step) {
      setSession(phone, { menu: 'file', step: 'url', data: {} });
      return sendMessage(phone, '🔗 *URL Shortener*\n\nPaste the link you want to shorten:');
    }
    if (session.step === 'url') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      if (!allowed) return sendMessage(phone, guardMessage(acc, false));
      await incrementDailyCount(phone);
      await handleURLShortener(phone, text, sendMessage);
      return sendMessage(phone, '─────────────────\nPaste another link or type *0* to go back');
    }

    // 5 ── QR Code (Free)
    if (text === '5' && !session.step) {
      setSession(phone, { menu: 'file', step: 'qr', data: {} });
      return sendMessage(phone, '📱 *QR Code Generator*\n\nEnter the text or link for your QR code:');
    }
    if (session.step === 'qr') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      if (!allowed) return sendMessage(phone, guardMessage(acc, false));
      await incrementDailyCount(phone);
      await handleQRCode(phone, text, sendMessage, sendImage);
      return;
    }

    // 6 ── Web Reader (Free)
    if (text === '6' && !session.step) {
      setSession(phone, { menu: 'file', step: 'web', data: {} });
      return sendMessage(phone, '🌐 *Webpage Reader*\n\nPaste the URL you want me to read and summarize:');
    }
    if (session.step === 'web') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      if (!allowed) return sendMessage(phone, guardMessage(acc, false));
      await incrementDailyCount(phone);
      await handleWebpageReader(phone, text, sendMessage);
      return sendMessage(phone, '─────────────────\nPaste another URL or type *0* to go back');
    }

    // 7 ── Watermark (Premium)
    if (text === '7' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      setSession(phone, { menu: 'file', step: 'watermark', data: {} });
      return sendMessage(phone, '🖼️ *Watermark*\n\nSend me an image or PDF and I\'ll add a *PocketAssist_Bot* watermark to it:');
    }
    if (session.step === 'watermark') {
      if (!mediaUrl) {
        return sendMessage(phone, '📎 Please send an *image* or *PDF* to watermark.');
      }
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await incrementDailyCount(phone);
      await handleWatermark(phone, mediaUrl, mediaType, sendMessage, sendImage, sendDocument);
      resetToSubmenu(phone, 'file');
      return;
    }

    // 8 ── E-Sign (Premium)
    if (text === '8' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      setSession(phone, { menu: 'file', step: 'esign_pdf', data: {} });
      return sendMessage(phone, '✍️ *E-Sign*\n\nFirst, send me the *PDF* you want to sign:');
    }
    if (session.step === 'esign_pdf') {
      if (!mediaUrl || !mediaType?.includes('pdf')) {
        return sendMessage(phone, '📄 Please send a *PDF* file to sign.');
      }
      setSession(phone, { menu: 'file', step: 'esign_sig', data: { pdfUrl: mediaUrl } });
      return sendMessage(phone, '✅ PDF received!\n\nNow send me your *signature image*:\n_(Take a photo of your signature on white paper)_');
    }
    if (session.step === 'esign_sig') {
      if (!mediaUrl || !mediaType?.includes('image')) {
        return sendMessage(phone, '🖊️ Please send an *image* of your signature.');
      }
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await incrementDailyCount(phone);
      await handleESign(phone, session.data.pdfUrl, mediaUrl, sendMessage, sendDocument);
      resetToSubmenu(phone, 'file');
      return;
    }

    // 9 ── Sticker Creator (Premium)
    if (text === '9' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      setSession(phone, { menu: 'file', step: 'sticker', data: {} });
      return sendMessage(phone, '🎨 *Sticker Creator*\n\nSend me an image and I\'ll convert it to a WhatsApp sticker:');
    }
    if (session.step === 'sticker') {
      if (!mediaUrl || !mediaType?.includes('image')) {
        return sendMessage(phone, '🖼️ Please send an *image* to convert to a sticker.');
      }
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await incrementDailyCount(phone);
      await handleStickerCreator(phone, mediaUrl, sendMessage, sendSticker, sendImage);
      return;
    }

    // 10 ── Social Downloader (Premium)
    if (text === '10' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      setSession(phone, { menu: 'file', step: 'socialdl', data: {} });
      return sendMessage(phone, '⬇️ *Social Downloader*\n\nPaste the video link:\nSupports: YouTube Shorts, TikTok, Instagram, Twitter/X, Facebook\n_(Max 5 min / 15MB)_');
    }
    if (session.step === 'socialdl') {
      await handleSocialDL(phone, text, sendMessage, sendVideo);
      return sendMessage(phone, '─────────────────\nPaste another link or type *0* to go back');
    }

    // 11 ── WhatsApp Link Generator (Free)
    if (text === '11' && !session.step) {
      setSession(phone, { menu: 'file', step: 'walink', data: {} });
      return sendMessage(phone, '💬 *WhatsApp Link Generator*\n\nEnter a phone number with country code:\n(e.g. _2348012345678_)\n\nOptionally add a message:\nFormat: *number | message*\nExample: _2348012345678 | Hello, I saw your listing_');
    }
    if (session.step === 'walink') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      if (!allowed) return sendMessage(phone, guardMessage(acc, false));

      const parts = text.split('|');
      const number = parts[0].trim().replace(/\D/g, '');
      const customMessage = parts[1]?.trim() || '';

      if (!number || number.length < 7) {
        return sendMessage(phone, '❌ Invalid number. Include country code.\nExample: _2348012345678_');
      }

      const link = customMessage
        ? `https://wa.me/${number}?text=${encodeURIComponent(customMessage)}`
        : `https://wa.me/${number}`;

      await incrementDailyCount(phone);
      return sendMessage(phone, `💬 *WhatsApp Link:*\n\n${link}\n\n_Anyone can click this to open a chat with +${number}_\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n─────────────────\nEnter another number or type *0* to go back`);
    }
  }

  // ─── STUDENT TOOLS ────────────────────────────────────────────────────────
  if (session.menu === 'student') {

    // 1 ── CGPA Calculator (Free)
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
        if (!allowed) return sendMessage(phone, guardMessage(acc, false));
        await incrementDailyCount(phone);
        resetToSubmenu(phone, 'student');
        return sendMessage(phone, `📊 *CGPA Result*\n━━━━━━━━━━━━━━\nCourses: ${courses.length}\nTotal Units: ${totalUnits}\n\n🎓 *CGPA: ${cgpa}*\n🏅 *${classification}*\n\n_${acc.remainingFree - 1} free uses left today_\n\n─────────────────\nType *1* to calculate again or *0* to go back`);
      }
      const parts = text.trim().split(/\s+/);
      if (parts.length >= 3) {
        const course = { code: parts[0], grade: parts[1], units: parseInt(parts[2]) };
        session.data.courses.push(course);
        setSession(phone, session);
        return sendMessage(phone, `✅ Added: *${course.code}* (${course.grade}, ${course.units} units)\nTotal so far: ${session.data.courses.length} course(s)\n\nContinue adding or type *DONE*`);
      }
      return sendMessage(phone, `❌ Wrong format. Use:\n*CourseCode Grade Units*\nExample: _MTH101 A 3_`);
    }

    // 2 ── CV Builder (Premium)
    if (text === '2' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      setSession(phone, { menu: 'student', step: 'cv', data: {} });
      return sendMessage(phone, '📋 *CV Builder*\n\nSend your details in this format:\n\n*Name:*\n*Email:*\n*Phone:*\n*Education:*\n*Skills:*\n*Experience:*\n*Objective:*');
    }
    if (session.step === 'cv') {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await sendMessage(phone, '📋 Building your CV...\n\n_This may take a moment ⏳_');
      const cv = await askGroq(PROMPTS.cvBuilder(text));
      await incrementDailyCount(phone);
      resetToSubmenu(phone, 'student');
      return sendMessage(phone, `📄 *Your CV:*\n━━━━━━━━━━━━━━\n\n${cv}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n─────────────────\nType *2* to build another or *0* to go back`);
    }

    // 3 ── Assignment Writer (Premium)
    if (text === '3' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      setSession(phone, { menu: 'student', step: 'assign_topic', data: {} });
      return sendMessage(phone, '📝 *Assignment Writer*\n\nWhat is the topic of your assignment?');
    }
    if (session.step === 'assign_topic') {
      setSession(phone, { menu: 'student', step: 'assign_details', data: { topic: text } });
      return sendMessage(phone, `📝 Topic: *${text}*\n\nAny specific instructions or details?\n(or type *SKIP* to continue)`);
    }
    if (session.step === 'assign_details') {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      const details = upper === 'SKIP' ? 'No additional details' : text;
      await sendMessage(phone, '📝 Writing your assignment...\n\n_This may take a moment ⏳_');
      const assignment = await askGroq(PROMPTS.assignmentWriter(session.data.topic, details));
      await incrementDailyCount(phone);
      resetToSubmenu(phone, 'student');
      return sendMessage(phone, `📄 *Assignment: ${session.data.topic}*\n━━━━━━━━━━━━━━\n\n${assignment}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n─────────────────\nType *3* to write another or *0* to go back`);
    }

    // 4 ── Past Question Solver (Premium)
    if (text === '4' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      setSession(phone, { menu: 'student', step: 'pastq_course', data: {} });
      return sendMessage(phone, '📚 *Past Question Solver*\n\nWhat course is this question from?\n(e.g. MTH101, ECO201)');
    }
    if (session.step === 'pastq_course') {
      setSession(phone, { menu: 'student', step: 'pastq_question', data: { course: text } });
      return sendMessage(phone, `📚 Course: *${text}*\n\nNow paste your question:`);
    }
    if (session.step === 'pastq_question') {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await sendMessage(phone, '📚 Solving your question...\n\n_This may take a moment ⏳_');
      const solution = await askGroq(PROMPTS.pastQSolver(text, session.data.course));
      await incrementDailyCount(phone);
      resetToSubmenu(phone, 'student');
      return sendMessage(phone, `📚 *Solution — ${session.data.course}*\n━━━━━━━━━━━━━━\n\n${solution}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n─────────────────\nType *4* to solve another or *0* to go back`);
    }

    // 5 ── Cover Letter (Premium)
    if (text === '5' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      setSession(phone, { menu: 'student', step: 'cover', data: {} });
      return sendMessage(phone, '📨 *Cover Letter*\n\nSend your details:\nFormat: *Name | Position | Company | Skills*\nExample: _Philip | Software Intern | Google | Python, Node.js_');
    }
    if (session.step === 'cover') {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      const parts = text.split('|');
      if (parts.length < 4) return sendMessage(phone, '❌ Wrong format. Use:\n*Name | Position | Company | Skills*');
      await sendMessage(phone, '📨 Writing your cover letter...\n\n_This may take a moment ⏳_');
      const letter = await askGroq(PROMPTS.coverLetter(parts[0].trim(), parts[1].trim(), parts[2].trim(), parts[3].trim()));
      await incrementDailyCount(phone);
      resetToSubmenu(phone, 'student');
      return sendMessage(phone, `📄 *Cover Letter*\n━━━━━━━━━━━━━━\n\n${letter}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n─────────────────\nType *5* to write another or *0* to go back`);
    }
  }

  // ─── FALLBACK ──────────────────────────────────────────────────────────────
  return sendMessage(phone, `🤖 I didn't understand that.\n\nType *MENU* to see all options or *HELP* for guidance.`);
};

// Export session step checker for queue system in index.js
const getSessionStep = (phone) => {
  const session = getSession(phone);
  return session.step || null;
};

module.exports = { handleMessage, getSessionStep };