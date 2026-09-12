const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { getDB, save, UPLOADS_DIR } = require("../db");
const requireAuth = require("../middleware/requireAuth");
const upload = require("../upload");
const { enviarEmail } = require("../mailer");
const { linkWhatsapp } = require("../whatsapp");
const { onlyDigits, semSenha, sortAgendamentos, aplicarTemplate } = require("../utils");

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
  if (!(email && email.trim()) && !(telefone && onlyDigits(telefone))) {
    return res.status(400).json({ erro: "Informe pelo menos um contato: e-mail ou telefone." });
  }

  db.clientes[digits] = {
    cpf: digits,
    nome: nome.trim(),
    telefone: telefone || "",
    email: email || "",
    senhaHash: bcrypt.hashSync(senha, 10),
    enderecoPadrao: null,
    tags: [],
    criadoEm: new Date().toISOString(),
  };

  if (pet && pet.nome && pet.nome.trim()) {
    const id = crypto.randomUUID();
    db.pets[id] = { id, clienteCpf: digits, nome: pet.nome.trim(), especie: pet.especie || "Cão", raca: pet.raca || "", idade: pet.idade || "", obs: "", fotoPath: null, carteiraFotoPath: null, notasPrivadas: "" };
  }

  await save();
  res.json({ ...semSenha(db.clientes[digits]), pets: petsDoCliente(db, digits) });
});

router.patch("/clientes/:cpf", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const cliente = db.clientes[req.params.cpf];
  if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });
  const { nome, telefone, email, tags } = req.body || {};
  if (nome !== undefined) cliente.nome = nome;
  if (telefone !== undefined) cliente.telefone = telefone;
  if (email !== undefined) cliente.email = email;
  if (tags !== undefined) cliente.tags = Array.isArray(tags) ? [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))] : cliente.tags;
  await save();
  res.json({ ...semSenha(cliente), pets: petsDoCliente(db, cliente.cpf) });
});

router.get("/tags", requireAuth("vet"), (req, res) => {
  const db = getDB();
  const todas = new Set();
  Object.values(db.clientes).forEach((c) => (c.tags || []).forEach((t) => todas.add(t)));
  res.json([...todas].sort((a, b) => a.localeCompare(b, "pt-BR")));
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

router.get("/config", requireAuth("vet"), (req, res) => {
  const db = getDB();
  const { vetSenhaHash, ...config } = db.config;
  res.json(config);
});

router.patch("/config", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const { clinicaNome, clinicaSlogan, mensagemConfirmacao, mensagemRecusa } = req.body || {};
  if (clinicaNome !== undefined) db.config.clinicaNome = clinicaNome;
  if (clinicaSlogan !== undefined) db.config.clinicaSlogan = clinicaSlogan;
  if (mensagemConfirmacao !== undefined) db.config.mensagemConfirmacao = mensagemConfirmacao;
  if (mensagemRecusa !== undefined) db.config.mensagemRecusa = mensagemRecusa;
  await save();
  const { vetSenhaHash, ...config } = db.config;
  res.json(config);
});

router.post("/config/logo", requireAuth("vet"), upload.single("logo"), async (req, res) => {
  const db = getDB();
  if (!req.file) return res.status(400).json({ erro: "Envie uma imagem." });
  db.config.logoPath = `/uploads/${req.file.filename}`;
  await save();
  const { vetSenhaHash, ...config } = db.config;
  res.json(config);
});

router.delete("/config/logo", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  if (db.config.logoPath) {
    const filePath = path.join(UPLOADS_DIR, path.basename(db.config.logoPath));
    fs.unlink(filePath, () => {});
  }
  db.config.logoPath = null;
  await save();
  const { vetSenhaHash, ...config } = db.config;
  res.json(config);
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

/* ---- modelos de mensagem (reutilizáveis para envio em massa) ---- */

router.get("/templates-mensagem", requireAuth("vet"), (req, res) => {
  const db = getDB();
  res.json(Object.values(db.templatesMensagem).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
});

router.post("/templates-mensagem", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const { nome, texto } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ erro: "Dê um nome ao modelo." });
  if (!texto || !texto.trim()) return res.status(400).json({ erro: "Escreva o texto do modelo." });
  const id = crypto.randomUUID();
  db.templatesMensagem[id] = { id, nome: nome.trim(), texto: texto.trim() };
  await save();
  res.json(db.templatesMensagem[id]);
});

router.patch("/templates-mensagem/:id", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const t = db.templatesMensagem[req.params.id];
  if (!t) return res.status(404).json({ erro: "Modelo não encontrado." });
  const { nome, texto } = req.body || {};
  if (nome !== undefined) t.nome = nome;
  if (texto !== undefined) t.texto = texto;
  await save();
  res.json(t);
});

router.delete("/templates-mensagem/:id", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  if (!db.templatesMensagem[req.params.id]) return res.status(404).json({ erro: "Modelo não encontrado." });
  delete db.templatesMensagem[req.params.id];
  await save();
  res.json({ ok: true });
});

/* ---- envio de mensagens em massa (e-mail automático + link de WhatsApp por contato) ---- */

router.post("/mensagens/enviar", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const { cpfs, mensagem, canal } = req.body || {};
  if (!Array.isArray(cpfs) || cpfs.length === 0) return res.status(400).json({ erro: "Selecione ao menos um cliente." });
  if (!mensagem || !mensagem.trim()) return res.status(400).json({ erro: "Escreva a mensagem." });
  const canalValido = ["email", "whatsapp", "ambos"].includes(canal) ? canal : "ambos";

  const nomeClinica = db.config.clinicaNome || "Atendimento Veterinário em Domicílio";
  let emailEnviados = 0;
  let emailFalhou = 0;
  const whatsapp = [];

  for (const cpf of cpfs) {
    const cliente = db.clientes[cpf];
    if (!cliente) continue;
    const texto = aplicarTemplate(mensagem, { cliente: cliente.nome, clinica: nomeClinica });

    if (canalValido === "email" || canalValido === "ambos") {
      const resultado = await enviarEmail({ to: cliente.email, subject: `Mensagem de ${nomeClinica}`, text: texto });
      if (resultado.enviado) emailEnviados++;
      else emailFalhou++;
    }

    if (canalValido === "whatsapp" || canalValido === "ambos") {
      const url = linkWhatsapp(cliente.telefone, texto);
      if (url) whatsapp.push({ cpf, nome: cliente.nome, url });
    }
  }

  res.json({ emailEnviados, emailFalhou, whatsapp });
});

module.exports = router;
