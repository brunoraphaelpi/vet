const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

const DEFAULT_DATA = {
  clientes: {}, // id (uuid) -> { id, cpf, email, telefone, nome, senhaHash, enderecoPadrao, tags, criadoEm } — cpf e email são opcionais, mas ao menos um deve existir
  pets: {}, // id -> { id, clienteId, nome, especie, raca, idade, obs, fotoPath, carteiraFotoPath, notasPrivadas }
  vacinas: {}, // id -> { id, petId, nome, data, proximaDose, lote }
  agendamentos: {}, // id -> { id, clienteId, clienteNome, petId, petNome, motivo, endereco, midiaPath, midiaTipo, anexosVet, opcoes, status, data, horario, historicoObservacoes, criadoEm }
  templatesMensagem: {}, // id -> { id, nome, texto }
  config: {
    vetSenhaHash: null,
    clinicaNome: "Atendimento Veterinário em Domicílio",
    clinicaSlogan: "Cuidado com pets, na porta de casa",
    logoPath: null,
    mensagemConfirmacao: "Olá, {cliente}! Sua visita para {pet} foi confirmada para {data} às {horario}. Endereço: {endereco}. - {clinica}",
    mensagemRecusa: "Olá, {cliente}. Infelizmente não conseguimos atender nenhuma das opções enviadas para a visita de {pet}. Podemos combinar um novo horário? - {clinica}",
  },
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Migra bancos antigos: clientes passam a ser identificados por um id interno
// (em vez do CPF, que agora é opcional) e as observações da consulta viram um
// histórico de entradas em vez de um texto único que se sobrescrevia.
function migrar(cache) {
  const precisaMigrarClientes = Object.values(cache.clientes).some((c) => !c.id);
  if (precisaMigrarClientes) {
    const antigos = cache.clientes;
    const novos = {};
    const cpfParaId = {};
    Object.entries(antigos).forEach(([chaveAntiga, cliente]) => {
      const id = cliente.id || crypto.randomUUID();
      cliente.id = id;
      novos[id] = cliente;
      cpfParaId[chaveAntiga] = id;
    });
    cache.clientes = novos;

    Object.values(cache.pets).forEach((pet) => {
      if (!pet.clienteId && pet.clienteCpf) pet.clienteId = cpfParaId[pet.clienteCpf] || null;
    });
    Object.values(cache.agendamentos).forEach((ag) => {
      if (!ag.clienteId && ag.clienteCpf) ag.clienteId = cpfParaId[ag.clienteCpf] || null;
    });
  }

  Object.values(cache.agendamentos).forEach((ag) => {
    if (!Array.isArray(ag.historicoObservacoes)) {
      ag.historicoObservacoes = ag.observacoesVet
        ? [{ id: crypto.randomUUID(), texto: ag.observacoesVet, criadoEm: ag.criadoEm || new Date().toISOString() }]
        : [];
    }
    if (!Array.isArray(ag.anexosVet)) ag.anexosVet = [];
  });
  Object.values(cache.clientes).forEach((c) => { if (!Array.isArray(c.tags)) c.tags = []; });
  Object.values(cache.pets).forEach((p) => { if (p.notasPrivadas === undefined) p.notasPrivadas = ""; });

  return cache;
}

let cache = null;

function load() {
  ensureDataDir();
  if (cache) return cache;
  if (fs.existsSync(DB_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    } catch (e) {
      console.error("Não foi possível ler data/db.json, iniciando um banco vazio.", e);
      cache = JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
  } else {
    cache = JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
  // preenche chaves que possam faltar (ex: depois de um upgrade do sistema)
  cache = { ...JSON.parse(JSON.stringify(DEFAULT_DATA)), ...cache };
  cache.config = { ...DEFAULT_DATA.config, ...(cache.config || {}) };
  cache = migrar(cache);
  persist(); // garante que uma eventual migração de dados antigos seja salva em disco
  return cache;
}

let writeQueue = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(cache, null, 2);
  writeQueue = writeQueue
    .then(() => fs.promises.writeFile(DB_FILE, snapshot))
    .catch((e) => console.error("Erro ao salvar data/db.json", e));
  return writeQueue;
}

function getDB() {
  return load();
}

module.exports = { getDB, save: persist, ensureDataDir, DATA_DIR, UPLOADS_DIR };
