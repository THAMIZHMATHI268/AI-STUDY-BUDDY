const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ======================================================
// RETRY HELPER
// ======================================================

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const generateWithRetry = async (model, prompt, maxRetries = 2) => {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await model.generateContent(prompt);
    } catch (error) {
      const message = error?.message || "";
      const status = error?.status;

      const isTemporaryError =
        status === 503 ||
        message.includes("503") ||
        message.includes("Service Unavailable") ||
        message.includes("high demand");

      if (!isTemporaryError || attempt === maxRetries) {
        throw error;
      }

      const delay = 5000 * Math.pow(2, attempt);

      console.log(
        `Gemini temporarily unavailable. Retrying in ${
          delay / 1000
        } seconds...`
      );

      await sleep(delay);
    }
  }
};

// ======================================================
// NORMAL GEMINI MODEL
// ======================================================

const model = genAI.getGenerativeModel({
  model: "gemini-3.6-flash",
});

const askGemini = async (prompt) => {
  const result = await generateWithRetry(model, prompt);
  return result.response.text();
};

// ======================================================
// FLASHCARD MODEL
// ======================================================

const flashcardModel = genAI.getGenerativeModel({
  model: "gemini-3.6-flash",

  generationConfig: {
    responseMimeType: "application/json",

    responseSchema: {
      type: SchemaType.ARRAY,

      items: {
        type: SchemaType.OBJECT,

        properties: {
          question: {
            type: SchemaType.STRING,
          },

          answer: {
            type: SchemaType.STRING,
          },
        },

        required: ["question", "answer"],
      },
    },
  },
});

// ======================================================
// QUIZ MODEL
// ======================================================

const quizModel = genAI.getGenerativeModel({
  model: "gemini-3.6-flash",

  generationConfig: {
    responseMimeType: "application/json",

    responseSchema: {
      type: SchemaType.ARRAY,

      items: {
        type: SchemaType.OBJECT,

        properties: {
          question: {
            type: SchemaType.STRING,
          },

          options: {
            type: SchemaType.ARRAY,

            items: {
              type: SchemaType.STRING,
            },
          },

          answer: {
            type: SchemaType.STRING,
          },
        },

        required: ["question", "options", "answer"],
      },
    },
  },
});

// ======================================================
// FLASHCARD GENERATION
// ======================================================

const askGeminiJSON = async (prompt) => {
  const result = await generateWithRetry(flashcardModel, prompt);

  const text = result.response.text();

  console.log("Gemini flashcard raw response:");
  console.log(text);

  return text;
};

// ======================================================
// QUIZ GENERATION
// ======================================================

const askGeminiQuizJSON = async (prompt) => {
  const result = await generateWithRetry(quizModel, prompt);

  const text = result.response.text();

  console.log("Gemini quiz raw response:");
  console.log(text);

  return text;
};

// ======================================================
// EXPORTS
// ======================================================

module.exports = {
  askGemini,
  askGeminiJSON,
  askGeminiQuizJSON,
};