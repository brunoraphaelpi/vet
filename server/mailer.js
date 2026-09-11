const nodemailer = require("nodemailer");

function smtpConfigurado() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

let transporter = null;
function getTransporter() {
  if (!transporter && smtpConfigurado()) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

async function enviarEmail({ to, subject, text }) {
  if (!to) return { enviado: false, motivo: "Cliente sem e-mail cadastrado." };
  if (!smtpConfigurado()) return { enviado: false, motivo: "Envio de e-mail não configurado no servidor (SMTP_*)." };
  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
    });
    return { enviado: true };
  } catch (e) {
    console.error("Erro ao enviar e-mail", e);
    return { enviado: false, motivo: "Falha ao enviar e-mail." };
  }
}

module.exports = { enviarEmail, smtpConfigurado };
