const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { getDB, save } = require("../db");
const { assinarToken } = require("../auth");
const requireAuth = require("../middleware/requireAuth");
const { onlyDigits, semSenha } = require("../utils");

const router = express.Router();

router.post("/registrar", async (req, res) => {
  const { nome, cpf, telefone, email, senha, pet } = req.body || {};
  const digits = onlyDigits(cpf);
  if (!nome || !nome.trim()) return res.status(400).json({ erro: "Informe o nome completo." });
  if (digits.length !== 11) return res.status(400).json({ erro: "CPF inválido — deve ter 11 dígitos." });
  if (!senha || senha.length < 4) return res.status(400).json({ erro: "A senha deve ter ao menos 4 caracteres." });

  const db = getDB();
  if (db.clientes[digits]) return res.status(409).json({ erro: "Já existe um cadastro com esse CPF. Faça login." });

  const senhaHash = bcrypt.hashSync(senha, 10);
  db.clientes[digits] = {
    cpf: digits,
    nome: nome.trim(),
    telefone: telefone || "",
    email: email || "",
    senhaHash,
    enderecoPadrao: null,
    criadoEm: new Date().toISOString(),
  };

  if (pet && pet.nome && pet.nome.trim()) {
    const id = crypto.randomUUID();
    db.pets[id] = {
      id,
      clienteCpf: digits,
      nome: pet.nome.trim(),
      especie: pet.especie || "Cão",
      raca: pet.raca || "",
      idade: pet.idade || "",
      obs: "",
      fotoPath: null,
      carteiraFotoPath: null,
    };
  }

  await save();
  const token = assinarToken({ tipo: "cliente", cpf: digits });
  res.json({ token, cliente: semSenha(db.clientes[digits]) });
});

router.post("/login", (req, res) => {
  const { cpf, senha } = req.body || {};
  const digits = onlyDigits(cpf);
  const db = getDB();
  const cliente = db.clientes[digits];
  if (!cliente || !bcrypt.compareSync(senha || "", cliente.senhaHash)) {
    return res.status(401).json({ erro: "CPF ou senha incorretos." });
  }
  const token = assinarToken({ tipo: "cliente", cpf: digits });
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
  const cliente = db.clientes[req.auth.cpf];
  if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
  const pets = Object.values(db.pets)
    .filter((p) => p.clienteCpf === cliente.cpf)
    .map((p) => ({ ...p, vacinas: Object.values(db.vacinas).filter((v) => v.petId === p.id) }));
  res.json({ cliente: semSenha(cliente), pets });
});

module.exports = router;
