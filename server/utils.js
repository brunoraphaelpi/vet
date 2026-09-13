function onlyDigits(s) {
  return (s || "").toString().replace(/\D/g, "");
}

function semSenha(cliente) {
  if (!cliente) return cliente;
  const { senhaHash, ...resto } = cliente;
  return resto;
}

function formatarDataBR(iso) {
  if (!iso) return "";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function enderecoTexto(end) {
  if (!end) return "";
  const partes = [];
  if (end.rua) partes.push(`${end.rua}${end.numero ? ", " + end.numero : ""}`);
  if (end.complemento) partes.push(end.complemento);
  if (end.bairro) partes.push(end.bairro);
  if (end.cidade) partes.push(`${end.cidade}${end.uf ? " - " + end.uf : ""}`);
  if (end.cep) partes.push(`CEP ${end.cep}`);
  return partes.join(", ");
}

function aplicarTemplate(template, vars) {
  return String(template || "").replace(/\{(\w+)\}/g, (m, chave) => (vars[chave] !== undefined ? vars[chave] : m));
}

function sortAgendamentos(a, b) {
  const da = a.data || "9999", db_ = b.data || "9999";
  if (da !== db_) return da.localeCompare(db_);
  return (a.horario || "").localeCompare(b.horario || "");
}

// Encontra um cliente pelo CPF ou pelo e-mail (o cliente pode logar com qualquer um dos dois)
function encontrarClientePorIdentificador(db, identificador) {
  const bruto = (identificador || "").trim();
  const digits = onlyDigits(bruto);
  const emailLower = bruto.toLowerCase();
  return Object.values(db.clientes).find((c) => (digits && c.cpf && c.cpf === digits) || (c.email && c.email.toLowerCase() === emailLower));
}

module.exports = { onlyDigits, semSenha, formatarDataBR, enderecoTexto, sortAgendamentos, aplicarTemplate, encontrarClientePorIdentificador };
