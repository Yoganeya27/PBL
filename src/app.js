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

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

const roles = ["STUDENT", "EDUCATOR"];
const difficulties = ["EASY", "MEDIUM", "HARD"];
const questionTypes = ["MULTIPLE_CHOICE", "TRUE_FALSE", "DESCRIPTIVE"];

const userSchema = new mongoose.Schema(
  {
    userCode: { type: String, required: true, unique: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: roles, default: "STUDENT" },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } }
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
    feedbackByEducatorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
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
  { timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" } }
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
    userCode: user.userCode,
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

function isAssessmentAvailableNow(assessment) {
  const now = new Date();
  if (!assessment.active) return false;
  if (assessment.availableFrom && now < assessment.availableFrom) return false;
  if (assessment.availableUntil && now > assessment.availableUntil) return false;
  return true;
}

async function generateUserCode(role) {
  const prefix = role === "EDUCATOR" ? "ED" : "ST";
  const users = await User.find({ role }, { userCode: 1, _id: 0 }).lean();
  let maxN = -1;
  for (const u of users) {
    const m = String(u.userCode || "").match(/^\D+(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (!Number.isNaN(n)) maxN = Math.max(maxN, n);
    }
  }
  const next = maxN + 1;
  return `${prefix}${String(next).padStart(2, "0")}`;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/register", async (req, res) => {
  const { fullName, email, password, role } = req.body || {};
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: "fullName, email and password are required" });
  }
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (role && !roles.includes(role)) return res.status(400).json({ error: "Invalid role" });

  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail }).lean();
  if (existing) return res.status(409).json({ error: "Email already in use" });

  const selectedRole = role || "STUDENT";
  const passwordHash = await bcrypt.hash(password, 10);

  let user;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const userCode = await generateUserCode(selectedRole);
      user = await User.create({
        userCode,
        fullName: String(fullName).trim(),
        email: normalizedEmail,
        passwordHash,
        role: selectedRole,
      });
      break;
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }
  }
  if (!user) return res.status(500).json({ error: "Could not create user. Please try again." });

  const token = createToken(user);
  return res.status(201).json({ ...toUserDto(user), token });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });

  const user = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  return res.json({ ...toUserDto(user), token: createToken(user) });
});

app.get("/api/assessments", authRequired, async (req, res) => {
  const query = {};
  if (req.query.category) query.category = req.query.category;
  if (req.query.difficulty) query.difficulty = req.query.difficulty;
  if (req.userRole === "STUDENT") query.active = true;

  const list = await Assessment.find(query).sort({ createdAt: -1 });
  if (req.userRole !== "STUDENT") {
    return res.json(list.map((a) => toAssessmentDto(a, true)));
  }

  const attemptRows = await StudentAssessment.find({ studentId: req.userId }, { assessmentId: 1, submittedAt: 1 }).lean();
  const attemptedMap = new Map(attemptRows.map((r) => [toId(r.assessmentId), !!r.submittedAt]));
  return res.json(
    list
      .filter((a) => isAssessmentAvailableNow(a))
      .map((a) => ({ ...toAssessmentDto(a, false), attempted: attemptedMap.get(toId(a._id)) || false }))
  );
});

app.get("/api/assessments/:id", authRequired, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid assessment id" });
  const a = await Assessment.findById(req.params.id);
  if (!a) return res.status(404).json({ error: "Assessment not found" });
  if (req.userRole === "STUDENT" && !isAssessmentAvailableNow(a)) {
    return res.status(403).json({ error: "Assessment is not available right now" });
  }
  return res.json(toAssessmentDto(a, req.userRole === "EDUCATOR"));
});

app.get("/api/assessments/:id/attempt", authRequired, requireRole("STUDENT"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid assessment id" });
  const a = await Assessment.findById(req.params.id);
  if (!a) return res.status(404).json({ error: "Assessment not found" });
  if (!isAssessmentAvailableNow(a)) return res.status(403).json({ error: "Assessment is not active currently" });

  const existing = await StudentAssessment.findOne({ studentId: req.userId, assessmentId: a._id });
  if (existing?.submittedAt) {
    return res.status(403).json({ error: "You can attempt this test only once" });
  }
  return res.json(toAssessmentDto(a, false));
});

