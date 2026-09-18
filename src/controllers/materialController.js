const fs = require("fs");
const Material = require("../models/Material");

const {
  askGemini,
  askGeminiJSON,
  askGeminiQuizJSON,
} = require("../utils/gemini");

// Helper: read uploaded file text
const readFileText = (filePath) => {
  return fs.readFileSync(filePath, "utf-8");
};

// Helper: clean Gemini JSON response
const cleanJSON = (raw) => {
  return raw
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
};

// ======================================================
// POST /api/materials/upload
// ======================================================

const uploadMaterial = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      message: "No file uploaded",
    });
  }

  try {
    const { title } = req.body;

    const content = readFileText(req.file.path);

    const material = await Material.create({
      user: req.user.userId,
      title: title || req.file.originalname,
      content,
      filename: req.file.originalname,
    });

    // Delete temporary uploaded file
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(201).json({
      message: "Material uploaded",
      material,
    });
  } catch (error) {
    console.error("Upload error:", error);

    // Remove temporary file if something went wrong
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      message: "Failed to upload material",
      error: error.message,
    });
  }
};

// ======================================================
// GET /api/materials
// ======================================================

const getMaterials = async (req, res) => {
  try {
    const filter =
      req.user.role === "admin"
        ? {}
        : { user: req.user.userId };

    const materials = await Material.find(filter)
      .select("-content -flashcards -quiz -studyPlan")
      .sort("-createdAt");

    res.json(materials);
  } catch (error) {
    console.error("Get materials error:", error);

    res.status(500).json({
      message: "Failed to get materials",
      error: error.message,
    });
  }
};

// ======================================================
// GET /api/materials/:id
// ======================================================

const getMaterial = async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);

    if (!material) {
      return res.status(404).json({
        message: "Material not found",
      });
    }

    // Students can access only their own material
    if (
      req.user.role !== "admin" &&
      material.user.toString() !== req.user.userId
    ) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    res.json(material);
  } catch (error) {
    console.error("Get material error:", error);

    res.status(500).json({
      message: "Failed to get material",
      error: error.message,
    });
  }
};

// ======================================================
// DELETE /api/materials/:id
// ======================================================

const deleteMaterial = async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);

    if (!material) {
      return res.status(404).json({
        message: "Material not found",
      });
    }

    // Students can delete only their own material
    if (
      req.user.role !== "admin" &&
      material.user.toString() !== req.user.userId
    ) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    await material.deleteOne();

    res.json({
      message: "Material deleted successfully",
    });
  } catch (error) {
    console.error("Delete material error:", error);

    res.status(500).json({
      message: "Failed to delete material",
      error: error.message,
    });
  }
};

// ======================================================
// POST /api/materials/:id/summarize
// ======================================================

const summarize = async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);

    if (!material) {
      return res.status(404).json({
        message: "Material not found",
      });
    }

    // Check ownership
    if (
      req.user.role !== "admin" &&
      material.user.toString() !== req.user.userId
    ) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    const prompt = `
Summarize the following study material clearly and concisely.

Use:
- Simple language
- Important points
- Bullet points
- Exam-friendly wording

Study material:

${material.content}
`;

    console.log("Generating summary...");

    const summary = await askGemini(prompt);

    material.summary = summary;

    await material.save();

    res.json({
      summary,
    });
  } catch (error) {
    console.error("Summary error:", error);

    res.status(500).json({
      message: "Failed to generate summary",
      error: error.message,
    });
  }
};

// ======================================================
// POST /api/materials/:id/flashcards
// ======================================================

const generateFlashcards = async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);

    if (!material) {
      return res.status(404).json({
        message: "Material not found",
      });
    }

    // Check ownership
    if (
      req.user.role !== "admin" &&
      material.user.toString() !== req.user.userId
    ) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    const count = Number(req.body.count) || 5;

    if (count < 1 || count > 20) {
      return res.status(400).json({
        message: "Flashcard count must be between 1 and 20",
      });
    }

    const prompt = `
Create exactly ${count} flashcards from the study material below.

Each flashcard must contain:
- question
- answer

Questions should test important concepts from the material.

Answers should be:
- Clear
- Simple
- Correct
- Easy for a student to understand

Do not create information that is not present in the study material.

Study material:

${material.content}
`;

    console.log("Generating flashcards...");

    let raw;

    try {
      raw = await askGeminiJSON(prompt);

      console.log("RAW FLASHCARD RESPONSE:");
      console.log(raw);
    } catch (error) {
      console.error("Gemini flashcard generation error:", error);

      return res.status(500).json({
        message: "Gemini flashcard generation failed",
        error: error.message,
      });
    }

    const clean = cleanJSON(raw);

    let flashcards;

    try {
      flashcards = JSON.parse(clean);
    } catch (error) {
      console.error("Gemini flashcard JSON error:", error.message);
      console.error("Gemini returned:", clean);

      return res.status(500).json({
        message: "Gemini returned invalid flashcard JSON",
      });
    }

    // Make sure Gemini returned an array
    if (!Array.isArray(flashcards)) {
      return res.status(500).json({
        message: "Gemini returned an invalid flashcard format",
      });
    }

    // Make sure every flashcard has question and answer
    const validFlashcards = flashcards.every(
      (card) =>
        card &&
        typeof card.question === "string" &&
        typeof card.answer === "string"
    );

    if (!validFlashcards) {
      return res.status(500).json({
        message: "Gemini returned incorrectly formatted flashcards",
      });
    }

    material.flashcards = flashcards;

    await material.save();

    res.json({
      message: "Flashcards generated successfully",
      flashcards,
    });
  } catch (error) {
    console.error("Flashcard error:", error);

    res.status(500).json({
      message: "Failed to generate flashcards",
      error: error.message,
    });
  }
};

