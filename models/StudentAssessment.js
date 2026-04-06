import mongoose from "mongoose";

const studentAssessmentSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Assessment", required: true },
    answers: { type: Map, of: String, default: {} },
    score: { type: Number, default: null },
    maxScore: { type: Number, default: null },
    percentage: { type: Number, default: null },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },
    feedback: { type: String, default: "" },
    feedbackGivenAt: { type: Date, default: null },
    feedbackByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

studentAssessmentSchema.index({ studentId: 1, assessmentId: 1 }, { unique: true });

export default mongoose.model("StudentAssessment", studentAssessmentSchema);