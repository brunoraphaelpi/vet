const express = require("express");
const crypto = require("crypto");
const { getDB, save } = require("../db");
const requireAuth = require("../middleware/requireAuth");
const upload = require("../upload");

const router = express.Router();

// Cliente cadastra um pet para si mesmo, ou a veterinária cadastra para um cliente (informando clienteId)
router.post("/", requireAuth(), async (req, res) => {
  const db = getDB();
  const clienteId = req.auth.tipo === "cliente" ? req.auth.clienteId : req.body.clienteId;
  if (!clienteId || !db.clientes[clienteId]) return res.status(400).json({ erro: "Cliente inválido." });

  const { nome, especie, raca, idade, obs } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ erro: "Informe o nome do pet." });

  const id = crypto.randomUUID();
  db.pets[id] = { id, clienteId, nome: nome.trim(), especie: especie || "Cão", raca: raca || "", idade: idade || "", obs: obs || "", fotoPath: null, carteiraFotoPath: null, notasPrivadas: "" };
  await save();
  res.json({ ...db.pets[id], vacinas: [] });
});

router.patch("/:id", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const pet = db.pets[req.params.id];
  if (!pet) return res.status(404).json({ erro: "Pet não encontrado." });
  const { nome, especie, raca, idade, obs, notasPrivadas } = req.body || {};
  if (nome !== undefined) pet.nome = nome;
  if (especie !== undefined) pet.especie = especie;
  if (raca !== undefined) pet.raca = raca;
  if (idade !== undefined) pet.idade = idade;
  if (obs !== undefined) pet.obs = obs;
  if (notasPrivadas !== undefined) pet.notasPrivadas = notasPrivadas;
  await save();
  res.json(pet);
});

router.post("/:id/foto", requireAuth("vet"), upload.single("foto"), async (req, res) => {
  const db = getDB();
  const pet = db.pets[req.params.id];
  if (!pet) return res.status(404).json({ erro: "Pet não encontrado." });
  if (!req.file) return res.status(400).json({ erro: "Envie um arquivo de imagem." });
  pet.fotoPath = `/uploads/${req.file.filename}`;
  await save();
  res.json(pet);
});

router.delete("/:id/foto", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const pet = db.pets[req.params.id];
  if (!pet) return res.status(404).json({ erro: "Pet não encontrado." });
  pet.fotoPath = null;
  await save();
  res.json(pet);
});

router.post("/:id/carteira-foto", requireAuth("vet"), upload.single("foto"), async (req, res) => {
  const db = getDB();
  const pet = db.pets[req.params.id];
  if (!pet) return res.status(404).json({ erro: "Pet não encontrado." });
  if (!req.file) return res.status(400).json({ erro: "Envie um arquivo de imagem." });
  pet.carteiraFotoPath = `/uploads/${req.file.filename}`;
  await save();
  res.json(pet);
});

router.delete("/:id/carteira-foto", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const pet = db.pets[req.params.id];
  if (!pet) return res.status(404).json({ erro: "Pet não encontrado." });
  pet.carteiraFotoPath = null;
  await save();
  res.json(pet);
});

router.post("/:id/vacinas", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  const pet = db.pets[req.params.id];
  if (!pet) return res.status(404).json({ erro: "Pet não encontrado." });
  const { nome, data, proximaDose, lote } = req.body || {};
  if (!nome || !data) return res.status(400).json({ erro: "Informe o nome da vacina e a data de aplicação." });
  const id = crypto.randomUUID();
  db.vacinas[id] = { id, petId: pet.id, nome, data, proximaDose: proximaDose || "", lote: lote || "" };
  await save();
  res.json(db.vacinas[id]);
});

router.delete("/:petId/vacinas/:vacinaId", requireAuth("vet"), async (req, res) => {
  const db = getDB();
  if (!db.vacinas[req.params.vacinaId]) return res.status(404).json({ erro: "Vacina não encontrada." });
  delete db.vacinas[req.params.vacinaId];
  await save();
  res.json({ ok: true });
});

module.exports = router;
