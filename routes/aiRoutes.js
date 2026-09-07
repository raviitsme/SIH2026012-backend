const express = require("express");
const router = express.Router();
const multer = require("multer");
const { traceBoundary } = require("../controllers/aiController");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// POST /api/ai/trace-boundary
router.post("/trace-boundary", upload.single("reference_image"), traceBoundary);

module.exports = router;