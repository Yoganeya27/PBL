import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.PORT || 5000);
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sarip";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

const roles = ["STUDENT", "EDUCATOR", "ADMIN"];
const difficulties = ["EASY", "MEDIUM", "HARD"];
const questionTypes = ["MULTIPLE_CHOICE", "TRUE_FALSE", "DESCRIPTIVE"];

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: roles, default: "STUDENT" },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } },
);

const questionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    type: { type: String, enum: questionTypes, default: "MULTIPLE_CHOICE" },
    orderIndex: { type: Number, default: 0 },
    options: { type: [String], default: [] },
    correctAnswer: { type: String, default: "" },
    points: { type: Number, default: 1 },
  },
  { _id: true },
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
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } },
);

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
  { timestamps: true },
);
studentAssessmentSchema.index({ studentId: 1, assessmentId: 1 }, { unique: true });

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, default: "GENERAL" },
    read: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } },
);

const User = mongoose.model("User", userSchema);
const Assessment = mongoose.model("Assessment", assessmentSchema);
const StudentAssessment = mongoose.model("StudentAssessment", studentAssessmentSchema);
const Notification = mongoose.model("Notification", notificationSchema);

function toId(value) {
  return value ? String(value) : null;
}

function toUserDto(user) {
  return {
    id: toId(user._id),
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function toQuestionDto(q, includeAnswer = true) {
  return {
    id: toId(q._id),
    text: q.text,
    type: q.type,
    orderIndex: q.orderIndex,
    options: q.options || [],
    points: q.points ?? 1,
    ...(includeAnswer ? { correctAnswer: q.correctAnswer || "" } : {}),
  };
}

function toAssessmentDto(a, includeAnswers = true) {
  return {
    id: toId(a._id),
    title: a.title,
    description: a.description || "",
    category: a.category || "",
    difficulty: a.difficulty || "MEDIUM",
    durationMinutes: a.durationMinutes ?? 30,
    resourceLinks: a.resourceLinks || [],
    availableFrom: a.availableFrom,
    availableUntil: a.availableUntil,
    active: !!a.active,
    practice: !!a.practice,
    questionCount: (a.questions || []).length,
    questions: (a.questions || [])
      .slice()
      .sort((x, y) => (x.orderIndex ?? 0) - (y.orderIndex ?? 0))
      .map((q) => toQuestionDto(q, includeAnswers)),
  };
}

function toAttemptSummaryDto(sa, assessment, feedbackByUser) {
  return {
    id: toId(sa._id),
    assessmentId: toId(sa.assessmentId),
    assessmentTitle: assessment?.title || "Unknown",
    practice: !!assessment?.practice,
    score: sa.score,
    maxScore: sa.maxScore,
    percentage: sa.percentage,
    submittedAt: sa.submittedAt,
    feedback: sa.feedback || "",
    feedbackGivenAt: sa.feedbackGivenAt,
    feedbackByAdminName: feedbackByUser?.fullName || null,
  };
}

function createToken(user) {
  return jwt.sign({ userId: toId(user._id), role: user.role }, JWT_SECRET, { expiresIn: "7d" });
}

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    req.userRole = payload.role;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.userRole)) return res.status(403).json({ error: "Forbidden" });
    return next();
  };
}

async function createNotification(userId, title, message, type = "GENERAL") {
  await Notification.create({ userId, title, message, type, read: false });
}

function checkAnswer(question, studentAnswer) {
  if (studentAnswer == null || question.correctAnswer == null) return false;
  return String(studentAnswer).trim().toLowerCase() === String(question.correctAnswer).trim().toLowerCase();
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { fullName, email, password, role } = req.body || {};
    if (!fullName || !email || !password) return res.status(400).json({ error: "fullName, email, password are required" });
    if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    const normalizedRole = roles.includes(role) ? role : "STUDENT";
    const exists = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (exists) return res.status(409).json({ error: "Email already registered" });
    const passwordHash = await bcrypt.hash(String(password), 10);
    const user = await User.create({
      fullName: String(fullName).trim(),
      email: String(email).toLowerCase().trim(),
      passwordHash,
      role: normalizedRole,
    });
    const token = createToken(user);
    return res.status(201).json({ ...toUserDto(user), token });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Registration failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await User.findOne({ email: String(email || "").toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    const valid = await bcrypt.compare(String(password || ""), user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });
    const token = createToken(user);
    return res.json({ ...toUserDto(user), token });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Login failed" });
  }
});

