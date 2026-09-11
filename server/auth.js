const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "troque-este-segredo-em-producao";

function assinarToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: "30d" });
}

function verificarToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

module.exports = { assinarToken, verificarToken };