app.post("/api/students/assessments/:assessmentId/start", authRequired, requireRole("STUDENT"), async (req, res) => {
  const { assessmentId } = req.params;
  if (!mongoose.isValidObjectId(assessmentId)) return res.status(400).json({ error: "Invalid assessment id" });
  const assessment = await Assessment.findById(assessmentId);
  if (!assessment) return res.status(404).json({ error: "Assessment not found" });
  if (!isAssessmentAvailableNow(assessment)) return res.status(403).json({ error: "Assessment is not active currently" });

  const existing = await StudentAssessment.findOne({ studentId: req.userId, assessmentId });
  if (existing?.submittedAt) return res.status(403).json({ error: "You can attempt this test only once" });
  if (existing) return res.json({ attemptId: toId(existing._id), startedAt: existing.startedAt });

  const attempt = await StudentAssessment.create({ studentId: req.userId, assessmentId, startedAt: new Date() });
  return res.status(201).json({ attemptId: toId(attempt._id), startedAt: attempt.startedAt });
});

app.post("/api/students/attempts/:attemptId/submit", authRequired, requireRole("STUDENT"), async (req, res) => {
  const { attemptId } = req.params;
  if (!mongoose.isValidObjectId(attemptId)) return res.status(400).json({ error: "Invalid attempt id" });
  const attempt = await StudentAssessment.findById(attemptId);
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  if (toId(attempt.studentId) !== req.userId) return res.status(403).json({ error: "Forbidden" });
  if (attempt.submittedAt) return res.status(409).json({ error: "Attempt already submitted" });

  const assessment = await Assessment.findById(attempt.assessmentId);
  if (!assessment) return res.status(404).json({ error: "Assessment not found" });

  const expiresAt = new Date(new Date(attempt.startedAt).getTime() + (assessment.durationMinutes || 30) * 60 * 1000);
  if (new Date() > expiresAt) return res.status(403).json({ error: "Time is over for this test" });

  const answers = req.body?.answers || {};
  let score = 0;
  let maxScore = 0;
  for (const q of assessment.questions || []) {
    const pts = q.points ?? 1;
    maxScore += pts;
    const submitted = answers[toId(q._id)] ?? answers[String(q._id)];
    if (checkAnswer(q, submitted)) score += pts;
  }
  const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;

  attempt.answers = answers;
  attempt.score = score;
  attempt.maxScore = maxScore;
  attempt.percentage = percentage;
  attempt.submittedAt = new Date();
  await attempt.save();

  return res.json({
    attemptId: toId(attempt._id),
    score,
    maxScore,
    percentage,
    submittedAt: attempt.submittedAt,
  });
});

app.get("/api/students/attempts", authRequired, requireRole("STUDENT"), async (req, res) => {
  const attempts = await StudentAssessment.find({ studentId: req.userId, submittedAt: { $ne: null } })
    .sort({ submittedAt: -1 })
    .lean();
  const assessmentIds = attempts.map((a) => a.assessmentId);
  const feedbackIds = attempts.map((a) => a.feedbackByEducatorId).filter(Boolean);
  const assessments = await Assessment.find({ _id: { $in: assessmentIds } }).lean();
  const users = feedbackIds.length ? await User.find({ _id: { $in: feedbackIds } }).lean() : [];
  const assessmentMap = new Map(assessments.map((a) => [toId(a._id), a]));
  const feedbackMap = new Map(users.map((u) => [toId(u._id), u]));
  return res.json(attempts.map((sa) => toAttemptSummaryDto(sa, assessmentMap.get(toId(sa.assessmentId)), feedbackMap.get(toId(sa.feedbackByEducatorId)))));
});

app.get("/api/students/progress", authRequired, requireRole("STUDENT"), async (req, res) => {
  const attempts = await StudentAssessment.find({ studentId: req.userId, submittedAt: { $ne: null } }).sort({ submittedAt: -1 }).lean();
  const assessmentIds = attempts.map((a) => a.assessmentId);
  const feedbackIds = attempts.map((a) => a.feedbackByEducatorId).filter(Boolean);
  const assessments = await Assessment.find({ _id: { $in: assessmentIds } }).lean();
  const users = feedbackIds.length ? await User.find({ _id: { $in: feedbackIds } }).lean() : [];
  const assessmentMap = new Map(assessments.map((a) => [toId(a._id), a]));
  const feedbackMap = new Map(users.map((u) => [toId(u._id), u]));
  const summary = attempts.map((sa) => toAttemptSummaryDto(sa, assessmentMap.get(toId(sa.assessmentId)), feedbackMap.get(toId(sa.feedbackByEducatorId))));
  const readinessIndex = summary.length ? summary.reduce((acc, a) => acc + (a.percentage || 0), 0) / summary.length : 0;
  return res.json({ readinessIndex, attempts: summary });
});