app.get("/api/assessments", authRequired, async (req, res) => {
  try {
    const filter = { active: true };
    if (req.query.category) filter.category = req.query.category;
    if (req.query.difficulty) filter.difficulty = req.query.difficulty;
    const list = await Assessment.find(filter).sort({ createdAt: -1 });
    return res.json(list.map((a) => toAssessmentDto(a, true)));
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unable to fetch assessments" });
  }
});

app.get("/api/assessments/:id", authRequired, async (req, res) => {
  const assessment = await Assessment.findById(req.params.id);
  if (!assessment) return res.status(404).json({ error: "Assessment not found" });
  return res.json(toAssessmentDto(assessment, true));
});

app.get("/api/assessments/:id/attempt", authRequired, async (req, res) => {
  const assessment = await Assessment.findById(req.params.id);
  if (!assessment) return res.status(404).json({ error: "Assessment not found" });
  return res.json(toAssessmentDto(assessment, false));
});

app.get("/api/admin/stats", authRequired, requireRole("EDUCATOR", "ADMIN"), async (_req, res) => {
  const [totalUsers, totalStudents, totalAssessments, activeAssessments, totalAttempts] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ role: "STUDENT" }),
    Assessment.countDocuments({}),
    Assessment.countDocuments({ active: true }),
    StudentAssessment.countDocuments({ submittedAt: { $ne: null } }),
  ]);
  return res.json({ totalUsers, totalStudents, totalAssessments, activeAssessments, totalAttempts });
});

app.get("/api/admin/users", authRequired, requireRole("EDUCATOR", "ADMIN"), async (_req, res) => {
  const users = await User.find({}).sort({ createdAt: -1 });
  return res.json(users.map(toUserDto));
});

app.get("/api/admin/assessments", authRequired, requireRole("EDUCATOR", "ADMIN"), async (_req, res) => {
  const list = await Assessment.find({}).sort({ createdAt: -1 });
  return res.json(list.map((a) => toAssessmentDto(a, true)));
});

app.get("/api/admin/assessments/:id", authRequired, requireRole("EDUCATOR", "ADMIN"), async (req, res) => {
  const assessment = await Assessment.findById(req.params.id);
  if (!assessment) return res.status(404).json({ error: "Assessment not found" });
  return res.json(toAssessmentDto(assessment, true));
});

app.post("/api/admin/assessments", authRequired, requireRole("EDUCATOR", "ADMIN"), async (req, res) => {
  try {
    const body = req.body || {};
    const questions = (body.questions || []).map((q, idx) => ({
      text: q.text || "",
      type: questionTypes.includes(q.type) ? q.type : "MULTIPLE_CHOICE",
      orderIndex: Number.isFinite(q.orderIndex) ? q.orderIndex : idx,
      options: Array.isArray(q.options) ? q.options : [],
      correctAnswer: q.correctAnswer || "",
      points: Number.isFinite(q.points) ? q.points : 1,
    }));
    const assessment = await Assessment.create({
      title: body.title || "Untitled",
      description: body.description || "",
      category: body.category || "",
      difficulty: difficulties.includes(body.difficulty) ? body.difficulty : "MEDIUM",
      durationMinutes: Number.isFinite(body.durationMinutes) ? body.durationMinutes : 30,
      resourceLinks: Array.isArray(body.resourceLinks) ? body.resourceLinks : [],
      availableFrom: body.availableFrom ? new Date(body.availableFrom) : null,
      availableUntil: body.availableUntil ? new Date(body.availableUntil) : null,
      active: body.active ?? true,
      practice: !!body.practice,
      createdBy: req.userId,
      questions,
    });
    return res.status(201).json(toAssessmentDto(assessment, true));
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unable to create assessment" });
  }
});

