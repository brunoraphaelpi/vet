const { onlyDigits } = require("./utils");

/**
 * Gera um link "clique para enviar" do WhatsApp. Não depende de nenhuma API paga:
 * a veterinária clica no link e o WhatsApp (web ou app) abre com a mensagem pronta
 * para ela conferir e enviar. Assume números brasileiros quando o DDI não é informado.
 */
function linkWhatsapp(telefone, mensagem) {
  const digits = onlyDigits(telefone);
  if (!digits) return null;
  const comDDI = digits.length <= 11 ? "55" + digits : digits;
  return `https://wa.me/${comDDI}?text=${encodeURIComponent(mensagem)}`;
}

module.exports = { linkWhatsapp };
