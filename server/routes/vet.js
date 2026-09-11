const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { getDB, save } = require("../db");
const requireAuth = require("../middleware/requireAuth");
const { onlyDigits, semSenha, sortAgendamentos } = require("../utils");

const router = express.Router();

function petsDoCliente(db, cpf) {
  return Object.values(db.pets)
    .filter((p) => p.clienteCpf === cpf)
    .map((p) => ({ ...p, vacinas: Object.values(db.vacinas).filter((v) => v.petId === p.id) }));
}

router.get("/clientes", requireAuth("vet"), (req, res) => {
  const db = getDB();
  const clientes = Object.values(db.clientes).map((c) => ({ ...semSenha(c), pets: petsDoCliente(db, c.cpf) }));
  res.json(clientes);
});

router.post("/clientes", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const { nome, cpf, telefone, email, senha, pet } = req.body || {};
  const digits = onlyDigits(cpf);
  if (!nome || !nome.trim()) return res.status(400).json({ erro: "Informe o nome do cliente." });
  if (digits.length !== 11) return res.status(400).json({ erro: "CPF inválido." });
  if (db.clientes[digits]) return res.status(409).json({ erro: "Já existe um cliente com esse CPF." });
  if (!senha || senha.length < 4) return res.status(400).json({ erro: "Defina uma senha temporária (mín. 4 caracteres)." });

  db.clientes[digits] = {
    cpf: digits,
    nome: nome.trim(),
    telefone: telefone || "",
    email: email || "",
    senhaHash: bcrypt.hashSync(senha, 10),
    enderecoPadrao: null,
    criadoEm: new Date().toISOString(),
  };

  if (pet && pet.nome && pet.nome.trim()) {
    const id = crypto.randomUUID();
    db.pets[id] = { id, clienteCpf: digits, nome: pet.nome.trim(), especie: pet.especie || "Cão", raca: pet.raca || "", idade: pet.idade || "", obs: "", fotoPath: null, carteiraFotoPath: null };
  }

  await save();
  res.json({ ...semSenha(db.clientes[digits]), pets: petsDoCliente(db, digits) });
});

router.patch("/clientes/:cpf", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const cliente = db.clientes[req.params.cpf];
  if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
  const { nome, telefone, email } = req.body || {};
  if (nome !== undefined) cliente.nome = nome;
  if (telefone !== undefined) cliente.telefone = telefone;
  if (email !== undefined) cliente.email = email;
  await save();
  res.json({ ...semSenha(cliente), pets: petsDoCliente(db, cliente.cpf) });
});

router.post("/senha", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const { atual, nova } = req.body || {};
  if (!bcrypt.compareSync(atual || "", db.config.vetSenhaHash || "")) return res.status(401).json({ erro: "Senha atual incorreta." });
  if (!nova || nova.length < 4) return res.status(400).json({ erro: "A nova senha deve ter ao menos 4 caracteres." });
  db.config.vetSenhaHash = bcrypt.hashSync(nova, 10);
  await save();
  res.json({ ok: true });
});

router.get("/painel", requireAuth("vet"), (req, res) => {
  const db = getDB();
  const hoje = new Date().toISOString().slice(0, 10);

  const proximos = Object.values(db.agendamentos)
    .filter((a) => a.status === "confirmado")
    .sort(sortAgendamentos)
    .slice(0, 6);

  const solicitacoesPendentes = Object.values(db.agendamentos).filter((a) => a.status === "aguardando").length;

  const vacinasVencendo = [];
  Object.values(db.pets).forEach((pet) => {
    const cliente = db.clientes[pet.clienteCpf];
    if (!cliente) return;
    Object.values(db.vacinas)
      .filter((v) => v.petId === pet.id && v.proximaDose)
      .forEach((v) => {
        const diff = Math.floor((new Date(v.proximaDose + "T00:00:00") - new Date(hoje + "T00:00:00")) / 86400000);
        if (diff <= 30) vacinasVencendo.push({ clienteNome: cliente.nome, petNome: pet.nome, vacina: v.nome, diff });
      });
  });
  vacinasVencendo.sort((a, b) => a.diff - b.diff);

  res.json({ proximos, solicitacoesPendentes, vacinasVencendo });
});

module.exports = router;