app.get("/api/students/readiness-index", authRequired, requireRole("STUDENT"), async (req, res) => {
  const attempts = await StudentAssessment.find({ studentId: req.userId, submittedAt: { $ne: null } }, { percentage: 1 }).lean();
  const readinessIndex = attempts.length ? attempts.reduce((acc, a) => acc + (a.percentage || 0), 0) / attempts.length : 0;
  return res.json({ readinessIndex });
});

app.get("/api/students/analytics/trend", authRequired, requireRole("STUDENT"), async (req, res) => {
  const attempts = await StudentAssessment.find({ studentId: req.userId, submittedAt: { $ne: null } })
    .sort({ submittedAt: -1 })
    .limit(12)
    .lean();
  return res.json(
    attempts.map((a) => ({
      id: toId(a._id),
      percentage: a.percentage ?? 0,
      submittedAt: a.submittedAt,
    }))
  );
});

app.get("/api/students/recommendations", authRequired, requireRole("STUDENT"), async (req, res) => {
  const submitted = await StudentAssessment.find({ studentId: req.userId, submittedAt: { $ne: null } }, { assessmentId: 1 }).lean();
  const submittedSet = new Set(submitted.map((s) => toId(s.assessmentId)));
  const assessments = await Assessment.find({ active: true }).sort({ createdAt: -1 }).lean();
  return res.json(
    assessments
      .filter((a) => isAssessmentAvailableNow(a) && !submittedSet.has(toId(a._id)))
      .slice(0, 8)
      .map((a) => toAssessmentDto(a, false))
  );
});

app.get("/api/notifications", authRequired, async (req, res) => {
  const rows = await Notification.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
  return res.json(rows.map((n) => ({ id: toId(n._id), title: n.title, message: n.message, type: n.type, read: n.read, createdAt: n.createdAt })));
});

app.patch("/api/notifications/:id/read", authRequired, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid notification id" });
  const row = await Notification.findById(req.params.id);
  if (!row) return res.status(404).json({ error: "Notification not found" });
  if (toId(row.userId) !== req.userId) return res.status(403).json({ error: "Forbidden" });
  row.read = true;
  await row.save();
  return res.json({ ok: true });
});

app.get("/api/admin/stats", authRequired, requireRole("EDUCATOR"), async (_req, res) => {
  const [totalUsers, totalStudents, totalEducators, totalAssessments, activeAssessments, totalAttempts] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ role: "STUDENT" }),
    User.countDocuments({ role: "EDUCATOR" }),
    Assessment.countDocuments({}),
    Assessment.countDocuments({ active: true }),
    StudentAssessment.countDocuments({ submittedAt: { $ne: null } }),
  ]);
  return res.json({ totalUsers, totalStudents, totalEducators, totalAssessments, activeAssessments, totalAttempts });
});

app.get("/api/admin/users", authRequired, requireRole("EDUCATOR"), async (_req, res) => {
  const users = await User.find({ role: { $in: roles } }).sort({ createdAt: -1 });
  return res.json(users.map((u) => toUserDto(u)));
});

app.get("/api/admin/assessments", authRequired, requireRole("EDUCATOR"), async (_req, res) => {
  const rows = await Assessment.find({}).sort({ createdAt: -1 });
  return res.json(rows.map((a) => toAssessmentDto(a, true)));
});

app.get("/api/admin/assessments/:id", authRequired, requireRole("EDUCATOR"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid assessment id" });
  const row = await Assessment.findById(req.params.id);
  if (!row) return res.status(404).json({ error: "Assessment not found" });
  return res.json(toAssessmentDto(row, true));
});

app.post("/api/admin/assessments", authRequired, requireRole("EDUCATOR"), async (req, res) => {
  const data = req.body || {};
  if (!data.title) return res.status(400).json({ error: "title is required" });
  const created = await Assessment.create({
    title: data.title,
    description: data.description || "",
    category: data.category || "",
    difficulty: difficulties.includes(data.difficulty) ? data.difficulty : "MEDIUM",
    durationMinutes: Number(data.durationMinutes || 30),
    resourceLinks: Array.isArray(data.resourceLinks) ? data.resourceLinks.filter(Boolean) : [],
    availableFrom: data.availableFrom ? new Date(data.availableFrom) : null,
    availableUntil: data.availableUntil ? new Date(data.availableUntil) : null,
    active: data.active ?? true,
    practice: !!data.practice,
    createdBy: req.userId,
    questions: Array.isArray(data.questions) ? data.questions : [],
  });
  return res.status(201).json(toAssessmentDto(created, true));
});