app.put("/api/admin/assessments/:id", authRequired, requireRole("EDUCATOR", "ADMIN"), async (req, res) => {
  try {
    const body = req.body || {};
    const questions = (body.questions || []).map((q, idx) => ({
      _id: q.id || undefined,
      text: q.text || "",
      type: questionTypes.includes(q.type) ? q.type : "MULTIPLE_CHOICE",
      orderIndex: Number.isFinite(q.orderIndex) ? q.orderIndex : idx,
      options: Array.isArray(q.options) ? q.options : [],
      correctAnswer: q.correctAnswer || "",
      points: Number.isFinite(q.points) ? q.points : 1,
    }));
    const updated = await Assessment.findByIdAndUpdate(
      req.params.id,
      {
        title: body.title || "Untitled",
        description: body.description || "",
        category: body.category || "",
        difficulty: difficulties.includes(body.difficulty) ? body.difficulty : "MEDIUM",
        durationMinutes: Number.isFinite(body.durationMinutes) ? body.durationMinutes : 30,
        resourceLinks: Array.isArray(body.resourceLinks) ? body.resourceLinks : [],
        availableFrom: body.availableFrom ? new Date(body.availableFrom) : null,
        availableUntil: body.availableUntil ? new Date(body.availableUntil) : null,
        practice: !!body.practice,
        questions,
      },
      { new: true },
    );
    if (!updated) return res.status(404).json({ error: "Assessment not found" });
    return res.json(toAssessmentDto(updated, true));
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unable to update assessment" });
  }
});

app.delete("/api/admin/assessments/:id", authRequired, requireRole("EDUCATOR", "ADMIN"), async (req, res) => {
  const deleted = await Assessment.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Assessment not found" });
  await StudentAssessment.deleteMany({ assessmentId: req.params.id });
  return res.status(204).send();
});

app.patch("/api/admin/assessments/:id/active", authRequired, requireRole("EDUCATOR", "ADMIN"), async (req, res) => {
  const active = String(req.query.active) === "true";
  const updated = await Assessment.findByIdAndUpdate(req.params.id, { active }, { new: true });
  if (!updated) return res.status(404).json({ error: "Assessment not found" });
  return res.json({ success: true });
});

app.get("/api/admin/analytics/assessments", authRequired, requireRole("EDUCATOR", "ADMIN"), async (_req, res) => {
  const assessments = await Assessment.find({});
  const rows = [];
  for (const assessment of assessments) {
    const attempts = await StudentAssessment.find({
      assessmentId: assessment._id,
      submittedAt: { $ne: null },
      percentage: { $ne: null },
    });
    const count = attempts.length;
    const avgPct = count ? attempts.reduce((acc, it) => acc + (it.percentage || 0), 0) / count : 0;
    const avgScore = count ? attempts.reduce((acc, it) => acc + (it.score || 0), 0) / count : 0;
    rows.push({
      assessmentId: toId(assessment._id),
      title: assessment.title,
      attemptsCount: count,
      averagePercentage: avgPct,
      averageScore: avgScore,
    });
  }
  rows.sort((a, b) => a.averagePercentage - b.averagePercentage);
  return res.json(rows);
});

app.get("/api/admin/assessments/:assessmentId/attempts", authRequired, requireRole("EDUCATOR", "ADMIN"), async (req, res) => {
  const attempts = await StudentAssessment.find({
    assessmentId: req.params.assessmentId,
    submittedAt: { $ne: null },
  }).sort({ submittedAt: -1 });
  const usersById = new Map();
  const userIds = [...new Set(attempts.map((a) => toId(a.studentId)))];
  const users = await User.find({ _id: { $in: userIds } });
  users.forEach((u) => usersById.set(toId(u._id), u));
  return res.json(
    attempts.map((a) => ({
      id: toId(a._id),
      studentId: toId(a.studentId),
      studentName: usersById.get(toId(a.studentId))?.fullName || "Unknown",
      score: a.score,
      maxScore: a.maxScore,
      percentage: a.percentage,
      submittedAt: a.submittedAt,
      feedback: a.feedback || "",
      feedbackGivenAt: a.feedbackGivenAt,
    })),
  );
});

