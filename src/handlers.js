const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const { canUseTools } = require('./auth');
const { incrementDailyCount, getSession, setSession, clearSession } = require('./database');
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
  handleMultiImageToPDF,
  handleWatermark,
  handleESign,
  handleStickerCreator,
} = require('./fileProcessor');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = 'gemini-2.5-flash';

// ─── SESSION HELPERS ──────────────────────────────────────────────────────────
const resetToSubmenu = async (phone, menu) => {
  await setSession(phone, { menu, step: null, data: {} });
};

const getSubmenuMessage = (menu) => {
  if (menu === 'ai') return getAIToolsMenu();
  if (menu === 'file') return getFileToolsMenu();
  if (menu === 'student') return getStudentToolsMenu();
  return getMainMenu();
};

// ─── GEMINI TEXT CALL (single-shot, no history) ──────────────────────────────
const askGemini = async (prompt) => {
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
  const result = await model.generateContent(prompt);
  return result.response.text();
};

// ─── GEMINI CHAT (with history) — used by AI Q&A and Smart Reply ────────────
const askGeminiChat = async (history, newMessage) => {
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: `You are PocketAssist, a helpful AI assistant on WhatsApp. 
Answer questions clearly and concisely. Remember the conversation context and give 
follow-up answers that reference what was discussed. Keep responses under 400 words. 
Use plain text only — no asterisks, no markdown, no bold symbols.`,
  });

  const chat = model.startChat({
    history: history.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
  });

  const result = await chat.sendMessage(newMessage);
  return result.response.text();
};

// ─── GEMINI VISION (image + optional text) ────────────────────────────────────
// Used by: AI Q&A (with history) and Assignment Writer (single-shot, no history)
const askGeminiVision = async (imageUrl, question, history = []) => {
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: `You are PocketAssist, a helpful AI assistant on WhatsApp.
Directly answer the specific question asked about the image — do not restate, describe,
or summarize what's in the image first. Go straight to fulfilling the request using
the image's content as your source. For example, if asked for notes, definitions, or
explanations based on what's in the image, produce those directly without first listing
or describing what the image shows. If it's a calculation, math problem, or equation,
solve it and state the final answer clearly. Only describe the image in general terms
if the user explicitly asks you to describe it, or asks an open-ended question like
"what is this?". Keep responses under 400 words. Use plain text only — no asterisks,
no markdown, no bold symbols.`,
  });

  // Download image and convert to base64
  const response = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
  });
  const base64 = Buffer.from(response.data).toString('base64');
  const mimeType = response.headers['content-type'] || 'image/jpeg';

  const parts = [
    { inlineData: { data: base64, mimeType } },
    { text: question || 'What is in this image? Describe it in detail.' },
  ];

  // If there's prior history, include it (AI Q&A use case)
  if (history.length > 0) {
    const chat = model.startChat({
      history: history.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    });
    const result = await chat.sendMessage(parts);
    return result.response.text();
  }

  const result = await model.generateContent(parts);
  return result.response.text();
};

