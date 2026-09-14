import {
  X
} from "lucide-react";

export const API = (import.meta.env.VITE_API_URL || "") + "/api";

// Токен входа держим в sessionStorage: закрыл вкладку — вход заново.
// На общем компьютере это правильнее, чем вечная сессия.
export let AUTH_TOKEN = (() => {
  try { return sessionStorage.getItem("crm-token") || ""; } catch (e) { return ""; }
})();

export function setToken(t) {
  AUTH_TOKEN = t || "";
  try {
    if (t) sessionStorage.setItem("crm-token", t);
    else sessionStorage.removeItem("crm-token");
  } catch (e) { /* приватный режим — живём в памяти */ }
}

export async function apiFetch(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      // Свой заголовок, а не Authorization: тот занят Basic Auth в Nginx,
      // и второй заголовок с тем же именем выбивал бы вход на сервере.
      ...(AUTH_TOKEN ? { "X-CRM-Token": AUTH_TOKEN } : {}),
      ...(opts.headers || {}),
    },
  });
  if (r.status === 401) {
    setToken("");
    window.dispatchEvent(new Event("crm-logout"));
  }
  if (!r.ok) {
    // сервер отвечает {ok:false,error:"..."} — показываем причину,
    // иначе останется голый код и непонятно, что случилось
    let detail = "";
    try { detail = (await r.json()).error || ""; } catch (_) {}
    throw new Error(detail || "код " + r.status);
  }
  return r.json();
}

export const api = {
  state:          ()      => apiFetch("/state"),
  saveSettings:   (s)     => apiFetch("/settings",       { method: "POST",   body: JSON.stringify(s) }),
  saveService:    (s)     => apiFetch("/services",        { method: "POST",   body: JSON.stringify(s) }),
  deleteService:  (id)    => apiFetch("/services/"+id,    { method: "DELETE" }),
  saveCategory:   (c)     => apiFetch("/categories",      { method: "POST",   body: JSON.stringify(c) }),
  deleteCategory: (id)    => apiFetch("/categories/"+id,  { method: "DELETE" }),
  saveClass:      (c)     => apiFetch("/classes",         { method: "POST",   body: JSON.stringify(c) }),
  deleteClass:    (id)    => apiFetch("/classes/"+id,     { method: "DELETE" }),
  saveStaff:      (s)     => apiFetch("/staff",           { method: "POST",   body: JSON.stringify(s) }),
  deleteStaff:    (id)    => apiFetch("/staff/"+id,       { method: "DELETE" }),
  saveClient:     (c)     => apiFetch("/clients",         { method: "POST",   body: JSON.stringify(c) }),
  deleteClient:   (id, force) => apiFetch("/clients/" + id + (force ? "?force=1" : ""), { method: "DELETE" }),
  saveOrder:      (o)     => apiFetch("/orders",          { method: "POST",   body: JSON.stringify(o) }),
  setOrderStatus: (id, status) => apiFetch(`/orders/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  startOrder:  (id, payload) => apiFetch(`/orders/${id}/start`,  { method: "POST", body: JSON.stringify(payload) }),
  finishOrder: (id, payload) => apiFetch(`/orders/${id}/finish`, { method: "POST", body: JSON.stringify(payload) }),
  issueOrder:  (id)          => apiFetch(`/orders/${id}/issue`,  { method: "POST", body: JSON.stringify({}) }),
  setRequestBox: (id, box) => apiFetch(`/requests/${id}/box`, { method: "POST", body: JSON.stringify({ box }) }),
  rollbackOrder: (id, status, reason) => apiFetch(`/orders/${id}/rollback`, { method: "POST", body: JSON.stringify({ status, reason }) }),
  deleteRequest: (id) => apiFetch(`/requests/${id}`, { method: "DELETE" }),
  deleteOrder:    (id)    => apiFetch("/orders/"+id,      { method: "DELETE" }),
  acceptRequest:  (id, b) => apiFetch("/requests/"+id+"/accept", { method: "POST", body: JSON.stringify(b) }),
  requestStatus:  (id,st) => apiFetch("/requests/"+id+"/status", { method: "POST", body: JSON.stringify({ status: st }) }),
  sendMessage:    (b)     => apiFetch("/messages",       { method: "POST", body: JSON.stringify(b) }),
  messageLog:     ()      => apiFetch("/messages/log"),
  mergeClients:   (b)     => apiFetch("/clients/merge",  { method: "POST", body: JSON.stringify(b) }),
  similarClients: (q)     => apiFetch("/clients/similar" + q),
  login:          (b)     => apiFetch("/auth/login",     { method: "POST", body: JSON.stringify(b) }),
  logout:         ()      => apiFetch("/auth/logout",    { method: "POST" }),
  me:             ()      => apiFetch("/auth/me"),
  changePassword: (b)     => apiFetch("/auth/password",  { method: "POST", body: JSON.stringify(b) }),
  users:          ()      => apiFetch("/users"),
  saveUser:       (u)     => apiFetch("/users",          { method: "POST", body: JSON.stringify(u) }),
  deleteUser:     (id)    => apiFetch("/users/" + id,    { method: "DELETE" }),
  saveRole:       (r)     => apiFetch("/roles",          { method: "POST", body: JSON.stringify(r) }),
  deleteRole:     (id)    => apiFetch("/roles/" + encodeURIComponent(id), { method: "DELETE" }),
  wipe:           (b)     => apiFetch("/danger/wipe",    { method: "POST", body: JSON.stringify(b) }),
  saveBox:        (b)     => apiFetch("/boxes",          { method: "POST", body: JSON.stringify(b) }),
  saveDepartment: (d)     => apiFetch("/departments",    { method: "POST", body: JSON.stringify(d) }),
  deleteDepartment:(id)   => apiFetch("/departments/" + encodeURIComponent(id), { method: "DELETE" }),
  saveStockItem:  (i)     => apiFetch("/stock/items",    { method: "POST", body: JSON.stringify(i) }),
  saveStockCategories: (c) => apiFetch("/stock/categories", { method: "POST", body: JSON.stringify({ categories: c }) }),
  saveSpot:       (s)     => apiFetch("/parking/spots",  { method: "POST", body: JSON.stringify(s) }),
  deleteSpot:     (id)    => apiFetch("/parking/spots/" + encodeURIComponent(id), { method: "DELETE" }),
  saveRental:     (r)     => apiFetch("/parking/rentals", { method: "POST", body: JSON.stringify(r) }),
  closeRental:    (id)    => apiFetch("/parking/rentals/" + id + "/close", { method: "POST" }),
  deleteStockItem:(id)    => apiFetch("/stock/items/" + encodeURIComponent(id), { method: "DELETE" }),
  stockMove:      (m)     => apiFetch("/stock/move",     { method: "POST", body: JSON.stringify(m) }),
  stockMoves:     (q = "")=> apiFetch("/stock/moves" + q),
  stockByBox:     (q = "")=> apiFetch("/stock/boxes" + q),
  saveSupplier:   (s)     => apiFetch("/suppliers",      { method: "POST", body: JSON.stringify(s) }),
  deleteSupplier: (id)    => apiFetch("/suppliers/" + encodeURIComponent(id), { method: "DELETE" }),
  deleteBox:      (id)    => apiFetch("/boxes/" + encodeURIComponent(id), { method: "DELETE" }),
};

export async function loadData() {
  try { return await api.state(); }
  catch (e) { console.warn("loadData failed:", e); return null; }
}

export async function saveData() {}  // не нужна — каждое действие вызывает свой endpoint

/* ------------------------------------------------------------------ */
/*  Стартовые данные                                                   */
/* ------------------------------------------------------------------ */
