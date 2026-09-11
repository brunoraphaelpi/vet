const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

const DEFAULT_DATA = {
  clientes: {}, // cpf -> { cpf, nome, telefone, email, senhaHash, enderecoPadrao, criadoEm }
  pets: {}, // id -> { id, clienteCpf, nome, especie, raca, idade, obs, fotoPath, carteiraFotoPath }
  vacinas: {}, // id -> { id, petId, nome, data, proximaDose, lote }
  agendamentos: {}, // id -> { id, clienteCpf, clienteNome, petId, petNome, motivo, endereco, midiaPath, midiaTipo, opcoes, status, data, horario, observacoesVet, criadoEm }
  config: { vetSenhaHash: null, clinicaNome: "Atendimento Veterinário em Domicílio" },
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
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
