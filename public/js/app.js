import { api, getToken, getTipo, setSessao, limparSessao } from "./api.js";

/* ============================= estado ============================= */
const state = {
  view: "landing",
  tipo: null,

  publicConfig: { clinicaNome: "Atendimento Veterinário em Domicílio", clinicaSlogan: "Cuidado com pets, na porta de casa", logoPath: null },
  vetConfig: null,

  cliente: null,
  pets: [],
  meusAgendamentos: [],
  clienteTab: "pets",
  clienteMostrarAddPet: false,
  clienteExpandidoPet: null,
  agendarEnd: {},

  vetTab: "painel",
  vetPainel: null,
  vetAgendaFiltro: "todos",
  vetAgendaLista: [],
  vetSolicitacoes: [],
  vetClientes: [],
  vetBusca: "",
  vetExpandidoCliente: null,
  vetShowNovoCliente: false,
  vetCarteiraCpf: null,
  vetCarteiraPetId: null,
  vetAddVacinaAberto: null,
  vetAddPetPara: null,
};

let stagedMidiaFile = null;

/* ============================= utils ============================= */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function onlyDigits(s) { return (s || "").toString().replace(/\D/g, ""); }
function formatCPF(v) {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length > 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length > 6) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  if (d.length > 3) return `${d.slice(0, 3)}.${d.slice(3)}`;
  return d;
}
function formatPhone(v) {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length > 6) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length > 2) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return d;
}
function formatCEP(v) {
  const d = onlyDigits(v).slice(0, 8);
  if (d.length > 5) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return d;
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function formatDateBR(iso) {
  if (!iso) return "";
  try { return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
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
function mapsUrl(end) { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(enderecoTexto(end))}`; }

function googleCalendarUrl(ag) {
  const inicio = new Date(`${ag.data}T${ag.horario}:00-03:00`);
  const fim = new Date(inicio.getTime() + 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `Visita veterinária - ${ag.petNome}`,
    dates: `${fmt(inicio)}/${fmt(fim)}`,
    details: `${ag.motivo || ""}${ag.motivo ? " — " : ""}Atendimento a domicílio.`,
    location: enderecoTexto(ag.endereco),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function fileIconFor(mime) {
  if (!mime) return "📎";
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📄";
  if (mime.includes("word")) return "📝";
  return "📎";
}
function qs(id) { return document.getElementById(id); }
function val(id) { return (qs(id)?.value || "").trim(); }

const STATUS_META = {
  aguardando: { label: "Aguardando confirmação", cls: "badge-aguardando" },
  confirmado: { label: "Confirmado", cls: "badge-confirmado" },
  concluido: { label: "Concluído", cls: "badge-concluido" },
  cancelado: { label: "Cancelado", cls: "badge-cancelado" },
  recusado: { label: "Recusado", cls: "badge-recusado" },
};
function badge(status) {
  const m = STATUS_META[status] || { label: status, cls: "badge-concluido" };
  return `<span class="badge ${m.cls}">${m.label}</span>`;
}

function showToast(msg, isErr) {
  const root = qs("toast-root");
  if (!root) return;
  root.innerHTML = `<div class="toast ${isErr ? "err" : ""}">${esc(msg)}</div>`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { root.innerHTML = ""; }, 4000);
}

function showLightbox(src, tipo) {
  const root = qs("lightbox-root");
  if (!root) return;
  root.innerHTML = `
  <div class="lightbox-overlay" data-action="fechar-lightbox">
    <div class="lightbox-inner" onclick="event.stopPropagation()">
      ${tipo === "video"
        ? `<video src="${src}" controls autoplay class="lightbox-media"></video>`
        : `<img src="${src}" class="lightbox-media" />`}
      <div class="lightbox-actions">
        <a href="${src}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">↗ Abrir em nova aba</a>
        <button class="btn btn-outline btn-sm" data-action="fechar-lightbox">✕ Fechar</button>
      </div>
    </div>
  </div>`;
}
function hideLightbox() {
  const root = qs("lightbox-root");
  if (root) root.innerHTML = "";
}

async function buscarCEP(digits) {
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    const data = await res.json();
    if (data.erro) return null;
    return { rua: data.logradouro || "", bairro: data.bairro || "", cidade: data.localidade || "", uf: data.uf || "" };
  } catch { return null; }
}

/* ============================= data loading ============================= */
async function carregarConfigPublico() {
  try {
    state.publicConfig = await api.get("/api/config");
    document.title = state.publicConfig.clinicaNome || document.title;
  } catch { /* segue com os valores padrão */ }
}
async function carregarMeusAgendamentos() {
  state.meusAgendamentos = await api.get("/api/agendamentos/meus");
}
async function recarregarCliente() {
  const { cliente, pets } = await api.get("/api/auth/me");
  state.cliente = cliente; state.pets = pets;
}
async function carregarVetPainel() {
  state.vetPainel = await api.get("/api/vet/painel");
}
async function carregarVetAgenda() {
  const qsParam = state.vetAgendaFiltro && state.vetAgendaFiltro !== "todos" ? `?status=${state.vetAgendaFiltro}` : "";
  state.vetAgendaLista = await api.get(`/api/agendamentos/vet/todos${qsParam}`);
}
async function carregarVetSolicitacoes() {
  state.vetSolicitacoes = await api.get("/api/agendamentos/vet/todos?status=aguardando");
}
async function carregarVetClientes() {
  state.vetClientes = await api.get("/api/vet/clientes");
}
async function carregarVetConfig() {
  state.vetConfig = await api.get("/api/vet/config");
}

/* ============================= render root ============================= */
function render() {
  qs("view").innerHTML = viewHTML();
}
function viewHTML() {
  switch (state.view) {
    case "landing": return viewLanding();
    case "clienteLogin": return viewClienteLogin();
    case "clienteRegistro": return viewClienteRegistro();
    case "clienteDash": return viewClienteDash();
    case "vetLogin": return viewVetLogin();
    case "vetDash": return viewVetDash();
    default: return viewLanding();
  }
}

/* ============================= LANDING ============================= */
function viewLanding() {
  const cfg = state.publicConfig;
  return `
  <div class="landing-hero"><div class="landing-inner">
    <div class="center">
      ${cfg.logoPath ? `<img src="${cfg.logoPath}" class="landing-logo" />` : ""}
      <div class="landing-pill">🏠 ${esc(cfg.clinicaNome)}</div>
      <h1 class="h1">${esc(cfg.clinicaSlogan)}</h1>
      <p class="muted">Agende visitas, acompanhe o histórico e a carteirinha de vacinação do seu companheiro — tudo em um só lugar.</p>
    </div>
    <div class="landing-cards">
      <div class="landing-card" data-action="ir" data-view="clienteLogin">
        <div class="ic-lg" style="background:var(--green)">🐾</div>
        <p class="serif" style="font-size:1.2rem;margin:0 0 .3rem">Sou cliente</p>
        <p class="small muted">Entre com CPF e senha para agendar visitas, ver o histórico e a carteirinha de vacinação.</p>
        <span class="link" style="margin-top:.8rem;display:inline-block;pointer-events:none">Entrar ou cadastrar →</span>
      </div>
      <div class="landing-card" data-action="ir" data-view="vetLogin">
        <div class="ic-lg" style="background:var(--clay)">🩺</div>
        <p class="serif" style="font-size:1.2rem;margin:0 0 .3rem">Área da veterinária</p>
        <p class="small muted">Acesso restrito para gerenciar agenda, clientes e carteiras de vacinação.</p>
        <span class="small muted" style="margin-top:.8rem;display:inline-block">🔒 Acesso restrito</span>
      </div>
    </div>
  </div></div>`;
}

/* ============================= CLIENTE: LOGIN / REGISTRO ============================= */
function viewClienteLogin() {
  return `
  <div class="landing-hero"><div style="max-width:380px;width:100%">
    <button class="btn btn-ghost" data-action="ir" data-view="landing">← Voltar</button>
    <div class="card" style="margin-top:.5rem" data-enter="cliente-login">
      <div class="ic-lg" style="background:var(--green)">🐾</div>
      <p class="serif" style="font-size:1.4rem;margin:.6rem 0 .2rem">Entrar</p>
      <p class="small muted" style="margin-bottom:1.2rem">Acesse sua ficha e agende novas visitas.</p>
      <div class="field"><label class="label">CPF</label><input class="input" id="login-cpf" data-mask="cpf" inputmode="numeric" placeholder="000.000.000-00" /></div>
      <div class="field"><label class="label">Senha</label><input class="input" id="login-senha" type="password" placeholder="••••••••" /></div>
      <div id="login-err"></div>
      <button class="btn btn-primary btn-block" style="margin-top:.9rem" data-action="cliente-login">🔒 Entrar</button>
      <p class="small center muted" style="margin-top:1rem">Primeira vez aqui? <button class="link" data-action="ir" data-view="clienteRegistro">Criar cadastro</button></p>
    </div>
  </div></div>`;
}

function viewClienteRegistro() {
  return `
  <div class="landing-hero"><div style="max-width:440px;width:100%">
    <button class="btn btn-ghost" data-action="ir" data-view="clienteLogin">← Voltar</button>
    <div class="card" style="margin-top:.5rem">
      <p class="serif" style="font-size:1.4rem;margin:0 0 .2rem">Criar cadastro</p>
      <p class="small muted" style="margin-bottom:1.1rem">Leva menos de um minuto.</p>
      <div class="field"><label class="label">Nome completo</label><input class="input" id="reg-nome" /></div>
      <div class="row2">
        <div class="field"><label class="label">CPF</label><input class="input" id="reg-cpf" data-mask="cpf" inputmode="numeric" placeholder="000.000.000-00" /></div>
        <div class="field"><label class="label">Telefone (WhatsApp)</label><input class="input" id="reg-telefone" data-mask="phone" inputmode="numeric" placeholder="(00) 00000-0000" /></div>
      </div>
      <div class="field"><label class="label">E-mail (opcional, para receber confirmações)</label><input class="input" id="reg-email" type="email" placeholder="voce@email.com" /></div>
      <div class="row2">
        <div class="field"><label class="label">Senha</label><input class="input" id="reg-senha" type="password" /></div>
        <div class="field"><label class="label">Confirmar senha</label><input class="input" id="reg-confirma" type="password" /></div>
      </div>
      <hr class="hr" />
      <p class="eyebrow">SEU PET (opcional agora, pode adicionar depois)</p>
      <div class="row2">
        <div class="field"><label class="label">Nome do pet</label><input class="input" id="reg-pet-nome" /></div>
        <div class="field"><label class="label">Espécie</label>
          <select class="input" id="reg-pet-especie"><option>Cão</option><option>Gato</option><option>Ave</option><option>Outro</option></select>
        </div>
      </div>
      <div class="row2">
        <div class="field"><label class="label">Raça</label><input class="input" id="reg-pet-raca" /></div>
        <div class="field"><label class="label">Idade</label><input class="input" id="reg-pet-idade" placeholder="ex: 2 anos" /></div>
      </div>
      <div id="reg-err"></div>
      <button class="btn btn-primary btn-block" style="margin-top:.4rem" data-action="cliente-registrar">✓ Criar cadastro e entrar</button>
    </div>
  </div></div>`;
}

/* ============================= CLIENTE: DASHBOARD ============================= */
function topBar({ titulo, subtitulo, icone, onBack }) {
  const cfg = state.publicConfig;
  const iconeHtml = cfg.logoPath ? `<img src="${cfg.logoPath}" style="width:100%;height:100%;object-fit:cover;border-radius:999px" />` : icone;
  return `
  <div class="vd-topbar">
    <div class="vd-topbar-title">
      ${onBack ? `<button class="vd-back" data-action="ir" data-view="${onBack}">←</button>` : ""}
      <div class="vd-topbar-icon">${iconeHtml}</div>
      <div>
        <p class="serif t1">${esc(titulo)}</p>
        ${subtitulo ? `<p class="t2">${esc(subtitulo)}</p>` : ""}
      </div>
    </div>
    <button class="vd-logout" data-action="logout">Sair</button>
  </div>`;
}

function viewClienteDash() {
  const c = state.cliente;
  const tabs = [
    ["pets", "🐾", "Meus pets"],
    ["agendar", "📅", "Agendar"],
    ["agendamentos", "🗂️", "Agendamentos"],
    ["historico", "💉", "Histórico"],
  ];
  return `
  <div class="vd-shell">
    ${topBar({ titulo: c.nome, subtitulo: "Área do cliente", icone: "🐾" })}
    <div class="vd-main">
      ${clienteTabContent()}
    </div>
    <div class="vd-tabs-bar vd-tabs">
      ${tabs.map(([id, ic, label]) => `
        <button class="vd-tab ${state.clienteTab === id ? "active" : ""}" data-action="tab-cliente" data-tab="${id}">
          <span class="ic">${ic}</span><span>${label}</span>
        </button>`).join("")}
    </div>
  </div>`;
}

function clienteTabContent() {
  if (state.clienteTab === "pets") return petsPanelHTML({ pets: state.pets, editable: false });
  if (state.clienteTab === "agendar") return agendarPanelHTML();
  if (state.clienteTab === "agendamentos") return meusAgendamentosHTML();
  if (state.clienteTab === "historico") return historicoHTML();
  return "";
}

function petsPanelHTML({ pets, editable, contexto }) {
  const ctxAttr = contexto ? `data-ctx="${contexto}"` : "";
  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
    <p class="h2" style="margin:0">Pets</p>
    <button class="btn btn-outline btn-sm" data-action="toggle-add-pet" ${ctxAttr}>+ Adicionar pet</button>
  </div>`;

  const mostrarForm = contexto ? state.vetAddPetPara === contexto : state.clienteMostrarAddPet;
  if (mostrarForm) {
    html += `
    <div class="card">
      <div class="row2">
        <div class="field"><label class="label">Nome do pet</label><input class="input" id="np-nome-${contexto || "cli"}" /></div>
        <div class="field"><label class="label">Espécie</label>
          <select class="input" id="np-especie-${contexto || "cli"}"><option>Cão</option><option>Gato</option><option>Ave</option><option>Outro</option></select>
        </div>
      </div>
      <div class="row2">
        <div class="field"><label class="label">Raça</label><input class="input" id="np-raca-${contexto || "cli"}" /></div>
        <div class="field"><label class="label">Idade</label><input class="input" id="np-idade-${contexto || "cli"}" placeholder="ex: 3 anos" /></div>
      </div>
      <div class="field"><label class="label">Observações (opcional)</label><textarea class="input" id="np-obs-${contexto || "cli"}"></textarea></div>
      <div style="display:flex;gap:.5rem">
        <button class="btn btn-primary btn-sm" data-action="salvar-pet" ${ctxAttr}>✓ Salvar pet</button>
        <button class="btn btn-ghost btn-sm" data-action="toggle-add-pet" ${ctxAttr}>Cancelar</button>
      </div>
    </div>`;
  }

  if (pets.length === 0 && !mostrarForm) {
    html += `<div class="card center muted">🐾<br/>Nenhum pet cadastrado ainda.</div>`;
  }

  pets.forEach((pet) => {
    const aberto = state.clienteExpandidoPet === pet.id;
    html += `
    <div class="card card-tight">
      <button data-action="toggle-pet" data-id="${pet.id}" style="width:100%;background:none;border:none;padding:0;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:.6rem">
        <span style="display:flex;align-items:center;gap:.7rem;min-width:0">
          ${pet.fotoPath ? `<img src="${pet.fotoPath}" class="avatar-round" style="width:2.6rem;height:2.6rem" />` : `<span style="width:2.6rem;height:2.6rem;border-radius:999px;background:var(--bg-alt);display:flex;align-items:center;justify-content:center;flex-shrink:0">🐾</span>`}
          <span style="min-width:0">
            <p style="margin:0;font-weight:700">${esc(pet.nome)}</p>
            <p class="tiny muted" style="margin:0">${esc(pet.especie)}${pet.raca ? " · " + esc(pet.raca) : ""}${pet.idade ? " · " + esc(pet.idade) : ""}</p>
          </span>
        </span>
        <span class="muted">${aberto ? "▲" : "▼"}</span>
      </button>
      ${aberto ? petExpandidoHTML(pet, editable) : ""}
    </div>`;
  });

  return html;
}

function petExpandidoHTML(pet, editable) {
  let html = `<div style="margin-top:1rem;display:flex;flex-direction:column;gap:1rem">`;
  if (pet.obs) html += `<p class="small muted">${esc(pet.obs)}</p>`;

  html += `<div class="card-tight" style="background:var(--bg);border:1px solid var(--line-soft);border-radius:10px">
    ${photoBoxHTML({ photoPath: pet.fotoPath, label: "Foto do pet", editable, round: true, addAction: "upload-foto-pet", removeAction: "remover-foto-pet", id: pet.id })}
  </div>`;

  if (editable) {
    html += `<div class="card-tight" style="background:#FBF4E4;border:1px solid var(--line);border-radius:10px">
      <p class="label" style="margin-bottom:.4rem">🔒 Notas privadas (o cliente não vê isso)</p>
      <textarea class="input" id="notas-privadas-${pet.id}" placeholder="Anotações internas sobre o paciente, comportamento, cuidados especiais...">${esc(pet.notasPrivadas || "")}</textarea>
      <button class="btn btn-outline btn-sm" style="margin-top:.5rem" data-action="salvar-notas-privadas" data-pet-id="${pet.id}">Salvar notas</button>
    </div>`;
  }

  html += `<div class="card-tight" style="background:var(--bg);border:1px solid var(--line-soft);border-radius:10px">
    <p style="font-weight:700;color:var(--green-dark);margin:0 0 .7rem;display:flex;align-items:center;gap:.4rem">💉 Carteira de vacinação digital</p>`;

  if (!pet.vacinas || pet.vacinas.length === 0) {
    html += `<p class="small muted" style="margin-bottom:1rem">Nenhuma vacina registrada ainda.</p>`;
  } else {
    html += `<div style="margin-bottom:1rem">`;
    pet.vacinas.forEach((v) => {
      html += `<div class="list-item">
        <div>
          <p style="margin:0;font-weight:700;font-size:.9rem">${esc(v.nome)}</p>
          <p class="tiny muted" style="margin:0">Aplicada em ${formatDateBR(v.data)}${v.proximaDose ? " · próxima dose " + formatDateBR(v.proximaDose) : ""}${v.lote ? " · lote " + esc(v.lote) : ""}</p>
        </div>
        ${editable ? `<button class="btn btn-ghost btn-sm" data-action="remover-vacina" data-pet-id="${pet.id}" data-vacina-id="${v.id}">🗑️</button>` : ""}
      </div>`;
    });
    html += `</div>`;
  }

  html += photoBoxHTML({ photoPath: pet.carteiraFotoPath, label: "Foto da carteira física", editable, round: false, addAction: "upload-carteira-foto", removeAction: "remover-carteira-foto", id: pet.id });

  if (editable) {
    const aberto = state.vetAddVacinaAberto === pet.id;
    if (!aberto) {
      html += `<button class="btn btn-outline btn-sm" style="margin-top:1rem" data-action="toggle-add-vacina" data-pet-id="${pet.id}">+ Registrar vacina</button>`;
    } else {
      html += `
      <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--line-soft)">
        <div class="row2">
          <div class="field"><label class="label">Vacina</label><input class="input" id="vac-nome-${pet.id}" /></div>
          <div class="field"><label class="label">Data de aplicação</label><input class="input" type="date" id="vac-data-${pet.id}" value="${todayISO()}" /></div>
        </div>
        <div class="row2">
          <div class="field"><label class="label">Próxima dose (opcional)</label><input class="input" type="date" id="vac-proxima-${pet.id}" /></div>
          <div class="field"><label class="label">Lote (opcional)</label><input class="input" id="vac-lote-${pet.id}" /></div>
        </div>
        <div style="display:flex;gap:.5rem">
          <button class="btn btn-primary btn-sm" data-action="salvar-vacina" data-pet-id="${pet.id}">✓ Salvar vacina</button>
          <button class="btn btn-ghost btn-sm" data-action="toggle-add-vacina" data-pet-id="${pet.id}">Cancelar</button>
        </div>
      </div>`;
    }
  }

  html += `</div></div>`;
  return html;
}

function photoBoxHTML({ photoPath, label, editable, round, addAction, removeAction, id }) {
  const inputId = `file-${addAction}-${id}`;
  let html = `<p class="label" style="margin-bottom:.5rem">${esc(label)}</p>`;
  if (photoPath) {
    html += `<div style="display:flex;gap:.8rem;align-items:flex-start;flex-wrap:wrap">
      <img src="${photoPath}" class="${round ? "avatar-round" : "thumb-square"} clickable-photo" data-action="ver-midia" data-src="${photoPath}" data-tipo="imagem" />
      ${editable ? `
      <div style="display:flex;flex-direction:column;gap:.5rem">
        <button class="btn btn-outline btn-sm" data-action="trigger-file" data-target="${inputId}">📷 Substituir</button>
        <button class="btn btn-danger btn-sm" data-action="${removeAction}" data-id="${id}">🗑️ Remover</button>
      </div>` : ""}
    </div>`;
  } else {
    html += `<p class="small muted" style="margin-bottom:.6rem">Nenhuma foto cadastrada.</p>`;
    if (editable) html += `<button class="btn btn-outline btn-sm" data-action="trigger-file" data-target="${inputId}">📷 Adicionar foto</button>`;
  }
  if (editable) html += `<input type="file" accept="image/*" id="${inputId}" class="hidden-file" data-upload="${addAction}" data-id="${id}" style="display:none" />`;
  return html;
}

function agendarPanelHTML() {
  const c = state.cliente;
  const pets = state.pets;
  const end = state.agendarEnd || {};
  return `
  <p class="h2">Agendar nova visita</p>
  <div class="card">
    <div class="field"><label class="label">Pet</label>
      <select class="input" id="ag-pet">
        ${pets.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join("")}
        <option value="novo">+ Outro pet (ainda não cadastrado)</option>
      </select>
    </div>
    <div class="field" id="ag-pet-novo-wrap" style="${pets.length ? "display:none" : ""}">
      <label class="label">Nome do novo pet</label><input class="input" id="ag-pet-novo-nome" />
    </div>

    <p class="eyebrow" style="margin-top:.3rem">DÊ ATÉ 3 OPÇÕES DE DIA E HORÁRIO</p>
    <p class="tiny muted" style="margin:-.4rem 0 .8rem">A veterinária vai escolher a que funciona melhor para ela e confirmar com você.</p>
    ${[1, 2, 3].map((n) => `
      <div class="row2" style="margin-bottom:.6rem">
        <div class="field" style="margin-bottom:0"><label class="label">Opção ${n}${n === 1 ? "" : " (opcional)"} — dia</label><input class="input" type="date" id="ag-op${n}-data" min="${todayISO()}" /></div>
        <div class="field" style="margin-bottom:0"><label class="label">Horário</label><input class="input" type="time" id="ag-op${n}-horario" /></div>
      </div>`).join("")}

    <hr class="hr" />
    <p class="eyebrow">ENDEREÇO DA VISITA</p>
    <div class="row2">
      <div class="field"><label class="label">CEP</label><input class="input" id="end-cep" data-mask="cep" data-cep-lookup="1" inputmode="numeric" placeholder="00000-000" value="${esc(end.cep || "")}" /></div>
      <div class="field"><label class="label">Número</label><input class="input" id="end-numero" value="${esc(end.numero || "")}" /></div>
    </div>
    <div id="cep-msg"></div>
    <div class="field"><label class="label">Rua</label><input class="input" id="end-rua" value="${esc(end.rua || "")}" /></div>
    <div class="row2">
      <div class="field"><label class="label">Complemento (opcional)</label><input class="input" id="end-complemento" value="${esc(end.complemento || "")}" /></div>
      <div class="field"><label class="label">Bairro</label><input class="input" id="end-bairro" value="${esc(end.bairro || "")}" /></div>
    </div>
    <div class="row2">
      <div class="field"><label class="label">Cidade</label><input class="input" id="end-cidade" value="${esc(end.cidade || "")}" /></div>
      <div class="field"><label class="label">UF</label><input class="input" id="end-uf" maxlength="2" value="${esc(end.uf || "")}" /></div>
    </div>

    <hr class="hr" />
    <div class="field"><label class="label">Motivo da visita</label><textarea class="input" id="ag-motivo" placeholder="ex: consulta de rotina, vacinação, mal-estar..."></textarea></div>

    <div class="field">
      <label class="label">Foto ou vídeo do que está acontecendo (opcional)</label>
      <button class="btn btn-outline btn-sm" data-action="trigger-file" data-target="ag-midia">📷 Anexar mídia</button>
      <input type="file" id="ag-midia" accept="image/*,video/*" style="display:none" data-upload="staged-midia" />
      <p class="tiny muted" id="ag-midia-nome" style="margin-top:.4rem">${stagedMidiaFile ? "Selecionado: " + esc(stagedMidiaFile.name) : ""}</p>
    </div>

    <div id="ag-err"></div>
    <button class="btn btn-primary btn-block" data-action="cliente-agendar">📅 Enviar opções para a veterinária</button>
  </div>`;
}

function meusAgendamentosHTML() {
  const lista = state.meusAgendamentos;
  if (lista.length === 0) return `<div class="card center muted">🗂️<br/>Você ainda não tem agendamentos.</div>`;
  return lista.map((a) => `
    <div class="card">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;flex-wrap:wrap">
        <p style="margin:0;font-weight:700">${esc(a.petNome)}</p>${badge(a.status)}
      </div>
      ${a.status === "aguardando" ? `
        <p class="small muted" style="margin:.2rem 0">Opções enviadas:</p>
        <ul class="small muted" style="margin:.2rem 0 .4rem;padding-left:1.1rem">
          ${a.opcoes.map((o) => `<li>${formatDateBR(o.data)} às ${o.horario}</li>`).join("")}
        </ul>` : `<p class="small muted" style="margin:.2rem 0">${formatDateBR(a.data)} às ${a.horario}</p>`}
      <p class="small muted" style="margin:.2rem 0">${esc(a.motivo)}</p>
      ${a.endereco ? `<p class="tiny muted" style="margin:.2rem 0">📍 ${esc(enderecoTexto(a.endereco))}</p>` : ""}
      ${a.midiaPath ? `<div style="margin:.5rem 0">${a.midiaTipo === "video" ? `<video src="${a.midiaPath}" controls class="thumb-square clickable-photo" style="width:100%;height:auto;max-width:220px" data-action="ver-midia" data-src="${a.midiaPath}" data-tipo="video"></video>` : `<img src="${a.midiaPath}" class="thumb-square clickable-photo" style="width:100%;height:auto;max-width:220px" data-action="ver-midia" data-src="${a.midiaPath}" data-tipo="imagem" />`}</div>` : ""}
      ${a.observacoesVet && a.status !== "recusado" ? `<p class="small" style="margin:.4rem 0 0;color:var(--green-dark)">Obs. da veterinária: ${esc(a.observacoesVet)}</p>` : ""}
      ${a.status === "confirmado" ? `<div style="margin-top:.6rem">${calendarButtonHTML(a)}</div>` : ""}
      ${anexosHTML(a, false)}
      ${["aguardando", "confirmado"].includes(a.status) ? `<button class="btn btn-danger btn-sm" style="margin-top:.7rem" data-action="cliente-cancelar" data-id="${a.id}">✕ Cancelar</button>` : ""}
    </div>`).join("");
}

function historicoHTML() {
  const lista = state.meusAgendamentos.filter((a) => a.status === "concluido");
  if (lista.length === 0) return `<div class="card center muted">💉<br/>Nenhum atendimento concluído ainda.</div>`;
  return lista.map((a) => `
    <div class="card">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem"><p style="margin:0;font-weight:700">${esc(a.petNome)}</p>${badge(a.status)}</div>
      <p class="small muted" style="margin:.2rem 0">${formatDateBR(a.data)} · ${esc(a.motivo)}</p>
      ${a.observacoesVet ? `<p class="small" style="margin-top:.5rem;background:var(--bg);border-radius:8px;padding:.6rem">${esc(a.observacoesVet)}</p>` : ""}
      ${anexosHTML(a, false)}
    </div>`).join("");
}

/* ============================= VET: LOGIN ============================= */
function viewVetLogin() {
  return `
  <div class="landing-hero" style="background:var(--green-dark)"><div style="max-width:380px;width:100%">
    <button class="btn btn-ghost" data-action="ir" data-view="landing" style="color:#C9D6C4">← Voltar</button>
    <div class="card" style="margin-top:.5rem" data-enter="vet-login">
      <div class="ic-lg" style="background:var(--clay)">🛡️</div>
      <p class="serif" style="font-size:1.4rem;margin:.6rem 0 .2rem">Área restrita</p>
      <p class="small muted" style="margin-bottom:1.2rem">Acesso exclusivo da veterinária.</p>
      <div class="field"><label class="label">Senha de acesso</label><input class="input" id="vet-senha" type="password" /></div>
      <div id="vet-login-err"></div>
      <button class="btn btn-primary btn-block" style="margin-top:.8rem" data-action="vet-login">🔒 Entrar</button>
    </div>
  </div></div>`;
}

/* ============================= VET: DASHBOARD ============================= */
function viewVetDash() {
  const tabs = [
    ["painel", "📊", "Painel"],
    ["solicitacoes", "🔔", "Solicitações"],
    ["agenda", "📅", "Agenda"],
    ["clientes", "👤", "Clientes"],
    ["carteiras", "💉", "Carteiras"],
    ["config", "⚙️", "Config."],
  ];
  return `
  <div class="vd-shell">
    ${topBar({ titulo: "Painel da veterinária", subtitulo: "Área restrita", icone: "🩺" })}
    <div class="vd-main">
      ${vetTabContent()}
    </div>
    <div class="vd-tabs-bar vd-tabs">
      ${tabs.map(([id, ic, label]) => `
        <button class="vd-tab ${state.vetTab === id ? "active" : ""}" data-action="tab-vet" data-tab="${id}">
          <span class="ic">${ic}</span><span>${label}</span>
        </button>`).join("")}
    </div>
  </div>`;
}

function alterarSenhaHTML() {
  return `
  <div class="card" style="max-width:420px">
    <p style="font-weight:700;margin:0 0 .8rem">🔑 Alterar senha de acesso</p>
    <div class="field"><input class="input" type="password" id="senha-atual" placeholder="Senha atual" /></div>
    <div class="field"><input class="input" type="password" id="senha-nova" placeholder="Nova senha" /></div>
    <div class="field"><input class="input" type="password" id="senha-confirma" placeholder="Confirmar nova senha" /></div>
    <div id="senha-err"></div>
    <button class="btn btn-primary btn-sm" data-action="vet-salvar-senha">Salvar senha</button>
  </div>`;
}

function vetTabContent() {
  if (state.vetTab === "painel") return vetPainelHTML();
  if (state.vetTab === "solicitacoes") return vetSolicitacoesHTML();
  if (state.vetTab === "agenda") return vetAgendaHTML();
  if (state.vetTab === "clientes") return vetClientesHTML();
  if (state.vetTab === "carteiras") return vetCarteirasHTML();
  if (state.vetTab === "config") return vetConfigHTML();
  return "";
}

function vetPainelHTML() {
  const p = state.vetPainel || { proximos: [], vacinasVencendo: [], solicitacoesPendentes: 0 };
  return `
  <p class="h2">Painel</p>
  ${p.solicitacoesPendentes > 0 ? `
    <button class="card" style="width:100%;text-align:left;border:none;cursor:pointer;background:var(--warn-bg)" data-action="tab-vet" data-tab="solicitacoes">
      <p style="margin:0;font-weight:800;color:var(--warn-fg)">🔔 ${p.solicitacoesPendentes} solicitação(ões) aguardando sua confirmação</p>
    </button>` : ""}
  <div class="grid2">
    <div class="card">
      <p style="font-weight:700;margin:0 0 .8rem;display:flex;align-items:center;gap:.4rem">📅 Próximos agendamentos</p>
      ${p.proximos.length === 0 ? `<p class="small muted">Nenhum agendamento confirmado no momento.</p>` :
        p.proximos.map((a) => `
        <div class="list-item">
          <div><p style="margin:0;font-weight:700;font-size:.88rem">${esc(a.petNome)} <span class="muted" style="font-weight:500"> · ${esc(a.clienteNome)}</span></p><p class="tiny muted" style="margin:0">${formatDateBR(a.data)} às ${a.horario}</p></div>
          ${badge(a.status)}
        </div>`).join("")}
    </div>
    <div class="card">
      <p style="font-weight:700;margin:0 0 .8rem;display:flex;align-items:center;gap:.4rem">🔔 Vacinas vencendo (30 dias)</p>
      ${p.vacinasVencendo.length === 0 ? `<p class="small muted">Nenhuma vacina vencendo em breve.</p>` :
        p.vacinasVencendo.slice(0, 8).map((v) => `
        <div class="list-item">
          <div><p style="margin:0;font-weight:700;font-size:.88rem">${esc(v.petNome)} <span class="muted" style="font-weight:500"> · ${esc(v.vacina)}</span></p><p class="tiny muted" style="margin:0">${esc(v.clienteNome)}</p></div>
          <span class="badge" style="background:${v.diff < 0 ? "var(--danger-bg)" : "var(--warn-bg)"};color:${v.diff < 0 ? "var(--danger)" : "var(--warn-fg)"}">${v.diff < 0 ? `vencida há ${Math.abs(v.diff)}d` : v.diff === 0 ? "vence hoje" : `em ${v.diff}d`}</span>
        </div>`).join("")}
    </div>
  </div>`;
}

function vetSolicitacoesHTML() {
  const pendentes = state.vetSolicitacoes;
  return `
  <p class="h2">Solicitações de agendamento</p>
  ${pendentes.length === 0 ? `<div class="card center muted">🔔<br/>Nenhuma solicitação pendente no momento.</div>` : pendentes.map((a) => `
    <div class="card">
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.3rem">
        <p style="margin:0;font-weight:700">${esc(a.petNome)} <span class="muted" style="font-weight:500">· ${esc(a.clienteNome)}</span></p>
      </div>
      <p class="small muted" style="margin:.2rem 0">${esc(a.motivo)}</p>
      ${a.clienteTelefone ? `<p class="tiny muted" style="margin:.2rem 0">📞 ${esc(a.clienteTelefone)}</p>` : ""}
      ${a.endereco ? `<div class="small muted" style="margin:.4rem 0"><p style="margin:0">📍 ${esc(enderecoTexto(a.endereco))}</p><a class="link tiny" href="${mapsUrl(a.endereco)}" target="_blank" rel="noopener">Abrir no mapa →</a></div>` : ""}
      ${a.midiaPath ? `<div style="margin:.6rem 0">${a.midiaTipo === "video" ? `<video src="${a.midiaPath}" controls class="thumb-square clickable-photo" style="width:100%;height:auto;max-width:280px" data-action="ver-midia" data-src="${a.midiaPath}" data-tipo="video"></video>` : `<img src="${a.midiaPath}" class="thumb-square clickable-photo" style="width:100%;height:auto;max-width:280px" data-action="ver-midia" data-src="${a.midiaPath}" data-tipo="imagem" />`}</div>` : ""}
      <p class="eyebrow" style="margin-top:.7rem">OPÇÕES ENVIADAS PELO CLIENTE</p>
      <div>
        ${a.opcoes.map((o, i) => `
          <div class="slot slot-row" style="justify-content:space-between">
            <span>🕒 ${formatDateBR(o.data)} às ${o.horario}</span>
            <button class="btn btn-dark btn-sm" data-action="vet-confirmar" data-id="${a.id}" data-idx="${i}">✓ Escolher</button>
          </div>`).join("")}
      </div>
      <button class="btn btn-danger btn-sm" style="margin-top:.4rem" data-action="vet-recusar" data-id="${a.id}">✕ Recusar solicitação</button>
    </div>`).join("")}`;
}

function anexosHTML(ag, editable) {
  const anexos = ag.anexosVet || [];
  if (!editable && anexos.length === 0) return "";
  let html = `<div style="margin-top:.7rem;padding-top:.7rem;border-top:1px solid var(--line-soft)">
    <p class="label" style="margin-bottom:.5rem">📎 Anexos (receitas, exames...)</p>`;
  if (anexos.length === 0) {
    html += `<p class="tiny muted" style="margin-bottom:.5rem">Nenhum arquivo anexado.</p>`;
  } else {
    anexos.forEach((a) => {
      html += `<div class="list-item">
        <a href="${a.path}" target="_blank" rel="noopener" class="small" style="text-decoration:none;color:var(--ink);display:flex;align-items:center;gap:.4rem;min-width:0"><span>${fileIconFor(a.mime)}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.nome)}</span></a>
        ${editable ? `<button class="btn btn-ghost btn-sm" data-action="remover-anexo" data-id="${ag.id}" data-anexo-id="${a.id}">🗑️</button>` : ""}
      </div>`;
    });
  }
  if (editable) {
    html += `<button class="btn btn-outline btn-sm" style="margin-top:.4rem" data-action="trigger-file" data-target="anexo-file-${ag.id}">📎 Anexar arquivo</button>
    <input type="file" id="anexo-file-${ag.id}" style="display:none" data-upload="anexo-vet" data-id="${ag.id}" accept="image/*,application/pdf,.doc,.docx,.txt" />`;
  }
  html += `</div>`;
  return html;
}

function calendarButtonHTML(ag) {
  return `<a href="${googleCalendarUrl(ag)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">📆 Google Agenda</a>`;
}

function vetAgendaHTML() {
  const filtros = [["todos", "Todos"], ["confirmado", "Confirmados"], ["concluido", "Concluídos"], ["cancelado", "Cancelados"], ["recusado", "Recusados"]];
  const lista = state.vetAgendaLista.filter((a) => a.status !== "aguardando");
  return `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem">
    <p class="h2" style="margin:0">Agenda</p>
    <select class="input" id="agenda-filtro" style="width:auto" data-action-change="filtro-agenda">
      ${filtros.map(([v, l]) => `<option value="${v}" ${state.vetAgendaFiltro === v ? "selected" : ""}>${l}</option>`).join("")}
    </select>
  </div>
  ${lista.length === 0 ? `<div class="card center muted">Nenhum agendamento nesse filtro.</div>` : lista.map((a) => `
    <div class="card">
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.3rem">
        <p style="margin:0;font-weight:700">${esc(a.petNome)} <span class="muted" style="font-weight:500">· ${esc(a.clienteNome)}</span></p>${badge(a.status)}
      </div>
      <p class="small muted" style="margin:.2rem 0">${formatDateBR(a.data)} às ${a.horario} · ${esc(a.motivo)}</p>
      ${a.clienteTelefone ? `<p class="tiny muted" style="margin:.2rem 0">📞 ${esc(a.clienteTelefone)}</p>` : ""}
      ${a.endereco ? `<div class="small muted" style="margin:.4rem 0"><p style="margin:0">📍 ${esc(enderecoTexto(a.endereco))}</p><a class="link tiny" href="${mapsUrl(a.endereco)}" target="_blank" rel="noopener">Abrir no mapa →</a></div>` : ""}
      ${a.midiaPath ? `<div style="margin:.6rem 0">${a.midiaTipo === "video" ? `<video src="${a.midiaPath}" controls class="thumb-square clickable-photo" style="width:100%;height:auto;max-width:280px" data-action="ver-midia" data-src="${a.midiaPath}" data-tipo="video"></video>` : `<img src="${a.midiaPath}" class="thumb-square clickable-photo" style="width:100%;height:auto;max-width:280px" data-action="ver-midia" data-src="${a.midiaPath}" data-tipo="imagem" />`}</div>` : ""}
      ${a.status === "confirmado" ? `<div style="margin:.5rem 0">${calendarButtonHTML(a)}</div>` : ""}
      ${a.status === "confirmado" ? `
        <div style="margin-top:.7rem;padding-top:.7rem;border-top:1px solid var(--line-soft)">
          <p class="label">Concluir atendimento e registrar observações</p>
          <textarea class="input" id="obs-${a.id}" placeholder="O que foi feito na visita, orientações, prescrições..."></textarea>
          <div style="display:flex;gap:.5rem;margin-top:.5rem">
            <button class="btn btn-primary btn-sm" data-action="vet-concluir" data-id="${a.id}">✓ Marcar como concluído</button>
            <button class="btn btn-danger btn-sm" data-action="vet-cancelar" data-id="${a.id}">✕ Cancelar</button>
          </div>
        </div>` : ""}
      ${a.status === "concluido" && a.observacoesVet ? `<p class="small" style="margin-top:.6rem;background:var(--bg);border-radius:8px;padding:.6rem">${esc(a.observacoesVet)}</p>` : ""}
      ${["confirmado", "concluido"].includes(a.status) ? anexosHTML(a, true) : ""}
    </div>`).join("")}`;
}

function vetClientesHTML() {
  const termo = state.vetBusca.toLowerCase();
  const lista = state.vetClientes.filter((c) => c.nome.toLowerCase().includes(termo) || c.cpf.includes(onlyDigits(state.vetBusca)));
  return `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem">
    <p class="h2" style="margin:0">Clientes</p>
    <button class="btn btn-outline btn-sm" data-action="toggle-novo-cliente">+ Novo cliente</button>
  </div>
  <div class="field"><input class="input" id="busca-cliente" placeholder="🔎 Buscar por nome ou CPF" value="${esc(state.vetBusca)}" /></div>
  ${state.vetShowNovoCliente ? novoClienteFormHTML() : ""}
  ${lista.length === 0 ? `<div class="card center muted">Nenhum cliente encontrado.</div>` : lista.map((c) => clienteExpandivelHTML(c)).join("")}`;
}

function novoClienteFormHTML() {
  return `
  <div class="card">
    <p style="font-weight:700;margin:0 0 .8rem">Cadastrar novo cliente</p>
    <div class="row2">
      <div class="field"><label class="label">Nome</label><input class="input" id="nc-nome" /></div>
      <div class="field"><label class="label">CPF</label><input class="input" id="nc-cpf" data-mask="cpf" inputmode="numeric" /></div>
    </div>
    <div class="row2">
      <div class="field"><label class="label">Telefone</label><input class="input" id="nc-telefone" data-mask="phone" inputmode="numeric" /></div>
      <div class="field"><label class="label">E-mail (opcional)</label><input class="input" id="nc-email" type="email" /></div>
    </div>
    <div class="field"><label class="label">Senha temporária</label><input class="input" id="nc-senha" /></div>
    <hr class="hr" />
    <p class="eyebrow">PET (opcional)</p>
    <div class="row2">
      <div class="field"><label class="label">Nome do pet</label><input class="input" id="nc-pet-nome" /></div>
      <div class="field"><label class="label">Espécie</label><select class="input" id="nc-pet-especie"><option>Cão</option><option>Gato</option><option>Ave</option><option>Outro</option></select></div>
    </div>
    <div id="nc-err"></div>
    <div style="display:flex;gap:.5rem">
      <button class="btn btn-primary btn-sm" data-action="vet-criar-cliente">✓ Salvar cliente</button>
      <button class="btn btn-ghost btn-sm" data-action="toggle-novo-cliente">Cancelar</button>
    </div>
  </div>`;
}

function clienteExpandivelHTML(c) {
  const aberto = state.vetExpandidoCliente === c.cpf;
  let html = `
  <div class="card card-tight" data-cliente-cpf="${c.cpf}" data-cliente-nome="${esc(c.nome.toLowerCase())}">
    <button data-action="toggle-cliente" data-cpf="${c.cpf}" style="width:100%;background:none;border:none;padding:0;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between">
      <span>
        <p style="margin:0;font-weight:700">${esc(c.nome)}</p>
        <p class="tiny muted" style="margin:0">${formatCPF(c.cpf)}${c.telefone ? " · " + esc(c.telefone) : ""} · ${c.pets.length} pet(s)</p>
      </span>
      <span class="muted">${aberto ? "▲" : "▼"}</span>
    </button>`;

  if (aberto) {
    html += `
    <div style="margin-top:1rem">
      <div class="row2">
        <div class="field"><label class="label">Nome</label><input class="input" id="cli-nome-${c.cpf}" value="${esc(c.nome)}" /></div>
        <div class="field"><label class="label">Telefone</label><input class="input" id="cli-telefone-${c.cpf}" data-mask="phone" value="${esc(c.telefone)}" /></div>
      </div>
      <div class="field"><label class="label">E-mail</label><input class="input" id="cli-email-${c.cpf}" type="email" value="${esc(c.email || "")}" /></div>
      <button class="btn btn-outline btn-sm" data-action="vet-salvar-cliente" data-cpf="${c.cpf}">Salvar dados do cliente</button>
      ${c.enderecoPadrao ? `<p class="tiny muted" style="margin-top:.7rem">📍 Último endereço usado: ${esc(enderecoTexto(c.enderecoPadrao))}</p>` : ""}
      <hr class="hr" />
      ${petsPanelHTML({ pets: c.pets, editable: true, contexto: c.cpf })}
    </div>`;
  }
  html += `</div>`;
  return html;
}

function vetCarteirasHTML() {
  const clientes = state.vetClientes;
  if (clientes.length === 0) return `<div class="card center muted">Cadastre um cliente para gerenciar carteiras de vacinação.</div>`;
  const cpf = state.vetCarteiraCpf || clientes[0].cpf;
  const cliente = clientes.find((c) => c.cpf === cpf) || clientes[0];
  const petId = state.vetCarteiraPetId || cliente.pets[0]?.id || "";
  const pet = cliente.pets.find((p) => p.id === petId);

  let html = `
  <p class="h2">Carteiras de vacinação</p>
  <div class="row2" style="max-width:520px">
    <div class="field"><label class="label">Cliente</label>
      <select class="input" id="carteira-cliente" data-action-change="carteira-cliente">
        ${clientes.map((c) => `<option value="${c.cpf}" ${c.cpf === cliente.cpf ? "selected" : ""}>${esc(c.nome)}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label class="label">Pet</label>
      <select class="input" id="carteira-pet" data-action-change="carteira-pet">
        ${cliente.pets.map((p) => `<option value="${p.id}" ${p.id === pet?.id ? "selected" : ""}>${esc(p.nome)}</option>`).join("")}
      </select>
    </div>
  </div>`;

  if (!pet) {
    html += `<div class="card center muted">Este cliente ainda não tem pets cadastrados.</div>`;
    return html;
  }

  html += `<div class="card" style="max-width:520px">
    <p style="font-weight:700;margin:0 0 1rem">${esc(pet.nome)} <span class="muted" style="font-weight:500">· ${esc(pet.especie)}</span></p>
    ${photoBoxHTML({ photoPath: pet.fotoPath, label: "Foto do pet", editable: true, round: true, addAction: "upload-foto-pet", removeAction: "remover-foto-pet", id: pet.id })}
    <hr class="hr" />`;

  if (!pet.vacinas || pet.vacinas.length === 0) {
    html += `<p class="small muted" style="margin-bottom:1rem">Nenhuma vacina registrada.</p>`;
  } else {
    pet.vacinas.forEach((v) => {
      html += `<div class="list-item">
        <div><p style="margin:0;font-weight:700;font-size:.9rem">${esc(v.nome)}</p><p class="tiny muted" style="margin:0">Aplicada em ${formatDateBR(v.data)}${v.proximaDose ? " · próxima dose " + formatDateBR(v.proximaDose) : ""}${v.lote ? " · lote " + esc(v.lote) : ""}</p></div>
        <button class="btn btn-ghost btn-sm" data-action="remover-vacina" data-pet-id="${pet.id}" data-vacina-id="${v.id}">🗑️</button>
      </div>`;
    });
  }

  const abertoVac = state.vetAddVacinaAberto === pet.id;
  if (!abertoVac) {
    html += `<button class="btn btn-outline btn-sm" style="margin-top:.8rem" data-action="toggle-add-vacina" data-pet-id="${pet.id}">+ Registrar vacina</button>`;
  } else {
    html += `
    <div style="margin-top:.8rem">
      <div class="row2">
        <div class="field"><label class="label">Vacina</label><input class="input" id="vac-nome-${pet.id}" /></div>
        <div class="field"><label class="label">Data de aplicação</label><input class="input" type="date" id="vac-data-${pet.id}" value="${todayISO()}" /></div>
      </div>
      <div class="row2">
        <div class="field"><label class="label">Próxima dose (opcional)</label><input class="input" type="date" id="vac-proxima-${pet.id}" /></div>
        <div class="field"><label class="label">Lote (opcional)</label><input class="input" id="vac-lote-${pet.id}" /></div>
      </div>
      <div style="display:flex;gap:.5rem">
        <button class="btn btn-primary btn-sm" data-action="salvar-vacina" data-pet-id="${pet.id}">✓ Salvar vacina</button>
        <button class="btn btn-ghost btn-sm" data-action="toggle-add-vacina" data-pet-id="${pet.id}">Cancelar</button>
      </div>
    </div>`;
  }

  html += `<hr class="hr" />${photoBoxHTML({ photoPath: pet.carteiraFotoPath, label: "Foto da carteira física", editable: true, round: false, addAction: "upload-carteira-foto", removeAction: "remover-carteira-foto", id: pet.id })}</div>`;
  return html;
}

function vetConfigHTML() {
  const cfg = state.vetConfig || state.publicConfig;
  return `
  <p class="h2">Configurações</p>

  ${alterarSenhaHTML()}

  <div class="card" style="max-width:520px">
    <p style="font-weight:700;margin:0 0 .3rem">🎨 Identidade visual</p>
    <p class="tiny muted" style="margin:0 0 .9rem">O nome, o slogan e a logo aparecem na tela inicial e no topo do sistema, para clientes e para você.</p>

    <p class="label" style="margin-bottom:.5rem">Logo</p>
    ${cfg.logoPath ? `
      <div style="display:flex;gap:.8rem;align-items:flex-start;flex-wrap:wrap;margin-bottom:1rem">
        <img src="${cfg.logoPath}" class="thumb-square clickable-photo" style="width:96px;height:96px" data-action="ver-midia" data-src="${cfg.logoPath}" data-tipo="imagem" />
        <div style="display:flex;flex-direction:column;gap:.5rem">
          <button class="btn btn-outline btn-sm" data-action="trigger-file" data-target="logo-file">📷 Substituir</button>
          <button class="btn btn-danger btn-sm" data-action="remover-logo">🗑️ Remover</button>
        </div>
      </div>` : `
      <div style="margin-bottom:1rem">
        <p class="small muted" style="margin-bottom:.5rem">Nenhuma logo cadastrada.</p>
        <button class="btn btn-outline btn-sm" data-action="trigger-file" data-target="logo-file">📷 Adicionar logo</button>
      </div>`}
    <input type="file" id="logo-file" accept="image/*" style="display:none" data-upload="logo" />

    <div class="field"><label class="label">Nome do negócio</label><input class="input" id="cfg-nome" value="${esc(cfg.clinicaNome || "")}" /></div>
    <div class="field"><label class="label">Slogan / frase de destaque</label><input class="input" id="cfg-slogan" value="${esc(cfg.clinicaSlogan || "")}" /></div>
    <div id="cfg-identidade-err"></div>
    <button class="btn btn-primary btn-sm" data-action="vet-salvar-identidade">Salvar identidade visual</button>
  </div>

  <div class="card" style="max-width:520px">
    <p style="font-weight:700;margin:0 0 .3rem">✉️ Mensagens automáticas</p>
    <p class="tiny muted" style="margin:0 0 .9rem">Use estas variáveis: <code>{cliente}</code> <code>{pet}</code> <code>{data}</code> <code>{horario}</code> <code>{endereco}</code> <code>{clinica}</code></p>
    <div class="field"><label class="label">Mensagem ao confirmar uma visita</label><textarea class="input" id="cfg-msg-confirma" rows="4">${esc(state.vetConfig?.mensagemConfirmacao || "")}</textarea></div>
    <div class="field"><label class="label">Mensagem ao recusar uma solicitação</label><textarea class="input" id="cfg-msg-recusa" rows="4">${esc(state.vetConfig?.mensagemRecusa || "")}</textarea></div>
    <div id="cfg-msg-err"></div>
    <button class="btn btn-primary btn-sm" data-action="vet-salvar-mensagens">Salvar mensagens</button>
  </div>`;
}

/* ============================= ações ============================= */
async function performAction(action, el) {
  try {
    switch (action) {
      case "ir": {
        state.view = el.dataset.view;
        render();
        break;
      }
      case "ver-midia": {
        showLightbox(el.dataset.src, el.dataset.tipo);
        break;
      }
      case "fechar-lightbox": {
        hideLightbox();
        break;
      }
      case "logout": {
        limparSessao();
        Object.assign(state, { view: "landing", tipo: null, cliente: null, pets: [], meusAgendamentos: [] });
        render();
        break;
      }

      /* ---- cliente auth ---- */
      case "cliente-login": {
        qs("login-err").innerHTML = "";
        try {
          const { token, cliente } = await api.post("/api/auth/login", { cpf: val("login-cpf"), senha: val("login-senha") });
          setSessao(token, "cliente");
          state.tipo = "cliente"; state.cliente = cliente;
          const me = await api.get("/api/auth/me"); state.pets = me.pets;
          await carregarMeusAgendamentos();
          state.view = "clienteDash"; state.clienteTab = "pets";
          render();
        } catch (e) { qs("login-err").innerHTML = `<p class="error-text">${esc(e.message)}</p>`; }
        break;
      }
      case "cliente-registrar": {
        qs("reg-err").innerHTML = "";
        const senha = val("reg-senha"), confirma = val("reg-confirma");
        if (senha !== confirma) { qs("reg-err").innerHTML = `<p class="error-text">As senhas não coincidem.</p>`; return; }
        try {
          const body = {
            nome: val("reg-nome"), cpf: val("reg-cpf"), telefone: val("reg-telefone"), email: val("reg-email"), senha,
            pet: { nome: val("reg-pet-nome"), especie: val("reg-pet-especie"), raca: val("reg-pet-raca"), idade: val("reg-pet-idade") },
          };
          const { token, cliente } = await api.post("/api/auth/registrar", body);
          setSessao(token, "cliente");
          state.tipo = "cliente"; state.cliente = cliente;
          const me = await api.get("/api/auth/me"); state.pets = me.pets;
          state.meusAgendamentos = [];
          state.view = "clienteDash"; state.clienteTab = "pets";
          render();
        } catch (e) { qs("reg-err").innerHTML = `<p class="error-text">${esc(e.message)}</p>`; }
        break;
      }

      /* ---- cliente dash ---- */
      case "tab-cliente": {
        state.clienteTab = el.dataset.tab;
        state.clienteExpandidoPet = null;
        render();
        break;
      }
      case "toggle-pet": {
        state.clienteExpandidoPet = state.clienteExpandidoPet === el.dataset.id ? null : el.dataset.id;
        render();
        break;
      }
      case "toggle-add-pet": {
        const ctx = el.dataset.ctx;
        if (ctx) state.vetAddPetPara = state.vetAddPetPara === ctx ? null : ctx;
        else state.clienteMostrarAddPet = !state.clienteMostrarAddPet;
        render();
        break;
      }
      case "salvar-pet": {
        const ctx = el.dataset.ctx;
        const suf = ctx || "cli";
        const body = { nome: val(`np-nome-${suf}`), especie: val(`np-especie-${suf}`), raca: val(`np-raca-${suf}`), idade: val(`np-idade-${suf}`), obs: val(`np-obs-${suf}`) };
        if (!body.nome) { showToast("Informe o nome do pet.", true); return; }
        if (ctx) body.clienteCpf = ctx;
        await api.post("/api/pets", body);
        if (ctx) { await carregarVetClientes(); state.vetAddPetPara = null; }
        else { await recarregarCliente(); state.clienteMostrarAddPet = false; }
        render();
        break;
      }
      case "toggle-add-vacina": {
        state.vetAddVacinaAberto = state.vetAddVacinaAberto === el.dataset.petId ? null : el.dataset.petId;
        render();
        break;
      }
      case "salvar-vacina": {
        const petId = el.dataset.petId;
        const nome = val(`vac-nome-${petId}`), data = val(`vac-data-${petId}`);
        if (!nome || !data) { showToast("Informe a vacina e a data.", true); return; }
        await api.post(`/api/pets/${petId}/vacinas`, { nome, data, proximaDose: val(`vac-proxima-${petId}`), lote: val(`vac-lote-${petId}`) });
        state.vetAddVacinaAberto = null;
        await refreshVetOrCliente();
        render();
        break;
      }
      case "remover-vacina": {
        await api.del(`/api/pets/${el.dataset.petId}/vacinas/${el.dataset.vacinaId}`);
        await refreshVetOrCliente();
        render();
        break;
      }
      case "salvar-notas-privadas": {
        const petId = el.dataset.petId;
        await api.patch(`/api/pets/${petId}`, { notasPrivadas: val(`notas-privadas-${petId}`) });
        await refreshVetOrCliente();
        showToast("Notas privadas salvas.");
        render();
        break;
      }
      case "trigger-file": qs(el.dataset.target)?.click(); break;
      case "remover-foto-pet": {
        await api.del(`/api/pets/${el.dataset.id}/foto`);
        await refreshVetOrCliente(); render();
        break;
      }
      case "remover-carteira-foto": {
        await api.del(`/api/pets/${el.dataset.id}/carteira-foto`);
        await refreshVetOrCliente(); render();
        break;
      }

      /* ---- agendar ---- */
      case "cliente-agendar": {
        qs("ag-err").innerHTML = "";
        const petSel = val("ag-pet") || qs("ag-pet")?.value;
        const petId = petSel === "novo" ? null : petSel;
        const petNome = petSel === "novo" ? val("ag-pet-novo-nome") : (state.pets.find((p) => p.id === petSel)?.nome || "");
        const opcoes = [];
        for (const n of [1, 2, 3]) {
          const d = val(`ag-op${n}-data`), h = val(`ag-op${n}-horario`);
          if (d && h) opcoes.push({ data: d, horario: h });
        }
        const endereco = { cep: val("end-cep"), numero: val("end-numero"), rua: val("end-rua"), complemento: val("end-complemento"), bairro: val("end-bairro"), cidade: val("end-cidade"), uf: val("end-uf") };
        const motivo = val("ag-motivo");

        if (!petNome) return qs("ag-err").innerHTML = `<p class="error-text">Informe o pet da visita.</p>`;
        if (opcoes.length === 0) return qs("ag-err").innerHTML = `<p class="error-text">Informe ao menos uma opção de dia e horário.</p>`;
        if (!endereco.rua || !endereco.numero || !endereco.cidade) return qs("ag-err").innerHTML = `<p class="error-text">Preencha o endereço completo (rua, número e cidade).</p>`;
        if (!motivo) return qs("ag-err").innerHTML = `<p class="error-text">Descreva o motivo da visita.</p>`;

        const fd = new FormData();
        if (petId) fd.append("petId", petId);
        fd.append("petNome", petNome);
        fd.append("motivo", motivo);
        fd.append("endereco", JSON.stringify(endereco));
        fd.append("opcoes", JSON.stringify(opcoes));
        if (stagedMidiaFile) fd.append("midia", stagedMidiaFile);

        await api.postForm("/api/agendamentos", fd);
        stagedMidiaFile = null;
        await recarregarCliente();
        await carregarMeusAgendamentos();
        showToast("Solicitação enviada! A veterinária vai escolher um dos horários e confirmar com você.");
        state.clienteTab = "agendamentos";
        render();
        break;
      }
      case "cliente-cancelar": {
        await api.post(`/api/agendamentos/${el.dataset.id}/cancelar`);
        await carregarMeusAgendamentos();
        render();
        break;
      }
      case "remover-anexo": {
        await api.del(`/api/agendamentos/${el.dataset.id}/anexos/${el.dataset.anexoId}`);
        await Promise.all([carregarVetAgenda(), carregarVetPainel()]);
        render();
        break;
      }

      /* ---- vet auth ---- */
      case "vet-login": {
        qs("vet-login-err").innerHTML = "";
        try {
          const { token } = await api.post("/api/auth/vet-login", { senha: val("vet-senha") });
          setSessao(token, "vet");
          state.tipo = "vet";
          await Promise.all([carregarVetPainel(), carregarVetAgenda(), carregarVetClientes()]);
          state.view = "vetDash"; state.vetTab = "painel";
          render();
        } catch (e) { qs("vet-login-err").innerHTML = `<p class="error-text">${esc(e.message)}</p>`; }
        break;
      }
      case "vet-salvar-senha": {
        qs("senha-err").innerHTML = "";
        const nova = val("senha-nova"), confirma = val("senha-confirma");
        if (nova !== confirma) { qs("senha-err").innerHTML = `<p class="error-text">As senhas não coincidem.</p>`; return; }
        try {
          await api.post("/api/vet/senha", { atual: val("senha-atual"), nova });
          showToast("Senha alterada com sucesso.");
          render();
        } catch (e) { qs("senha-err").innerHTML = `<p class="error-text">${esc(e.message)}</p>`; }
        break;
      }
      case "vet-salvar-identidade": {
        qs("cfg-identidade-err").innerHTML = "";
        try {
          state.vetConfig = await api.patch("/api/vet/config", { clinicaNome: val("cfg-nome"), clinicaSlogan: val("cfg-slogan") });
          await carregarConfigPublico();
          showToast("Identidade visual atualizada.");
          render();
        } catch (e) { qs("cfg-identidade-err").innerHTML = `<p class="error-text">${esc(e.message)}</p>`; }
        break;
      }
      case "vet-salvar-mensagens": {
        qs("cfg-msg-err").innerHTML = "";
        try {
          state.vetConfig = await api.patch("/api/vet/config", { mensagemConfirmacao: val("cfg-msg-confirma"), mensagemRecusa: val("cfg-msg-recusa") });
          showToast("Mensagens automáticas atualizadas.");
          render();
        } catch (e) { qs("cfg-msg-err").innerHTML = `<p class="error-text">${esc(e.message)}</p>`; }
        break;
      }
      case "remover-logo": {
        state.vetConfig = await api.del("/api/vet/config/logo");
        await carregarConfigPublico();
        render();
        break;
      }

      /* ---- vet dash ---- */
      case "tab-vet": {
        state.vetTab = el.dataset.tab;
        if (state.vetTab === "solicitacoes") await carregarVetSolicitacoes();
        else if (state.vetTab === "agenda") await carregarVetAgenda();
        else if (state.vetTab === "clientes" || state.vetTab === "carteiras") await carregarVetClientes();
        else if (state.vetTab === "painel") await carregarVetPainel();
        else if (state.vetTab === "config") await carregarVetConfig();
        render();
        break;
      }
      case "vet-confirmar": {
        const { notificacao } = await api.post(`/api/agendamentos/${el.dataset.id}/confirmar`, { opcaoIndex: Number(el.dataset.idx) });
        await Promise.all([carregarVetSolicitacoes(), carregarVetPainel()]);
        render();
        if (notificacao.email?.enviado) showToast("Horário confirmado! E-mail de confirmação enviado ao cliente.");
        else showToast("Horário confirmado! " + (notificacao.whatsappUrl ? "Envie a confirmação pelo WhatsApp abaixo." : "Avise o cliente diretamente."));
        if (notificacao.whatsappUrl) {
          const root = qs("toast-root");
          root.innerHTML += `<a href="${notificacao.whatsappUrl}" target="_blank" rel="noopener" class="btn btn-wa" style="position:fixed;right:1rem;bottom:calc(9.5rem + var(--safe-bottom));z-index:61">📲 Enviar confirmação no WhatsApp</a>`;
          setTimeout(() => { const a = root.querySelector("a"); if (a) a.remove(); }, 12000);
        }
        break;
      }
      case "vet-recusar": {
        await api.post(`/api/agendamentos/${el.dataset.id}/recusar`, {});
        await Promise.all([carregarVetSolicitacoes(), carregarVetPainel()]);
        render();
        break;
      }
      case "vet-concluir": {
        const id = el.dataset.id;
        await api.post(`/api/agendamentos/${id}/concluir`, { observacoes: val(`obs-${id}`) });
        await Promise.all([carregarVetAgenda(), carregarVetPainel()]);
        render();
        break;
      }
      case "vet-cancelar": {
        await api.post(`/api/agendamentos/${el.dataset.id}/cancelar`);
        await Promise.all([carregarVetAgenda(), carregarVetPainel()]);
        render();
        break;
      }
      case "toggle-novo-cliente": state.vetShowNovoCliente = !state.vetShowNovoCliente; render(); break;
      case "vet-criar-cliente": {
        qs("nc-err").innerHTML = "";
        try {
          await api.post("/api/vet/clientes", {
            nome: val("nc-nome"), cpf: val("nc-cpf"), telefone: val("nc-telefone"), email: val("nc-email"), senha: val("nc-senha"),
            pet: { nome: val("nc-pet-nome"), especie: val("nc-pet-especie") },
          });
          state.vetShowNovoCliente = false;
          await carregarVetClientes();
          render();
        } catch (e) { qs("nc-err").innerHTML = `<p class="error-text">${esc(e.message)}</p>`; }
        break;
      }
      case "toggle-cliente": {
        state.vetExpandidoCliente = state.vetExpandidoCliente === el.dataset.cpf ? null : el.dataset.cpf;
        render();
        break;
      }
      case "vet-salvar-cliente": {
        const cpf = el.dataset.cpf;
        await api.patch(`/api/vet/clientes/${cpf}`, { nome: val(`cli-nome-${cpf}`), telefone: val(`cli-telefone-${cpf}`), email: val(`cli-email-${cpf}`) });
        await carregarVetClientes();
        showToast("Dados do cliente atualizados.");
        render();
        break;
      }

      default: break;
    }
  } catch (e) {
    showToast(e.message || "Ocorreu um erro.", true);
  }
}

async function refreshVetOrCliente() {
  if (state.tipo === "vet") await carregarVetClientes();
  else await recarregarCliente();
}

/* ---- uploads (input file change) ---- */
async function handleFileUpload(el) {
  const file = el.files && el.files[0];
  if (!file) return;
  const tipo = el.dataset.upload;
  const id = el.dataset.id;

  if (tipo === "staged-midia") {
    if (file.size > 15 * 1024 * 1024) { showToast("Arquivo muito grande (máx. 15MB).", true); el.value = ""; return; }
    stagedMidiaFile = file;
    const nomeEl = qs("ag-midia-nome");
    if (nomeEl) nomeEl.textContent = "Selecionado: " + file.name;
    return;
  }

  if (tipo === "logo") {
    const fd = new FormData();
    fd.append("logo", file);
    try {
      state.vetConfig = await api.postForm("/api/vet/config/logo", fd);
      await carregarConfigPublico();
      render();
    } catch (e) { showToast(e.message, true); }
    return;
  }

  if (tipo === "anexo-vet") {
    if (file.size > 10 * 1024 * 1024) { showToast("Arquivo muito grande (máx. 10MB).", true); el.value = ""; return; }
    const fd = new FormData();
    fd.append("arquivo", file);
    try {
      await api.postForm(`/api/agendamentos/${id}/anexos`, fd);
      await Promise.all([carregarVetAgenda(), carregarVetPainel()]);
      showToast("Arquivo anexado.");
      render();
    } catch (e) { showToast(e.message, true); }
    return;
  }

  const fd = new FormData();
  fd.append("foto", file);
  try {
    if (tipo === "upload-foto-pet") await api.postForm(`/api/pets/${id}/foto`, fd);
    else if (tipo === "upload-carteira-foto") await api.postForm(`/api/pets/${id}/carteira-foto`, fd);
    await refreshVetOrCliente();
    render();
  } catch (e) { showToast(e.message, true); }
}

/* ---- CEP autocompletar ---- */
async function handleCepLookup(el) {
  const digits = onlyDigits(el.value);
  const msgEl = qs("cep-msg");
  if (digits.length !== 8) return;
  if (msgEl) msgEl.innerHTML = `<p class="tiny muted">Buscando endereço...</p>`;
  const res = await buscarCEP(digits);
  if (res) {
    if (qs("end-rua")) qs("end-rua").value = res.rua;
    if (qs("end-bairro")) qs("end-bairro").value = res.bairro;
    if (qs("end-cidade")) qs("end-cidade").value = res.cidade;
    if (qs("end-uf")) qs("end-uf").value = res.uf;
    if (msgEl) msgEl.innerHTML = "";
  } else if (msgEl) {
    msgEl.innerHTML = `<p class="tiny" style="color:var(--clay-dark)">CEP não encontrado — preencha o endereço manualmente.</p>`;
  }
}

/* ============================= eventos delegados ============================= */
function bindDelegatedEvents() {
  const app = qs("app");

  app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    performAction(el.dataset.action, el);
  });

  app.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.target.tagName !== "INPUT") return;
    const wrap = e.target.closest("[data-enter]");
    if (wrap) { e.preventDefault(); performAction(wrap.dataset.enter, wrap); }
  });

  app.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.mask) {
      const pos = el.selectionStart;
      const before = el.value.length;
      if (el.dataset.mask === "cpf") el.value = formatCPF(el.value);
      else if (el.dataset.mask === "phone") el.value = formatPhone(el.value);
      else if (el.dataset.mask === "cep") el.value = formatCEP(el.value);
      const diff = el.value.length - before;
      try { el.setSelectionRange(pos + diff, pos + diff); } catch {}
    }
    if (el.id === "busca-cliente") { state.vetBusca = el.value; filtrarListaClientesInline(el.value); }
    if (el.id === "ag-pet") {
      const novoWrap = qs("ag-pet-novo-wrap");
      if (novoWrap) novoWrap.style.display = el.value === "novo" ? "" : "none";
    }
  });

  app.addEventListener("focusout", (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.cepLookup === "1") handleCepLookup(el);
  });

  app.addEventListener("change", (e) => {
    const el = e.target;
    if (el.id === "ag-pet") {
      const novoWrap = qs("ag-pet-novo-wrap");
      if (novoWrap) novoWrap.style.display = el.value === "novo" ? "" : "none";
      return;
    }
    if (el.dataset && el.dataset.upload) { handleFileUpload(el); return; }
    if (el.dataset && el.dataset.actionChange === "filtro-agenda") { state.vetAgendaFiltro = el.value; carregarVetAgenda().then(render); return; }
    if (el.dataset && el.dataset.actionChange === "carteira-cliente") { state.vetCarteiraCpf = el.value; state.vetCarteiraPetId = null; render(); return; }
    if (el.dataset && el.dataset.actionChange === "carteira-pet") { state.vetCarteiraPetId = el.value; render(); return; }
  });
}

// filtra a lista de clientes sem re-renderizar tudo (evita perder o foco do campo de busca)
function filtrarListaClientesInline(termoBruto) {
  const termo = termoBruto.toLowerCase();
  const digits = onlyDigits(termoBruto);
  document.querySelectorAll("[data-cliente-cpf]").forEach((card) => {
    const nome = card.dataset.clienteNome || "";
    const cpf = card.dataset.clienteCpf || "";
    const match = nome.includes(termo) || (digits.length > 0 && cpf.includes(digits));
    card.style.display = match ? "" : "none";
  });
}

/* ============================= boot ============================= */
async function init() {
  qs("app").innerHTML = `<div id="view"></div><div id="toast-root"></div><div id="lightbox-root"></div>`;
  bindDelegatedEvents();
  await carregarConfigPublico();

  const token = getToken(), tipo = getTipo();
  if (token && tipo === "cliente") {
    try {
      const me = await api.get("/api/auth/me");
      state.tipo = "cliente"; state.cliente = me.cliente; state.pets = me.pets;
      await carregarMeusAgendamentos();
      state.view = "clienteDash";
    } catch { limparSessao(); state.view = "landing"; }
  } else if (token && tipo === "vet") {
    try {
      await Promise.all([carregarVetPainel(), carregarVetAgenda(), carregarVetClientes()]);
      state.tipo = "vet"; state.view = "vetDash";
    } catch { limparSessao(); state.view = "landing"; }
  }
  render();
}

init();
