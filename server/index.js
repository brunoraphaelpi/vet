require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const { getDB, save, ensureDataDir, DATA_DIR } = require("./db");

ensureDataDir();
const db = getDB();
if (!db.config.vetSenhaHash) {
  const senhaInicial = process.env.VET_SENHA_INICIAL || "vet2026";
  db.config.vetSenhaHash = bcrypt.hashSync(senhaInicial, 10);
  save();
  console.log(`Senha inicial da área da veterinária: "${senhaInicial}" — troque assim que entrar (botão "Alterar senha" no painel).`);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static(path.join(DATA_DIR, "uploads")));
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api/auth", require("./routes/auth"));
app.use("/api/pets", require("./routes/pets"));
app.use("/api/agendamentos", require("./routes/agendamentos"));
app.use("/api/vet", require("./routes/vet"));

// erros do multer (ex: arquivo grande demais) viram um JSON amigável em vez de travar
app.use((err, req, res, next) => {
  if (err && err.name === "MulterError") return res.status(400).json({ erro: "Falha no envio do arquivo: " + err.message });
  if (err) { console.error(err); return res.status(500).json({ erro: err.message || "Erro interno." }); }
  next();
});

// qualquer rota que não seja da API ou de uploads cai no app de página única
app.get(/^(?!\/api|\/uploads).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
