const express = require("express");
const { getDB } = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  const db = getDB();
  res.json({
    clinicaNome: db.config.clinicaNome,
    clinicaSlogan: db.config.clinicaSlogan,
    logoPath: db.config.logoPath || null,
  });
});

module.exports = router;