// ─── MAIN ROUTER ──────────────────────────────────────────────────────────────
const handleMessage = async (phone, message, mediaUrl, mediaType, sendMessage, sendImage, sendVideo, sendDocument, sendSticker, user, access) => {
  const text = message?.trim() || '';
  const upper = text.toUpperCase();
  const session = await getSession(phone);

  // ── Global commands ──────────────────────────────────────────────────────
  if (upper === 'MENU' || upper === 'HI' || upper === 'HELLO' || upper === 'HEY' || upper === 'START' || text === '👋') {
    await clearSession(phone);
    return sendMessage(phone, getMainMenu());
  }

  if (upper === 'HELP') return sendMessage(phone, require('./menu').getHelpMessage());
  if (upper === 'PREMIUM') return sendMessage(phone, getPremiumMessage());
  if (upper === 'STATS') return sendMessage(phone, getAccountMenu(user, access.remainingFree));

  // ── Back / 0 ─────────────────────────────────────────────────────────────
  if (upper === '0' || upper === 'BACK') {
    if (session.step) {
      await resetToSubmenu(phone, session.menu);
      return sendMessage(phone, getSubmenuMessage(session.menu));
    }
    await clearSession(phone);
    return sendMessage(phone, getMainMenu());
  }

  // ─── MAIN MENU ────────────────────────────────────────────────────────────
  if (session.menu === 'main') {
    if (text === '1') { await setSession(phone, { menu: 'ai',      step: null, data: {} }); return sendMessage(phone, getAIToolsMenu()); }
    if (text === '2') { await setSession(phone, { menu: 'file',    step: null, data: {} }); return sendMessage(phone, getFileToolsMenu()); }
    if (text === '3') { await setSession(phone, { menu: 'student', step: null, data: {} }); return sendMessage(phone, getStudentToolsMenu()); }
    if (text === '4') { return sendMessage(phone, getAccountMenu(user, access.remainingFree)); }
  }

  // ─── AI TOOLS ─────────────────────────────────────────────────────────────
  if (session.menu === 'ai') {

    // 1 ── AI Q&A (Free) — with conversation history + image support
    if (text === '1' && !session.step) {
      await setSession(phone, { menu: 'ai', step: 'aiqa', data: { messages: [] } });
      return sendMessage(phone, '🧠 *AI Q&A*\n\nAsk me anything! Type your question or send an image:\n\n_Type *0* 🔙 to go back_');
    }
    if (session.step === 'aiqa') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      if (!allowed) return sendMessage(phone, guardMessage(acc, false));

      const history = session.data.messages || [];
      await sendMessage(phone, '🤔 Thinking...');

      let answer;
      let userEntry;

      try {
        if (mediaUrl && mediaType?.includes('image')) {
          // Image question
          answer = await askGeminiVision(mediaUrl, text || 'What is in this image?', history);
          userEntry = { role: 'user', content: text ? `[Image] ${text}` : '[Image]' };
        } else {
          // Text question with history
          answer = await askGeminiChat(history, text);
          userEntry = { role: 'user', content: text };
        }

        // Save history (keep last 10 messages = 5 exchanges)
        history.push(userEntry);
        history.push({ role: 'assistant', content: answer });
        const trimmed = history.slice(-10);

        await setSession(phone, { menu: 'ai', step: 'aiqa', data: { messages: trimmed } });
        await incrementDailyCount(phone);

        return sendMessage(phone, `💡 *Answer:*\n\n${answer}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n━━━━━━━━━━━━━━\nAsk a follow-up, send another image, or type *0* 🔙 to go back`);
      
      } catch (err) {
        console.error('[AI Q&A Error]', err.message);
        return sendMessage(phone, '❌ Something went wrong. Please try again.\n\nType *0* 🔙 to go back.');
      }
    }

    // 2 ── Smart Reply (Free) — with conversation history
    if (text === '2' && !session.step) {
      await setSession(phone, { menu: 'ai', step: 'smartreply', data: { messages: [] } });
      return sendMessage(phone, '✍️ *AI Smart Reply*\n\nPaste the message you want to reply to:\n\n_Type *0* 🔙 to go back_');
    }
    if (session.step === 'smartreply') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      if (!allowed) return sendMessage(phone, guardMessage(acc, false));

      const history = session.data.messages || [];
      await sendMessage(phone, '✍️ Generating replies...');

      try {
        const replies = await askGeminiChat(history, PROMPTS.smartReply(text));

        history.push({ role: 'user', content: text });
        history.push({ role: 'assistant', content: replies });
        const trimmed = history.slice(-10);

        await setSession(phone, { menu: 'ai', step: 'smartreply', data: { messages: trimmed } });
        await incrementDailyCount(phone);

        return sendMessage(phone, `💬 *Smart Reply Options:*\n\n${replies}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n━━━━━━━━━━━━━━\nPaste another message or type *0* 🔙 to go back`);
      } catch (err) {
        console.error('[AI Q&A Error]', err.message);
        if (err.message && err.message.includes('429')) {
          return sendMessage(phone, '⏳ AI is getting a lot of requests right now and has hit its daily limit.\n\nPlease try again in a few minutes.\n\nType *0* 🔙 to go back.');
        }
        return sendMessage(phone, '❌ Something went wrong. Please try again.\n\nType *0* 🔙 to go back.');
      }
    }

    // 3 ── Translator (Premium)
    if (text === '3' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await setSession(phone, { menu: 'ai', step: 'translate_text', data: {} });
      return sendMessage(phone, '🌍 *Translator*\n\nWhat text do you want to translate?\n\nType it below:');
    }
    if (session.step === 'translate_text') {
      await setSession(phone, { menu: 'ai', step: 'translate_lang', data: { text } });
      return sendMessage(phone, `📝 Got it!\n\n_"${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"_\n\nWhat language should I translate it to?\n(e.g. Igbo, Yoruba, French, Arabic)`);
    }
    if (session.step === 'translate_lang') {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await sendMessage(phone, '🌍 Translating...');
      const translated = await askGemini(PROMPTS.translator(session.data.text, text));
      await incrementDailyCount(phone);
      await setSession(phone, { menu: 'ai', step: 'translate_text', data: {} });
      return sendMessage(phone, `🌍 *Translation (${text}):*\n\n${translated}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n━━━━━━━━━━━━━━\nType another text to translate or *0* 🔙 to go back`);
    }

    // 4 ── Caption Generator (Premium)
    if (text === '4' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await setSession(phone, { menu: 'ai', step: 'caption_desc', data: {} });
      return sendMessage(phone, '📱 *Caption Generator*\n\nDescribe your post or photo:\n(e.g. _Sunset at the beach with friends_)');
    }
    if (session.step === 'caption_desc') {
      await setSession(phone, { menu: 'ai', step: 'caption_platform', data: { description: text } });
      return sendMessage(phone, `✅ Got it!\n\n_"${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"_\n\nWhich platform is this for?\n(e.g. Instagram, TikTok, Twitter, Facebook, LinkedIn)`);
    }
    if (session.step === 'caption_platform') {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await sendMessage(phone, '✨ Generating captions...');
      const captions = await askGemini(PROMPTS.captionGen(session.data.description, text));
      await incrementDailyCount(phone);
      await setSession(phone, { menu: 'ai', step: 'caption_desc', data: {} });
      return sendMessage(phone, `📱 *Captions for ${text}:*\n\n${captions}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n━━━━━━━━━━━━━━\nDescribe another post or type *0* 🔙 to go back`);
    }

    // 5 ── Plagiarism Rewriter (Premium)
    if (text === '5' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await setSession(phone, { menu: 'ai', step: 'rewrite', data: {} });
      return sendMessage(phone, '🔄 *Plagiarism Rewriter*\n\nPaste the text you want rewritten:\n_(Tip: one paragraph at a time works best)_');
    }
    if (session.step === 'rewrite') {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await sendMessage(phone, '🔄 Rewriting your text...\n\n_This may take a few seconds ⏳_');
      try {
        const rewritten = await Promise.race([
          askGemini(PROMPTS.plagiarismRewriter(text)),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000))
        ]);
        await incrementDailyCount(phone);
        return sendMessage(phone, `✅ *Rewritten:*\n\n${rewritten}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n━━━━━━━━━━━━━━\nPaste another passage or type *0* 🔙 to go back`);
      } catch (err) {
        if (err.message === 'timeout') {
          return sendMessage(phone, '⏱️ This is taking longer than expected.\n\nTry sending a *shorter passage* (one paragraph at a time).\n\nPaste a shorter text or type *0* 🔙 to go back.');
        }
        return sendMessage(phone, '❌ Rewrite failed. Please try again.\n\nType *0* 🔙 to go back.');
      }
    }
  }

  // ─── FILE TOOLS ───────────────────────────────────────────────────────────
  if (session.menu === 'file') {

    // 1 ── OCR (Free)
    if (text === '1' && !session.step) {
      await setSession(phone, { menu: 'file', step: 'ocr', data: {} });
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
      await setSession(phone, { menu: 'file', step: 'convert_file', data: { images: [] } });
      return sendMessage(phone, `🔄 *File Converter*\n\nSend me the file you want to convert.\n\n*Supported conversions:*\n• DOCX/PPTX/XLSX → PDF\n• PDF → DOCX\n• Images (JPG/PNG/WEBP) ↔ each other, or → PDF\n\n_Tip: send multiple images one after another to combine them into a single PDF._\n\n_Send your file now:_`);
    }
    if (session.step === 'convert_file') {
      const images = session.data.images || [];

      if (mediaUrl) {
        const isImage = mediaType?.includes('image');

        if (isImage) {
          if (images.length >= 15) {
            return sendMessage(phone, `⚠️ Batch limit reached (15 images max).\n\nType *PDF* now to combine what you've sent, or *0* 🔙 to start over.`);
          }

          images.push({ mediaUrl, mediaType });
          await setSession(phone, { menu: 'file', step: 'convert_file', data: { images } });

          const remaining = 15 - images.length;
          return sendMessage(phone, `✅ Image ${images.length} received.\n\nSend more images to add to the batch (${remaining} more allowed), or type the target format (e.g. *PDF*, *JPG*, *PNG*) to convert now.`);
        }

        await setSession(phone, { menu: 'file', step: 'convert_format', data: { mediaUrl, mediaType } });
        return sendMessage(phone, `✅ File received!\n\nWhat format do you want to convert it to?\n\nExamples: *PDF, DOCX, JPG, PNG, XLSX*\n\nType the format name:`);
      }

      if (images.length === 0) {
        return sendMessage(phone, '📎 Please send a *file* (or image) to convert.');
      }

      const target = text.toLowerCase().trim();
      const { allowed, access: acc } = await canUseTools(phone, false);
      if (!allowed) return sendMessage(phone, guardMessage(acc, false));

      if (images.length === 1) {
        await incrementDailyCount(phone);
        await handleFileConvert(phone, images[0].mediaUrl, images[0].mediaType, target, sendMessage, sendDocument, sendImage);
        await setSession(phone, { menu: 'file', step: 'convert_file', data: { images: [] } });
        return;
      }

      if (target !== 'pdf') {
        return sendMessage(phone, `❌ ${images.length} images can only be combined into one *PDF*.\n\nType *PDF* to continue, or *0* 🔙 to go back and convert a single image to another format instead.`);
      }

      await incrementDailyCount(phone);
      await handleMultiImageToPDF(phone, images.map(i => i.mediaUrl), sendMessage, sendDocument);
      await setSession(phone, { menu: 'file', step: 'convert_file', data: { images: [] } });
      return;
    }
    if (session.step === 'convert_format') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      if (!allowed) return sendMessage(phone, guardMessage(acc, false));
      await incrementDailyCount(phone);
      await handleFileConvert(phone, session.data.mediaUrl, session.data.mediaType, text.toLowerCase(), sendMessage, sendDocument, sendImage);
      await setSession(phone, { menu: 'file', step: 'convert_file', data: { images: [] } });
      return sendMessage(phone, '━━━━━━━━━━━━━━\nSend another file or type *0* 🔙 to go back');
    }

    // 3 ── Voice Transcriber (Free)
    if (text === '3' && !session.step) {
      await setSession(phone, { menu: 'file', step: 'voice', data: {} });
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
      return sendMessage(phone, '━━━━━━━━━━━━━━\nSend another voice message or type *0* 🔙 to go back');
    }

    // 4 ── URL Shortener (Free)
    if (text === '4' && !session.step) {
      await setSession(phone, { menu: 'file', step: 'url', data: {} });
      return sendMessage(phone, '🔗 *URL Shortener*\n\nPaste the link you want to shorten:');
    }
    if (session.step === 'url') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      if (!allowed) return sendMessage(phone, guardMessage(acc, false));
      await incrementDailyCount(phone);
      await handleURLShortener(phone, text, sendMessage);
      return sendMessage(phone, '━━━━━━━━━━━━━━\nPaste another link or type *0* 🔙 to go back');
    }

    // 5 ── QR Code (Free)
    if (text === '5' && !session.step) {
      await setSession(phone, { menu: 'file', step: 'qr', data: {} });
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
      await setSession(phone, { menu: 'file', step: 'web', data: {} });
      return sendMessage(phone, '🌐 *Webpage Reader*\n\nPaste the URL you want me to read and summarize:');
    }
    if (session.step === 'web') {
      const { allowed, access: acc } = await canUseTools(phone, false);
      if (!allowed) return sendMessage(phone, guardMessage(acc, false));
      await incrementDailyCount(phone);
      await handleWebpageReader(phone, text, sendMessage);
      return sendMessage(phone, '━━━━━━━━━━━━━━\nPaste another URL or type *0* 🔙 to go back');
    }

    // 7 ── Watermark (Premium)
    if (text === '7' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await setSession(phone, { menu: 'file', step: 'watermark', data: {} });
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
      await setSession(phone, { menu: 'file', step: 'watermark', data: {} });
      return;
    }

    // 8 ── E-Sign (Premium)
    if (text === '8' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await setSession(phone, { menu: 'file', step: 'esign_pdf', data: {} });
      return sendMessage(phone, '✍️ *E-Sign*\n\nFirst, send me the *PDF* you want to sign:');
    }
    if (session.step === 'esign_pdf') {
      if (!mediaUrl || !mediaType?.includes('pdf')) {
        return sendMessage(phone, '📄 Please send a *PDF* file to sign.');
      }
      await setSession(phone, { menu: 'file', step: 'esign_sig', data: { pdfUrl: mediaUrl } });
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
      await setSession(phone, { menu: 'file', step: 'esign_pdf', data: {} });
      return sendMessage(phone, '━━━━━━━━━━━━━━\nSend another PDF to sign or type *0* 🔙 to go back');
    }

    // 9 ── Sticker Creator (Premium)
    if (text === '9' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await setSession(phone, { menu: 'file', step: 'sticker', data: {} });
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
      await setSession(phone, { menu: 'file', step: 'sticker', data: {} });
      return;
    }

    // 10 ── Social Downloader (Premium)
    if (text === '10' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await setSession(phone, { menu: 'file', step: 'socialdl', data: {} });
      return sendMessage(phone, '⬇️ *Social Downloader*\n\nPaste the video link:\nSupports: YouTube Shorts, TikTok, Instagram, Twitter/X, Facebook\n_(Max 5 min / 15MB)_');
    }
    if (session.step === 'socialdl') {
      await handleSocialDL(phone, text, sendMessage, sendVideo);
      return sendMessage(phone, '━━━━━━━━━━━━━━\nPaste another link or type *0* 🔙 to go back');
    }

    // 11 ── WhatsApp Link Generator (Free)
    if (text === '11' && !session.step) {
      await setSession(phone, { menu: 'file', step: 'walink', data: {} });
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
      return sendMessage(phone, `💬 *WhatsApp Link:*\n\n${link}\n\n_Anyone can click this to open a chat with +${number}_\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n━━━━━━━━━━━━━━\nEnter another number or type *0* 🔙 to go back`);
    }
  }

  // ─── STUDENT TOOLS ────────────────────────────────────────────────────────
  if (session.menu === 'student') {

    // 1 ── CGPA Calculator (Free)
    if (text === '1' && !session.step) {
      await setSession(phone, { menu: 'student', step: 'cgpa', data: { courses: [] } });
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
        await resetToSubmenu(phone, 'student');
        return sendMessage(phone, `📊 *CGPA Result*\n━━━━━━━━━━━━━━\nCourses: ${courses.length}\nTotal Units: ${totalUnits}\n\n🎓 *CGPA: ${cgpa}*\n🏅 *${classification}*\n\n_${acc.remainingFree - 1} free uses left today_\n\n━━━━━━━━━━━━━━\nType *1* to calculate again or *0* 🔙 to go back`);
      }
      const parts = text.trim().split(/\s+/);
      if (parts.length >= 3) {
        const course = { code: parts[0], grade: parts[1], units: parseInt(parts[2]) };
        session.data.courses.push(course);
        await setSession(phone, session);
        return sendMessage(phone, `✅ Added: *${course.code}* (${course.grade}, ${course.units} units)\nTotal so far: ${session.data.courses.length} course(s)\n\nContinue adding or type *DONE*`);
      }
      return sendMessage(phone, `❌ Wrong format. Use:\n*CourseCode Grade Units*\nExample: _MTH101 A 3_`);
    }

    // 2 ── CV Builder (Premium)
    if (text === '2' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await setSession(phone, { menu: 'student', step: 'cv', data: {} });
      return sendMessage(phone, '📋 *CV Builder*\n\nSend your details in this format:\n\n*Name:*\n*Email:*\n*Phone:*\n*Education:*\n*Skills:*\n*Experience:*\n*Objective:*');
    }
    if (session.step === 'cv') {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await sendMessage(phone, '📋 Building your CV...\n\n_This may take a moment ⏳_');
      const cv = await askGemini(PROMPTS.cvBuilder(text));
      await incrementDailyCount(phone);
      await resetToSubmenu(phone, 'student');
      return sendMessage(phone, `📄 *Your CV:*\n━━━━━━━━━━━━━━\n\n${cv}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n━━━━━━━━━━━━━━\nType *2* to build another or *0* 🔙 to go back`);
    }

    // 3 ── Assignment Writer (Premium) — now supports a photo of the question
    if (text === '3' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await setSession(phone, { menu: 'student', step: 'assign_topic', data: {} });
      return sendMessage(phone, '📝 *Assignment Writer*\n\nWhat is the topic of your assignment?');
    }
    if (session.step === 'assign_topic') {
      await setSession(phone, { menu: 'student', step: 'assign_details', data: { topic: text } });
      return sendMessage(phone, `📝 Topic: *${text}*\n\nSend specific instructions, or a photo of the assignment question.\n(or type *SKIP* to continue)`);
    }
    if (session.step === 'assign_details') {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await sendMessage(phone, '📝 Writing your assignment...\n\n_This may take a moment ⏳_');

      let assignment;
      try {
        if (mediaUrl && mediaType?.includes('image')) {
          const prompt = PROMPTS.assignmentWriter(session.data.topic, text || 'Use the details shown in the image');
          assignment = await askGeminiVision(mediaUrl, prompt);
        } else {
          const details = upper === 'SKIP' ? 'No additional details' : text;
          assignment = await askGemini(PROMPTS.assignmentWriter(session.data.topic, details));
        }
      } catch (err) {
        console.error('[Assignment Writer Error]', err.message);
        return sendMessage(phone, '❌ Something went wrong. Please try again.\n\nType *0* 🔙 to go back.');
      }

      await incrementDailyCount(phone);
      await resetToSubmenu(phone, 'student');
      return sendMessage(phone, `📄 *Assignment: ${session.data.topic}*\n━━━━━━━━━━━━━━\n\n${assignment}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n━━━━━━━━━━━━━━\nType *3* to write another or *0* 🔙 to go back`);
    }

    // 4 ── Past Question Solver (Premium)
    if (text === '4' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await setSession(phone, { menu: 'student', step: 'pastq_course', data: {} });
      return sendMessage(phone, '📚 *Past Question Solver*\n\nWhat course is this question from?\n(e.g. MTH101, ECO201)');
    }
    if (session.step === 'pastq_course') {
      await setSession(phone, { menu: 'student', step: 'pastq_question', data: { course: text } });
      return sendMessage(phone, `📚 Course: *${text}*\n\nNow paste your question:`);
    }
    if (session.step === 'pastq_question') {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await sendMessage(phone, '📚 Solving your question...\n\n_This may take a moment ⏳_');
      const solution = await askGemini(PROMPTS.pastQSolver(text, session.data.course));
      await incrementDailyCount(phone);
      await resetToSubmenu(phone, 'student');
      return sendMessage(phone, `📚 *Solution — ${session.data.course}*\n━━━━━━━━━━━━━━\n\n${solution}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n━━━━━━━━━━━━━━\nType *4* to solve another or *0* 🔙 to go back`);
    }

    // 5 ── Cover Letter (Premium)
    if (text === '5' && !session.step) {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      await setSession(phone, { menu: 'student', step: 'cover', data: {} });
      return sendMessage(phone, '📨 *Cover Letter*\n\nSend your details:\nFormat: *Name | Position | Company | Skills*\nExample: _Philip | Software Intern | Google | Python, Node.js_');
    }
    if (session.step === 'cover') {
      const { allowed, access: acc } = await canUseTools(phone, true);
      if (!allowed) return sendMessage(phone, guardMessage(acc, true));
      const parts = text.split('|');
      if (parts.length < 4) return sendMessage(phone, '❌ Wrong format. Use:\n*Name | Position | Company | Skills*');
      await sendMessage(phone, '📨 Writing your cover letter...\n\n_This may take a moment ⏳_');
      const letter = await askGemini(PROMPTS.coverLetter(parts[0].trim(), parts[1].trim(), parts[2].trim(), parts[3].trim()));
      await incrementDailyCount(phone);
      await resetToSubmenu(phone, 'student');
      return sendMessage(phone, `📄 *Cover Letter*\n━━━━━━━━━━━━━━\n\n${letter}\n\n_${acc.isPremium ? '⭐ Premium' : `${acc.remainingFree - 1} free uses left today`}_\n\n━━━━━━━━━━━━━━\nType *5* to write another or *0* 🔙 to go back`);
    }
  }

  // ─── FALLBACK ──────────────────────────────────────────────────────────────
  return sendMessage(phone, `🤖 I didn't understand that.\n\nType *MENU* to see all options or *HELP* for guidance.`);
};

// Export session step checker for queue system in index.js
const getSessionStep = async (phone) => {
  const session = await getSession(phone);
  return session.step || null;
};

module.exports = { handleMessage, getSessionStep };
