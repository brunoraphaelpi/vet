const TOKEN_KEY = "vd_token";
const TIPO_KEY = "vd_tipo";

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function getTipo() { return localStorage.getItem(TIPO_KEY); }
export function setSessao(token, tipo) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(TIPO_KEY, tipo);
}
export function limparSessao() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TIPO_KEY);
}

async function req(method, url, body, isMultipart = false) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !isMultipart) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload });
  let data = null;
  try { data = await res.json(); } catch { /* respostas sem corpo (204) */ }
  if (!res.ok) {
    const erro = new Error((data && data.erro) || `Erro ${res.status}`);
    erro.status = res.status;
    throw erro;
  }
  return data;
}

export const api = {
  get: (url) => req("GET", url),
  post: (url, body) => req("POST", url, body || {}),
  postForm: (url, formData) => req("POST", url, formData, true),
  patch: (url, body) => req("PATCH", url, body || {}),
  del: (url) => req("DELETE", url),
};
