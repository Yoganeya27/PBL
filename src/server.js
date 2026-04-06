// src/server.js
import mongoose from "mongoose";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Middleware
app.use(cors({
  origin: "*" // For production, replace "*" with your frontend URL
}));
app.use(express.json({ limit: "2mb" }));

// Test routes
app.get("/", (req, res) => {
  res.send("Backend is running!");
});

app.get("/api/ping", (req, res) => {
  res.json({ message: "pong" });
});

// TODO: Import your actual API routes
// import userRoutes from "./routes/userRoutes.js";
// app.use("/api/users", userRoutes);

const PORT = Number(process.env.PORT || 5000);
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sarip";

// Connect to MongoDB and start server
async function bootstrap() {
  try {
    await mongoose.connect(MONGODB_URI, {
      // optional flags
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("MongoDB connected successfully.");

    app.listen(PORT, () => {
      console.log(`Express API running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

bootstrap();