app.put("/api/admin/attempts/:attemptId/feedback", authRequired, requireRole("EDUCATOR", "ADMIN"), async (req, res) => {
  const attempt = await StudentAssessment.findById(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  if (!attempt.submittedAt) return res.status(400).json({ error: "Cannot give feedback on unsubmitted attempt" });
  attempt.feedback = String(req.body?.feedback || "").trim();
  attempt.feedbackGivenAt = new Date();
  attempt.feedbackByAdminId = req.userId;
  await attempt.save();
  await createNotification(
    attempt.studentId,
    "New feedback",
    "You have received feedback on your assessment attempt.",
    "FEEDBACK",
  );
  return res.json({ success: true });
});

app.get("/api/students/progress", authRequired, requireRole("STUDENT"), async (req, res) => {
  const user = await User.findById(req.userId);
  const attempts = await StudentAssessment.find({ studentId: req.userId }).sort({ submittedAt: -1 });
  const completed = attempts.filter((a) => !!a.submittedAt);
  const assessmentIds = [...new Set(completed.map((a) => toId(a.assessmentId)))];
  const feedbackIds = [...new Set(completed.filter((a) => !!a.feedbackByAdminId).map((a) => toId(a.feedbackByAdminId)))];
  const [assessments, feedbackUsers] = await Promise.all([
    Assessment.find({ _id: { $in: assessmentIds } }),
    User.find({ _id: { $in: feedbackIds } }),
  ]);
  const assessmentsMap = new Map(assessments.map((a) => [toId(a._id), a]));
  const feedbackMap = new Map(feedbackUsers.map((u) => [toId(u._id), u]));
  const summaries = completed.map((sa) =>
    toAttemptSummaryDto(sa, assessmentsMap.get(toId(sa.assessmentId)), feedbackMap.get(toId(sa.feedbackByAdminId))),
  );
  const readinessIndex = summaries.length
    ? summaries.reduce((acc, it) => acc + (it.percentage || 0), 0) / summaries.length
    : 0;
  return res.json({
    studentId: toId(user?._id),
    studentName: user?.fullName || "",
    readinessIndex,
    attempts: summaries,
    totalAttempts: summaries.length,
  });
});

app.get("/api/students/recommendations", authRequired, requireRole("STUDENT"), async (req, res) => {
  const [active, attempts] = await Promise.all([
    Assessment.find({ active: true }).sort({ createdAt: -1 }),
    StudentAssessment.find({ studentId: req.userId, submittedAt: { $ne: null } }),
  ]);
  const completedIds = new Set(attempts.map((a) => toId(a.assessmentId)));
  const recs = active.filter((a) => !completedIds.has(toId(a._id))).slice(0, 5);
  return res.json(recs.map((a) => toAssessmentDto(a, true)));
});

app.post("/api/students/assessments/:assessmentId/start", authRequired, requireRole("STUDENT"), async (req, res) => {
  const assessment = await Assessment.findById(req.params.assessmentId);
  if (!assessment) return res.status(404).json({ error: "Assessment not found" });
  if (!assessment.active) return res.status(400).json({ error: "Assessment is not available" });
  const now = new Date();
  if (assessment.availableFrom && now < assessment.availableFrom) return res.status(400).json({ error: "Assessment is not yet available" });
  if (assessment.availableUntil && now > assessment.availableUntil) return res.status(400).json({ error: "Assessment is no longer available" });
  const existing = await StudentAssessment.findOne({ studentId: req.userId, assessmentId: assessment._id });
  if (existing) {
    if (existing.submittedAt) return res.status(400).json({ error: "You have already submitted this assessment" });
    return res.json({ attemptId: toId(existing._id), assessmentId: toId(assessment._id), startedAt: existing.startedAt });
  }
  const sa = await StudentAssessment.create({
    studentId: req.userId,
    assessmentId: assessment._id,
    startedAt: new Date(),
  });
  return res.json({ attemptId: toId(sa._id), assessmentId: toId(assessment._id), startedAt: sa.startedAt });
});

app.post("/api/students/attempts/:attemptId/submit", authRequired, requireRole("STUDENT"), async (req, res) => {
  const sa = await StudentAssessment.findById(req.params.attemptId);
  if (!sa) return res.status(404).json({ error: "Attempt not found" });
  if (toId(sa.studentId) !== req.userId) return res.status(403).json({ error: "Not your attempt" });
  if (sa.submittedAt) return res.status(400).json({ error: "Already submitted" });
  const assessment = await Assessment.findById(sa.assessmentId);
  if (!assessment) return res.status(404).json({ error: "Assessment not found" });
  const answers = req.body?.answers || {};
  const questions = (assessment.questions || []).slice().sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  let totalScore = 0;
  let maxScore = 0;
  questions.forEach((q) => {
    const qid = toId(q._id);
    const answer = answers[qid];
    const points = q.points ?? 1;
    maxScore += points;
    if (checkAnswer(q, answer)) totalScore += points;
  });
  const percentage = maxScore > 0 ? (100 * totalScore) / maxScore : 0;
  sa.answers = answers;
  sa.score = totalScore;
  sa.maxScore = maxScore;
  sa.percentage = percentage;
  sa.submittedAt = new Date();
  await sa.save();
  return res.json({
    attemptId: toId(sa._id),
    score: totalScore,
    maxScore,
    percentage,
    submittedAt: sa.submittedAt,
  });
});

app.get("/api/students/attempts", authRequired, requireRole("STUDENT"), async (req, res) => {
  const attempts = await StudentAssessment.find({ studentId: req.userId, submittedAt: { $ne: null } }).sort({ submittedAt: -1 });
  const assessmentIds = [...new Set(attempts.map((a) => toId(a.assessmentId)))];
  const feedbackIds = [...new Set(attempts.filter((a) => !!a.feedbackByAdminId).map((a) => toId(a.feedbackByAdminId)))];
  const [assessments, feedbackUsers] = await Promise.all([
    Assessment.find({ _id: { $in: assessmentIds } }),
    User.find({ _id: { $in: feedbackIds } }),
  ]);
  const assessmentsMap = new Map(assessments.map((a) => [toId(a._id), a]));
  const feedbackMap = new Map(feedbackUsers.map((u) => [toId(u._id), u]));
  return res.json(
    attempts.map((sa) =>
      toAttemptSummaryDto(sa, assessmentsMap.get(toId(sa.assessmentId)), feedbackMap.get(toId(sa.feedbackByAdminId))),
    ),
  );
});

app.get("/api/students/readiness-index", authRequired, requireRole("STUDENT"), async (req, res) => {
  const attempts = await StudentAssessment.find({
    studentId: req.userId,
    submittedAt: { $ne: null },
    percentage: { $ne: null },
  });
  const readinessIndex = attempts.length
    ? attempts.reduce((acc, it) => acc + (it.percentage || 0), 0) / attempts.length
    : 0;
  return res.json({ readinessIndex });
});

app.get("/api/students/analytics/trend", authRequired, requireRole("STUDENT"), async (req, res) => {
  const attempts = await StudentAssessment.find({
    studentId: req.userId,
    submittedAt: { $ne: null },
    percentage: { $ne: null },
  })
    .sort({ submittedAt: -1 })
    .limit(10);
  const assessments = await Assessment.find({ _id: { $in: [...new Set(attempts.map((a) => toId(a.assessmentId)))] } });
  const titleMap = new Map(assessments.map((a) => [toId(a._id), a.title]));
  return res.json(
    attempts.map((a) => ({
      submittedAt: a.submittedAt,
      percentage: a.percentage,
      assessmentTitle: titleMap.get(toId(a.assessmentId)) || "",
    })),
  );
});

app.get("/api/notifications", authRequired, async (req, res) => {
  const rows = await Notification.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50);
  return res.json(
    rows.map((n) => ({
      id: toId(n._id),
      title: n.title,
      message: n.message,
      type: n.type,
      read: !!n.read,
      createdAt: n.createdAt,
    })),
  );
});

app.patch("/api/notifications/:id/read", authRequired, async (req, res) => {
  const notif = await Notification.findById(req.params.id);
  if (!notif) return res.status(404).json({ error: "Notification not found" });
  if (toId(notif.userId) !== req.userId) return res.status(403).json({ error: "Forbidden" });
  notif.read = true;
  await notif.save();
  return res.json({ success: true });
});

app.use((err, _req, res, _next) => {
  return res.status(500).json({ error: err.message || "Unexpected server error" });
});

async function bootstrap() {
  await mongoose.connect(MONGODB_URI);
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Express API running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", err);
  process.exit(1);
});