// ======================================================
// POST /api/materials/:id/quiz
// ======================================================

const generateQuiz = async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);

    if (!material) {
      return res.status(404).json({
        message: "Material not found",
      });
    }

    // Check ownership
    if (
      req.user.role !== "admin" &&
      material.user.toString() !== req.user.userId
    ) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    const count = Number(req.body.count) || 5;

    if (count < 1 || count > 20) {
      return res.status(400).json({
        message: "Quiz count must be between 1 and 20",
      });
    }

    const prompt = `
Create exactly ${count} multiple-choice quiz questions from the study material below.

Each question must contain:
- question
- options
- answer

Rules:
- Each question must have exactly 4 options.
- The answer must be one of the 4 options.
- Questions must test important concepts.
- Use only information from the study material.
- Keep the questions student-friendly.

Study material:

${material.content}
`;

    console.log("Generating quiz...");

    let raw;

    try {
      raw = await askGeminiQuizJSON(prompt);

      console.log("RAW QUIZ RESPONSE:");
      console.log(raw);
    } catch (error) {
      console.error("Gemini quiz generation error:", error);

      return res.status(500).json({
        message: "Gemini quiz generation failed",
        error: error.message,
      });
    }

    const clean = cleanJSON(raw);

    let quiz;

    try {
      quiz = JSON.parse(clean);
    } catch (error) {
      console.error("Gemini quiz JSON error:", error.message);
      console.error("Gemini returned:", clean);

      return res.status(500).json({
        message: "Gemini returned invalid quiz JSON",
      });
    }

    // Make sure Gemini returned an array
    if (!Array.isArray(quiz)) {
      return res.status(500).json({
        message: "Gemini returned an invalid quiz format",
      });
    }

    // Validate quiz structure
    const validQuiz = quiz.every(
      (item) =>
        item &&
        typeof item.question === "string" &&
        Array.isArray(item.options) &&
        item.options.length === 4 &&
        typeof item.answer === "string" &&
        item.options.includes(item.answer)
    );

    if (!validQuiz) {
      return res.status(500).json({
        message: "Gemini returned incorrectly formatted quiz questions",
      });
    }

    material.quiz = quiz;

    await material.save();

    res.json({
      message: "Quiz generated successfully",
      quiz,
    });
  } catch (error) {
    console.error("Quiz error:", error);

    res.status(500).json({
      message: "Failed to generate quiz",
      error: error.message,
    });
  }
};

// ======================================================
// POST /api/materials/:id/study-plan
// ======================================================

const generateStudyPlan = async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);

    if (!material) {
      return res.status(404).json({
        message: "Material not found",
      });
    }

    // Check ownership
    if (
      req.user.role !== "admin" &&
      material.user.toString() !== req.user.userId
    ) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    const { goal, hoursPerDay, days } = req.body;

    const studyDays = Number(days) || 7;
    const studyHours = Number(hoursPerDay) || 2;

    if (studyDays < 1 || studyDays > 30) {
      return res.status(400).json({
        message: "Study plan days must be between 1 and 30",
      });
    }

    if (studyHours < 1 || studyHours > 12) {
      return res.status(400).json({
        message: "Study hours must be between 1 and 12 hours per day",
      });
    }

    const prompt = `
You are an AI study planner.

Create a personalized ${studyDays}-day study plan based ONLY on the study material provided below.

Student goal:
${goal || "Understand and retain the material"}

Available study time:
${studyHours} hours per day

For each day include:
- Topics to study
- Learning activity
- Revision activity
- Suggested practice

Keep the plan:
- Practical
- Student-friendly
- Exam-oriented
- Easy to follow

Do not introduce topics that are not related to the study material.

Study material:

${material.content}
`;

    console.log("Generating study plan...");

    const studyPlan = await askGemini(prompt);

    material.studyPlan = studyPlan;

    await material.save();

    res.json({
      studyPlan,
    });
  } catch (error) {
    console.error("Study plan error:", error);

    res.status(500).json({
      message: "Failed to generate study plan",
      error: error.message,
    });
  }
};

// ======================================================
// EXPORT CONTROLLERS
// ======================================================

module.exports = {
  uploadMaterial,
  getMaterials,
  getMaterial,
  deleteMaterial,
  summarize,
  generateFlashcards,
  generateQuiz,
  generateStudyPlan,
};