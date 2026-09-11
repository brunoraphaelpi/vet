const { verificarToken } = require("../auth");

/**
 * tipo: "cliente" | "vet" | undefined (qualquer um dos dois, desde que autenticado)
 */
function requireAuth(tipo) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ erro: "Não autenticado." });
    const payload = verificarToken(token);
    if (!payload) return res.status(401).json({ erro: "Sessão expirada ou inválida. Faça login novamente." });
    if (tipo && payload.tipo !== tipo) return res.status(403).json({ erro: "Acesso não permitido." });
    req.auth = payload;
    next();
  };
}

module.exports = requireAuth;
