const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getDB, save, UPLOADS_DIR } = require("../db");
const requireAuth = require("../middleware/requireAuth");
const upload = require("../upload");
const { uploadDoc } = require("../upload");
const { enviarEmail } = require("../mailer");
const { linkWhatsapp } = require("../whatsapp");
const { formatarDataBR, enderecoTexto, sortAgendamentos, aplicarTemplate } = require("../utils");

const router = express.Router();

function parseJSON(v, fallback) {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

async function notificar(db, ag, template) {
  const cliente = db.clientes[ag.clienteId];
  const nomeClinica = db.config.clinicaNome || "Atendimento Veterinário em Domicílio";
  const mensagem = aplicarTemplate(template, {
    cliente: cliente.nome,
    pet: ag.petNome,
    data: formatarDataBR(ag.data || ag.opcoes?.[0]?.data),
    horario: ag.horario || ag.opcoes?.[0]?.horario || "",
    endereco: enderecoTexto(ag.endereco),
    clinica: nomeClinica,
  });
  const email = await enviarEmail({ to: cliente.email, subject: "Sobre sua visita 🐾", text: mensagem });
  const whatsappUrl = linkWhatsapp(cliente.telefone, mensagem);
  return { email, whatsappUrl, mensagem };
}

// Cliente propõe até 3 opções de dia/horário para uma visita
router.post("/", requireAuth("cliente"), upload.single("midia"), async (req, res) => {
  const db = getDB();
  const cliente = db.clientes[req.auth.clienteId];
  if (!cliente) return res.status(404).json({ erro: "Cliente não encontrado." });

  const petId = req.body.petId || null;
  const petNome = req.body.petNome || (petId && db.pets[petId] ? db.pets[petId].nome : "");
  const motivo = (req.body.motivo || "").trim();
  const endereco = parseJSON(req.body.endereco, null);
  const opcoes = parseJSON(req.body.opcoes, []);

  if (petId && (!db.pets[petId] || db.pets[petId].clienteId !== cliente.id)) return res.status(400).json({ erro: "Pet inválido." });
  if (!petNome) return res.status(400).json({ erro: "Informe o pet da visita." });
  if (!motivo) return res.status(400).json({ erro: "Descreva o motivo da visita." });
  if (!endereco || !endereco.rua || !endereco.numero || !endereco.cidade) return res.status(400).json({ erro: "Preencha o endereço completo (rua, número e cidade)." });
  if (!Array.isArray(opcoes) || opcoes.length === 0 || opcoes.some((o) => !o.data || !o.horario)) {
    return res.status(400).json({ erro: "Informe ao menos uma opção de dia e horário (idealmente 3)." });
  }

  const id = crypto.randomUUID();
  db.agendamentos[id] = {
    id,
    clienteId: cliente.id,
    clienteNome: cliente.nome,
    petId,
    petNome,
    motivo,
    endereco,
    midiaPath: req.file ? `/uploads/${req.file.filename}` : null,
    midiaTipo: req.file ? (req.file.mimetype.startsWith("video") ? "video" : "imagem") : null,
    anexosVet: [],
    opcoes: opcoes.slice(0, 3),
    status: "aguardando", // aguardando -> confirmado -> concluido | recusado | cancelado
    data: null,
    horario: null,
    historicoObservacoes: [],
    criadoEm: new Date().toISOString(),
  };

  // guarda o endereço como padrão para a próxima vez
  cliente.enderecoPadrao = endereco;

  await save();
  res.json(db.agendamentos[id]);
});

router.get("/meus", requireAuth("cliente"), (req, res) => {
  const db = getDB();
  const lista = Object.values(db.agendamentos)
    .filter((a) => a.clienteId === req.auth.clienteId)
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  res.json(lista);
});

router.post("/:id/cancelar", requireAuth(), async (req, res) => {
  const db = getDB();
  const ag = db.agendamentos[req.params.id];
  if (!ag) return res.status(404).json({ erro: "Agendamento não encontrado." });
  if (req.auth.tipo === "cliente" && ag.clienteId !== req.auth.clienteId) return res.status(403).json({ erro: "Acesso não permitido." });
  if (!["aguardando", "confirmado"].includes(ag.status)) return res.status(400).json({ erro: "Esse agendamento não pode mais ser cancelado." });
  ag.status = "cancelado";
  await save();
  res.json(ag);
});

/* ---- histórico de observações da consulta (registro que nunca se perde) ---- */
// O cliente pode ver esse histórico (fica junto do agendamento retornado a ele);
// só a veterinária pode adicionar novas entradas, e entradas antigas nunca são
// apagadas ou sobrescritas — cada chamada acrescenta uma nova linha ao histórico.

router.post("/:id/observacoes", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const ag = db.agendamentos[req.params.id];
  if (!ag) return res.status(404).json({ erro: "Agendamento não encontrado." });
  const texto = (req.body.texto || "").trim();
  if (!texto) return res.status(400).json({ erro: "Escreva o texto da observação." });
  ag.historicoObservacoes = ag.historicoObservacoes || [];
  ag.historicoObservacoes.push({ id: crypto.randomUUID(), texto, criadoEm: new Date().toISOString() });
  await save();
  res.json(ag);
});

