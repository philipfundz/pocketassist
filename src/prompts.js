const PROMPTS = {
  // AI Q&A
  aiQA: (question) => `You are PocketAssist, a helpful AI assistant for COOU students in Nigeria.
Answer this question clearly and concisely: ${question}
Keep response under 300 words. Use simple English.`,

  // AI Smart Reply
  smartReply: (message) => `You are PocketAssist helping a Nigerian student craft a smart reply.
Original message: "${message}"
Generate 3 different reply options:
1. Formal/Professional
2. Friendly/Casual
3. Short/Direct
Format each clearly numbered.`,

  // Assignment Writer — WhatsApp-friendly formatting
  assignmentWriter: (topic, details) => `You are an academic assistant helping a Nigerian university student.
Topic: ${topic}
Details: ${details}

Write a well-structured academic assignment. Use this exact format for WhatsApp readability:

*INTRODUCTION*
[Write introduction here]

*MAIN BODY*

*Point 1: [Title]*
[Explanation]

*Point 2: [Title]*
[Explanation]

*Point 3: [Title]*
const PROMPTS = {
  // AI Q&A
  aiQA: (question) => `You are PocketAssist, a helpful AI assistant.
Answer this question clearly and concisely: ${question}
Keep response under 300 words. Use simple English. Use plain numbered lists if needed. Do not use asterisks (*), bold, or any markdown symbols.`,

  // AI Smart Reply
  smartReply: (message) => `You are PocketAssist helping someone craft a smart reply.
Original message: "${message}"
Generate 3 different reply options:
1. Formal/Professional
2. Friendly/Casual
3. Short/Direct
Format each clearly numbered. Do not use asterisks (*), bold, or any markdown symbols.`,

  // Assignment Writer
  assignmentWriter: (topic, details) => `You are an academic assistant helping a Nigerian university student.
Topic: ${topic}
Details: ${details}

Write a well-structured academic assignment using this format:

INTRODUCTION
[Write introduction here]

MAIN BODY

Point 1: [Title]
[Explanation]

Point 2: [Title]
[Explanation]

Point 3: [Title]
[Explanation]

CONCLUSION
[Write conclusion here]

Rules:
- Plain text only, no asterisks (*), no markdown symbols like ##, or ---
- Do not wrap any word or phrase in asterisks (*). Not even single asterisks.
- Short paragraphs (3-5 lines max)
- Simple, clear academic English
- Suitable for Nigerian university level`,

  // Cover Letter
  coverLetter: (name, position, company, skills) => `Write a professional cover letter for:
Name: ${name}
Position: ${position}
Company: ${company}
Key skills: ${skills}

Format for WhatsApp readability:
- Short paragraphs (3-4 lines max)
- No asterisks (*), no markdown symbols like ##, or ---
- Do not wrap any word or phrase in asterisks (*). Not even single asterisks.
- 3 paragraphs: Opening, Body, Closing
- Professional and compelling tone`,

  // CV Builder
  cvBuilder: (details) => `Create a clean, professional CV based on these details:
${details}

Format clearly with these sections, each on its own line:
PERSONAL INFORMATION
EDUCATION
SKILLS
EXPERIENCE
OBJECTIVE

Rules:
- No asterisks (*), no markdown symbols like ##, or ---
- Do not wrap any word or phrase in asterisks (*). Not even single asterisks.
- Keep each section concise
- ATS-friendly language`,

  // Caption Generator
  captionGen: (description, platform) => `Generate 5 engaging ${platform} captions for this post:
"${description}"

Format exactly like this:
1. [caption with hashtags]

2. [caption with hashtags]

3. [caption with hashtags]

4. [caption with hashtags]

5. [caption with hashtags]

Rules:
- Each caption on its own line with a blank line between them
- Include 3-5 relevant hashtags per caption
- Mix tones: professional, fun, and viral-worthy
- Optimized for ${platform}
- No asterisks (*), no markdown symbols like ##, or ---
- Do not wrap any word or phrase in asterisks (*). Not even single asterisks.`,

  // Plagiarism Rewriter
  plagiarismRewriter: (text) => `Rewrite the following text to make it 100% original while preserving the meaning:
"${text}"

Rules:
- Natural, flowing language
- Suitable for academic submission
- Same length as original
- No asterisks (*), no markdown symbols like ##, or ---
- Do not wrap any word or phrase in asterisks (*). Not even single asterisks.`,

  // Translator
  translator: (text, targetLanguage) => `Translate the following text to ${targetLanguage}:
"${text}"

Provide a natural, accurate translation only. No explanations, no asterisks (*), no extra text.`,

  // Past Question Solver
  pastQSolver: (question, course) => `You are an academic tutor helping a Nigerian university student.
Course: ${course}
Question: ${question}

Answer using this format:

ANSWER
[Direct answer to the question]

EXPLANATION
[Clear, detailed explanation in short paragraphs]

KEY POINTS TO REMEMBER
1. [Point 1]
2. [Point 2]
3. [Point 3]

Rules:
- Plain text only, no asterisks (*), no markdown symbols like ##, or ---
- Do not wrap any word or phrase in asterisks (*). Not even single asterisks.
- Short paragraphs (3-5 lines max)
- Simple, clear language suitable for exam preparation`,

  // Webpage Reader Summary
  webpageReader: (content) => `Summarize the following webpage content:
${content}

Provide:
1. Main topic (1 sentence)
2. Key points (3-5 bullets)
3. Important takeaway (1 sentence)

Keep it clear and concise. No asterisks (*), no bold, no markdown symbols.`,
};

module.exports = PROMPTS;
