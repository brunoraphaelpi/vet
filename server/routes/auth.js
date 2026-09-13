const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { getDB, save } = require("../db");
const { assinarToken } = require("../auth");
const requireAuth = require("../middleware/requireAuth");
const { onlyDigits, semSenha, encontrarClientePorIdentificador } = require("../utils");

const router = express.Router();

function cpfOuEmailJaExiste(db, digits, emailLower, ignorarId) {
  return Object.values(db.clientes).some((c) => {
    if (ignorarId && c.id === ignorarId) return false;
    return (digits && c.cpf === digits) || (emailLower && c.email && c.email.toLowerCase() === emailLower);
  });
}

router.post("/registrar", async (req, res) => {
  const { nome, cpf, telefone, email, senha, pet } = req.body || {};
  const digits = onlyDigits(cpf);
  const emailLimpo = (email || "").trim();
  const emailLower = emailLimpo.toLowerCase();

  if (!nome || !nome.trim()) return res.status(400).json({ erro: "Informe o nome completo." });
  if (cpf && digits.length !== 11) return res.status(400).json({ erro: "CPF inválido — deve ter 11 dígitos." });
  if (!digits && !emailLimpo) return res.status(400).json({ erro: "Informe pelo menos um: CPF ou e-mail." });
  if (!senha || senha.length < 4) return res.status(400).json({ erro: "A senha deve ter ao menos 4 caracteres." });

  const db = getDB();
  if (cpfOuEmailJaExiste(db, digits, emailLower)) {
    return res.status(409).json({ erro: "Já existe um cadastro com esse CPF ou e-mail. Faça login." });
  }

  const id = crypto.randomUUID();
  const senhaHash = bcrypt.hashSync(senha, 10);
  db.clientes[id] = {
    id,
    cpf: digits || "",
    email: emailLimpo,
    nome: nome.trim(),
    telefone: telefone || "",
    senhaHash,
    enderecoPadrao: null,
    tags: [],
    criadoEm: new Date().toISOString(),
  };

  if (pet && pet.nome && pet.nome.trim()) {
    const petId = crypto.randomUUID();
    db.pets[petId] = {
      id: petId,
      clienteId: id,
      nome: pet.nome.trim(),
      especie: pet.especie || "Cão",
      raca: pet.raca || "",
      idade: pet.idade || "",
      obs: "",
      fotoPath: null,
      carteiraFotoPath: null,
      notasPrivadas: "",
    };
  }

  await save();
  const token = assinarToken({ tipo: "cliente", clienteId: id });
  res.json({ token, cliente: semSenha(db.clientes[id]) });
});

router.post("/login", (req, res) => {
  const { identificador, cpf, email, senha } = req.body || {};
  const db = getDB();
  const cliente = encontrarClientePorIdentificador(db, identificador || cpf || email);
  if (!cliente || !bcrypt.compareSync(senha || "", cliente.senhaHash)) {
    return res.status(401).json({ erro: "CPF/e-mail ou senha incorretos." });
  }
  const token = assinarToken({ tipo: "cliente", clienteId: cliente.id });
  res.json({ token, cliente: semSenha(cliente) });
});

router.post("/vet-login", (req, res) => {
  const { senha } = req.body || {};
  const db = getDB();
  if (!db.config.vetSenhaHash || !bcrypt.compareSync(senha || "", db.config.vetSenhaHash)) {
    return res.status(401).json({ erro: "Senha incorreta." });
  }
  const token = assinarToken({ tipo: "vet" });
  res.json({ token });
});

router.get("/me", requireAuth("cliente"), (req, res) => {
  const db = getDB();
  const cliente = db.clientes[req.auth.clienteId];
  if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
  const pets = Object.values(db.pets)
    .filter((p) => p.clienteId === cliente.id)
    .map((p) => {
      const { notasPrivadas, ...petPublico } = p;
      return { ...petPublico, vacinas: Object.values(db.vacinas).filter((v) => v.petId === p.id) };
    });
  res.json({ cliente: semSenha(cliente), pets });
});

module.exports = router;
