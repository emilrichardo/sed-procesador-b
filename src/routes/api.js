const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs-extra");
const { processPdf } = require("../controllers/pdfController");

// Configure upload using multer.
// We will store initially in a temp folder or directly handle in controller to move to structured folders.
// For now, let's just accept the file to a temp location.
const upload = multer({
  dest: "temp_uploads/",
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

router.post("/process-pdf", upload.single("pdf"), processPdf);

module.exports = router;