/* ---- anexos da veterinária (receitas, exames, etc.) ---- */

router.post("/:id/anexos", requireAuth("vet"), uploadDoc.single("arquivo"), async (req, res) => {
  const db = getDB();
  const ag = db.agendamentos[req.params.id];
  if (!ag) return res.status(404).json({ erro: "Agendamento não encontrado." });
  if (!req.file) return res.status(400).json({ erro: "Envie um arquivo." });
  const anexo = {
    id: crypto.randomUUID(),
    nome: req.file.originalname,
    path: `/uploads/${req.file.filename}`,
    mime: req.file.mimetype,
    criadoEm: new Date().toISOString(),
  };
  ag.anexosVet = ag.anexosVet || [];
  ag.anexosVet.push(anexo);
  await save();
  res.json(ag);
});

router.delete("/:id/anexos/:anexoId", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const ag = db.agendamentos[req.params.id];
  if (!ag) return res.status(404).json({ erro: "Agendamento não encontrado." });
  const anexo = (ag.anexosVet || []).find((a) => a.id === req.params.anexoId);
  if (anexo) {
    ag.anexosVet = ag.anexosVet.filter((a) => a.id !== req.params.anexoId);
    const filePath = path.join(UPLOADS_DIR, path.basename(anexo.path));
    fs.unlink(filePath, () => {}); // melhor esforço — não bloqueia a resposta
  }
  await save();
  res.json(ag);
});

/* ---- rotas da veterinária ---- */

router.get("/vet/todos", requireAuth("vet"), (req, res) => {
  const db = getDB();
  const { status } = req.query;
  let lista = Object.values(db.agendamentos);
  if (status && status !== "todos") lista = lista.filter((a) => a.status === status);
  lista.sort(sortAgendamentos);
  const comTelefone = lista.map((a) => ({ ...a, clienteTelefone: db.clientes[a.clienteId]?.telefone || "" }));
  res.json(comTelefone);
});

router.post("/:id/confirmar", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const ag = db.agendamentos[req.params.id];
  if (!ag) return res.status(404).json({ erro: "Agendamento não encontrado." });
  if (ag.status !== "aguardando") return res.status(400).json({ erro: "Esse agendamento já foi respondido." });

  const opcaoIndex = Number(req.body.opcaoIndex);
  const opcao = ag.opcoes[opcaoIndex];
  if (!opcao) return res.status(400).json({ erro: "Opção de horário inválida." });

  ag.status = "confirmado";
  ag.data = opcao.data;
  ag.horario = opcao.horario;
  await save();

  const notificacao = await notificar(db, ag, db.config.mensagemConfirmacao);
  res.json({ agendamento: ag, notificacao });
});

router.post("/:id/recusar", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const ag = db.agendamentos[req.params.id];
  if (!ag) return res.status(404).json({ erro: "Agendamento não encontrado." });
  if (ag.status !== "aguardando") return res.status(400).json({ erro: "Esse agendamento já foi respondido." });
  ag.status = "recusado";
  if (req.body.motivo) {
    ag.historicoObservacoes = ag.historicoObservacoes || [];
    ag.historicoObservacoes.push({ id: crypto.randomUUID(), texto: req.body.motivo, criadoEm: new Date().toISOString() });
  }
  await save();

  const notificacao = await notificar(db, ag, db.config.mensagemRecusa);
  res.json({ agendamento: ag, notificacao });
});

router.post("/:id/concluir", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const ag = db.agendamentos[req.params.id];
  if (!ag) return res.status(404).json({ erro: "Agendamento não encontrado." });
  if (ag.status !== "confirmado") return res.status(400).json({ erro: "Só é possível concluir visitas confirmadas." });
  ag.status = "concluido";
  const texto = (req.body.observacoes || "").trim();
  if (texto) {
    ag.historicoObservacoes = ag.historicoObservacoes || [];
    ag.historicoObservacoes.push({ id: crypto.randomUUID(), texto, criadoEm: new Date().toISOString() });
  }
  await save();
  res.json(ag);
});

module.exports = router;
