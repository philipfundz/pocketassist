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

  // Assignment Writer
  assignmentWriter: (topic, details) => `You are an academic assistant helping a Nigerian university student.
Topic: ${topic}
Details: ${details}
Write a well-structured academic response with:
- Introduction
- Main body (3 key points)
- Conclusion
Keep it original, clear and appropriate for university level.`,

  // Cover Letter
  coverLetter: (name, position, company, skills) => `Write a professional cover letter for:
Name: ${name}
Position: ${position}
Company: ${company}
Key skills: ${skills}
Make it compelling, concise (3 paragraphs), and professional.`,

  // CV Builder
  cvBuilder: (details) => `Create a clean, professional CV based on these details:
${details}
Format it clearly with sections: Personal Info, Education, Skills, Experience, References.
Keep it ATS-friendly and concise.`,

  // Caption Generator
  captionGen: (description, platform) => `Generate 5 engaging social media captions for:
Description: ${description}
Platform: ${platform}
Include relevant hashtags. Mix tones: professional, fun, and viral-worthy.`,

  // Plagiarism Rewriter
  plagiarismRewriter: (text) => `Rewrite the following text to make it 100% original while preserving the meaning:
"${text}"
Make it natural, clear and suitable for academic submission.`,

  // Translator
  translator: (text, targetLanguage) => `Translate the following text to ${targetLanguage}:
"${text}"
Provide a natural, accurate translation.`,

  // Past Question Solver
  pastQSolver: (question, course) => `You are an academic tutor helping a Nigerian university student.
Course: ${course}
Question: ${question}
Provide a clear, detailed answer suitable for exam preparation.
Include key points the student should remember.`,

  // Webpage Reader Summary
  webpageReader: (content) => `Summarize the following webpage content for a student:
${content}
Provide:
1. Main topic (1 sentence)
2. Key points (3-5 bullets)
3. Important takeaway (1 sentence)
Keep it clear and concise.`,
};

module.exports = PROMPTS;