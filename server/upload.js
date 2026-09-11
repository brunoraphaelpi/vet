const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const { UPLOADS_DIR } = require("./db");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").slice(0, 10);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB — dá folga para fotos e vídeos curtos
  fileFilter: (req, file, cb) => {
    if (/^(image|video)\//.test(file.mimetype)) cb(null, true);
    else cb(new Error("Só são aceitas fotos ou vídeos."));
  },
});

module.exports = upload;