app.put("/api/admin/assessments/:id", authRequired, requireRole("EDUCATOR"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid assessment id" });
  const data = req.body || {};
  const row = await Assessment.findById(req.params.id);
  if (!row) return res.status(404).json({ error: "Assessment not found" });

  row.title = data.title ?? row.title;
  row.description = data.description ?? row.description;
  row.category = data.category ?? row.category;
  row.difficulty = difficulties.includes(data.difficulty) ? data.difficulty : row.difficulty;
  row.durationMinutes = Number(data.durationMinutes ?? row.durationMinutes);
  row.resourceLinks = Array.isArray(data.resourceLinks) ? data.resourceLinks.filter(Boolean) : row.resourceLinks;
  row.availableFrom = data.availableFrom ? new Date(data.availableFrom) : null;
  row.availableUntil = data.availableUntil ? new Date(data.availableUntil) : null;
  row.practice = data.practice != null ? !!data.practice : row.practice;
  row.questions = Array.isArray(data.questions) ? data.questions : row.questions;
  await row.save();
  return res.json(toAssessmentDto(row, true));
});

app.delete("/api/admin/assessments/:id", authRequired, requireRole("EDUCATOR"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid assessment id" });
  await Assessment.findByIdAndDelete(req.params.id);
  await StudentAssessment.deleteMany({ assessmentId: req.params.id });
  return res.json({ ok: true });
});

app.patch("/api/admin/assessments/:id/active", authRequired, requireRole("EDUCATOR"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid assessment id" });
  const row = await Assessment.findById(req.params.id);
  if (!row) return res.status(404).json({ error: "Assessment not found" });
  row.active = String(req.query.active) === "true";
  await row.save();
  return res.json({ ok: true });
});

app.get("/api/admin/analytics/assessments", authRequired, requireRole("EDUCATOR"), async (_req, res) => {
  const attempts = await StudentAssessment.find({ submittedAt: { $ne: null } }).lean();
  const assessments = await Assessment.find({}).lean();
  const byAssessment = new Map();
  for (const a of attempts) {
    const key = toId(a.assessmentId);
    if (!byAssessment.has(key)) byAssessment.set(key, []);
    byAssessment.get(key).push(a);
  }
  const rows = assessments.map((a) => {
    const att = byAssessment.get(toId(a._id)) || [];
    const attemptsCount = att.length;
    const averagePercentage = attemptsCount ? att.reduce((sum, x) => sum + (x.percentage || 0), 0) / attemptsCount : null;
    const averageScore = attemptsCount ? att.reduce((sum, x) => sum + (x.score || 0), 0) / attemptsCount : null;
    return { assessmentId: toId(a._id), title: a.title, attemptsCount, averagePercentage, averageScore };
  });
  rows.sort((x, y) => {
    const xv = x.averagePercentage == null ? Number.POSITIVE_INFINITY : x.averagePercentage;
    const yv = y.averagePercentage == null ? Number.POSITIVE_INFINITY : y.averagePercentage;
    return xv - yv;
  });
  return res.json(rows);
});

app.get("/api/admin/assessments/:assessmentId/attempts", authRequired, requireRole("EDUCATOR"), async (req, res) => {
  const { assessmentId } = req.params;
  if (!mongoose.isValidObjectId(assessmentId)) return res.status(400).json({ error: "Invalid assessment id" });
  const rows = await StudentAssessment.find({ assessmentId, submittedAt: { $ne: null } }).sort({ submittedAt: -1 }).lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.studentId) } }).lean();
  const userMap = new Map(users.map((u) => [toId(u._id), u]));
  return res.json(
    rows.map((r) => ({
      id: toId(r._id),
      studentId: toId(r.studentId),
      studentName: userMap.get(toId(r.studentId))?.fullName || "Unknown",
      studentCode: userMap.get(toId(r.studentId))?.userCode || "",
      score: r.score,
      maxScore: r.maxScore,
      percentage: r.percentage,
      submittedAt: r.submittedAt,
      feedback: r.feedback || "",
      feedbackGivenAt: r.feedbackGivenAt,
    }))
  );
});

app.put("/api/admin/attempts/:attemptId/feedback", authRequired, requireRole("EDUCATOR"), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.attemptId)) return res.status(400).json({ error: "Invalid attempt id" });
  const attempt = await StudentAssessment.findById(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  attempt.feedback = String(req.body?.feedback || "");
  attempt.feedbackGivenAt = new Date();
  attempt.feedbackByEducatorId = req.userId;
  await attempt.save();

  await createNotification(
    attempt.studentId,
    "New feedback from educator",
    "Your assessment has received new feedback. Please check your dashboard.",
    "FEEDBACK"
  );
  return res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  return res.status(500).json({ error: err.message || "Unexpected server error" });
});

export default app;