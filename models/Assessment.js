import mongoose from "mongoose";

const difficulties = ["EASY", "MEDIUM", "HARD"];
const questionTypes = ["MULTIPLE_CHOICE", "TRUE_FALSE", "DESCRIPTIVE"];

const questionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    type: { type: String, enum: questionTypes, default: "MULTIPLE_CHOICE" },
    orderIndex: { type: Number, default: 0 },
    options: { type: [String], default: [] },
    correctAnswer: { type: String, default: "" },
    points: { type: Number, default: 1 },
  },
  { _id: true }
);

const assessmentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    category: { type: String, default: "" },
    difficulty: { type: String, enum: difficulties, default: "MEDIUM" },
    durationMinutes: { type: Number, default: 30 },
    resourceLinks: { type: [String], default: [] },
    availableFrom: { type: Date, default: null },
    availableUntil: { type: Date, default: null },
    active: { type: Boolean, default: true },
    practice: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    questions: { type: [questionSchema], default: [] },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } }
);

export default mongoose.model("Assessment", assessmentSchema);