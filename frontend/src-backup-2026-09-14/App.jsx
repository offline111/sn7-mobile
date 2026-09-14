import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutGrid, ClipboardList, Users, Sparkles, BarChart3, Settings as Cog,
  Plus, Search, X, Trash2, Pencil, Car, Phone, Check, Download, Clock, ChevronRight, ChevronLeft, Inbox,
  UserCog, Send, CalendarDays, Package, TrendingDown, TrendingUp, ShoppingCart
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Утилиты                                                            */
/* ------------------------------------------------------------------ */

const uid = (p = "id") => p + "_" + Math.random().toString(36).slice(2, 9);
const pad = (n) => String(n).padStart(2, "0");
const toLocal = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const todayKey = () => toLocal(new Date()).slice(0, 10);
const dayKey = (s) => (s || "").slice(0, 10);
const shiftDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};
const num = (v) => (isNaN(parseFloat(v)) ? 0 : parseFloat(v));
const fmt = (v) => new Intl.NumberFormat("ru-RU").format(Math.round(v || 0));
const humanDate = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};
const humanTime = (s) => (s ? s.slice(11, 16) : "");
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

const STATUSES = [
  // «Записан» — заявка есть, но студия её ещё не подтвердила: так приходят
  // обращения из бота, среди которых попадается и мусор. «Принят» значит,
  // что заявку взяли в работу: договорились, время согласовано.
  { id: "booked", label: "Записан", dot: "bg-slate-400", chip: "bg-slate-100 text-slate-700" },
  { id: "accepted", label: "Принят", dot: "bg-blue-500", chip: "bg-blue-100 text-blue-800" },
  { id: "work", label: "В работе", dot: "bg-amber-500", chip: "bg-amber-100 text-amber-800" },
  { id: "done", label: "Готов", dot: "bg-cyan-500", chip: "bg-cyan-100 text-cyan-800" },
  { id: "issued", label: "Выдан", dot: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-800" },
  { id: "canceled", label: "Отменён", dot: "bg-rose-400", chip: "bg-rose-100 text-rose-700" },
];
const statusOf = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0];
const BOARD = ["booked", "accepted", "work", "done", "issued"];

/* ------------------------------------------------------------------ */
/*  Время: календарное и рабочее                                       */
/*  Студия работает каждый день с 10:00 до 19:00 по Белграду. Ночной   */
/*  простоя — не работа, поэтому длительность считаем двумя способами. */
/* ------------------------------------------------------------------ */

const WORK_DAY = { start: 10, end: 19 };

// Отметки ставит SQLite через datetime('now'), то есть в UTC. Приводим
// к белградскому времени, иначе рабочие часы съедут на час-два.
function belgrade(ts) {
  if (!ts) return null;
  const iso = String(ts).includes("T") ? ts : String(ts).replace(" ", "T");
  const d = new Date(iso.length <= 16 ? iso : iso + (iso.endsWith("Z") ? "" : "Z"));
  if (isNaN(d)) return null;
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(d).reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`);
}

// Календарная разница в минутах — сколько машина физически была у нас.
function spanMinutes(from, to) {
  const a = belgrade(from), b = belgrade(to);
  if (!a || !b || b < a) return null;
  return Math.round((b - a) / 60000);
}

// Рабочие минуты: только внутри смены и только в рабочие дни.
function workMinutes(from, to) {
  const a = belgrade(from), b = belgrade(to);
  if (!a || !b || b < a) return null;

  let total = 0;
  const day = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  while (day <= b) {
    // выходных нет: работаем всегда, когда есть работа
    const open = new Date(day); open.setHours(WORK_DAY.start, 0, 0, 0);
    const close = new Date(day); close.setHours(WORK_DAY.end, 0, 0, 0);
    const from_ = a > open ? a : open;
    const to_ = b < close ? b : close;
    if (to_ > from_) total += (to_ - from_) / 60000;
    day.setDate(day.getDate() + 1);
  }
  return Math.round(total);
}

// «3 ч 40 мин», «2 дн 5 ч» — короткая подпись длительности
function humanMinutes(min) {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)} мин`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h < 24) return m ? `${h} ч ${m} мин` : `${h} ч`;
  const d = Math.floor(h / 24);
  return `${d} дн ${h % 24} ч`;
}

const avgOf = (list) => (list.length
  ? Math.round(list.reduce((s, x) => s + x, 0) / list.length) : null);
// Откат — любой переход к более ранней стадии доски.
const stageIndex = (st) => BOARD.indexOf(st);
const isRollback = (from, to) =>
  stageIndex(to) >= 0 && stageIndex(from) >= 0 && stageIndex(to) < stageIndex(from);

/* ------------------------------------------------------------------ */
/*  API — точечные запросы к единой БД                                */
/* ------------------------------------------------------------------ */

const API = (import.meta.env.VITE_API_URL || "") + "/api";

// Токен входа держим в sessionStorage: закрыл вкладку — вход заново.
// На общем компьютере это правильнее, чем вечная сессия.
let AUTH_TOKEN = (() => {
  try { return sessionStorage.getItem("crm-token") || ""; } catch (e) { return ""; }
})();

function setToken(t) {
  AUTH_TOKEN = t || "";
  try {
    if (t) sessionStorage.setItem("crm-token", t);
    else sessionStorage.removeItem("crm-token");
  } catch (e) { /* приватный режим — живём в памяти */ }
}

async function apiFetch(path, opts = {}) {
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

const api = {
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

async function loadData() {
  try { return await api.state(); }
  catch (e) { console.warn("loadData failed:", e); return null; }
}
async function saveData() {}  // не нужна — каждое действие вызывает свой endpoint

/* ------------------------------------------------------------------ */
/*  Стартовые данные                                                   */
/* ------------------------------------------------------------------ */

function seed() {
  const classes = [
    { id: "cl1", name: "Седан" },
    { id: "cl2", name: "Кроссовер" },
    { id: "cl3", name: "Внедорожник, минивэн" },
  ];
  const categories = [
    { id: "cat1", name: "Мойка" },
    { id: "cat2", name: "Химчистка" },
    { id: "cat3", name: "Детейлинг" },
    { id: "cat4", name: "Допы" },
  ];
  const services = [
    { id: "s1", categoryId: "cat1", name: "Комплекс: кузов + салон", duration: 60, prices: { cl1: 1500, cl2: 1800, cl3: 2200 }, active: true },
    { id: "s2", categoryId: "cat1", name: "Мойка кузова", duration: 30, prices: { cl1: 900, cl2: 1100, cl3: 1300 }, active: true },
    { id: "s3", categoryId: "cat1", name: "Мойка двигателя", duration: 40, prices: { cl1: 1600, cl2: 1800, cl3: 2000 }, active: true },
    { id: "s4", categoryId: "cat2", name: "Химчистка салона полная", duration: 240, prices: { cl1: 9000, cl2: 11000, cl3: 13000 }, active: true },
    { id: "s5", categoryId: "cat2", name: "Химчистка сидений", duration: 120, prices: { cl1: 5000, cl2: 5500, cl3: 6500 }, active: true },
    { id: "s6", categoryId: "cat3", name: "Полировка кузова 2 этапа", duration: 480, prices: { cl1: 22000, cl2: 26000, cl3: 30000 }, active: true },
    { id: "s7", categoryId: "cat3", name: "Керамика 1 слой", duration: 360, prices: { cl1: 28000, cl2: 32000, cl3: 38000 }, active: true },
    { id: "s8", categoryId: "cat4", name: "Озонирование", duration: 45, prices: { cl1: 2500, cl2: 2500, cl3: 3000 }, active: true },
    { id: "s9", categoryId: "cat4", name: "Полировка фар", duration: 60, prices: { cl1: 3000, cl2: 3000, cl3: 3500 }, active: true },
  ];
  const staff = [
    { id: "st1", name: "Марко", active: true },
    { id: "st2", name: "Иван", active: true },
    { id: "st3", name: "Ненад", active: true },
  ];
  const clients = [
    {
      id: "c1", name: "Алексей Дорохов", phone: "+381 61 234 5678", source: "Instagram",
      note: "Просит не мыть колёса кислотой.", createdAt: toLocal(shiftDays(-120)),
      cars: [{ id: "car1", plate: "BG 123 AB", make: "BMW", model: "X5", color: "чёрный", classId: "cl3" }],
    },
    {
      id: "c2", name: "Мария Ковач", phone: "+381 63 111 2233", source: "Рекомендация",
      note: "", createdAt: toLocal(shiftDays(-64)),
      cars: [{ id: "car2", plate: "NS 456 CD", make: "Volkswagen", model: "Golf", color: "белый", classId: "cl1" }],
    },
    {
      id: "c3", name: "Сергей Ильин", phone: "+381 64 987 6543", source: "Проезжал мимо",
      note: "Корпоративный, оплата по счёту.", createdAt: toLocal(shiftDays(-15)),
      cars: [
        { id: "car3", plate: "BG 777 XX", make: "Audi", model: "Q5", color: "серый", classId: "cl2" },
        { id: "car4", plate: "BG 778 XX", make: "Skoda", model: "Octavia", color: "синий", classId: "cl1" },
      ],
    },
  ];
  const t = todayKey();
  const orders = [
    { id: uid("o"), n: 1041, clientId: "c1", carId: "car1", staffId: "st1", date: t + "T09:30", status: "issued",
      items: [{ serviceId: "s1", name: "Комплекс: кузов + салон", price: 2200, qty: 1 }], discount: 0, comment: "", createdAt: t + "T09:00" },
    { id: uid("o"), n: 1042, clientId: "c2", carId: "car2", staffId: "st2", date: t + "T11:00", status: "work",
      items: [{ serviceId: "s5", name: "Химчистка сидений", price: 5000, qty: 1 }, { serviceId: "s2", name: "Мойка кузова", price: 900, qty: 1 }], discount: 500, comment: "Пятно на заднем диване", createdAt: t + "T10:40" },
    { id: uid("o"), n: 1043, clientId: "c3", carId: "car3", staffId: "st3", date: t + "T15:00", status: "booked",
      items: [{ serviceId: "s7", name: "Керамика 1 слой", price: 32000, qty: 1 }], discount: 0, comment: "Оставляет на 2 дня", createdAt: t + "T08:10" },
    { id: uid("o"), n: 1039, clientId: "c1", carId: "car1", staffId: "st2", date: toLocal(shiftDays(-9)).slice(0, 11) + "12:00", status: "issued",
      items: [{ serviceId: "s2", name: "Мойка кузова", price: 1300, qty: 1 }, { serviceId: "s9", name: "Полировка фар", price: 3500, qty: 1 }], discount: 0, comment: "", createdAt: toLocal(shiftDays(-9)) },
    { id: uid("o"), n: 1035, clientId: "c2", carId: "car2", staffId: "st1", date: toLocal(shiftDays(-21)).slice(0, 11) + "16:30", status: "issued",
      items: [{ serviceId: "s1", name: "Комплекс: кузов + салон", price: 1500, qty: 1 }], discount: 0, comment: "", createdAt: toLocal(shiftDays(-21)) },
  ];
  return {
    settings: { company: "Аквалюкс · мойка и детейлинг", currency: "RSD" },
    classes, categories, services, staff, clients, orders,
  };
}

/* ------------------------------------------------------------------ */
/*  Мелкие элементы интерфейса                                         */
/* ------------------------------------------------------------------ */

function Plate({ value, size = "sm" }) {
  const s = size === "lg" ? "text-sm px-2 py-1" : "text-xs px-1.5 py-0.5";
  return (
    <span className={`inline-flex items-stretch overflow-hidden rounded border-2 border-slate-800 bg-white font-mono font-bold tracking-wider text-slate-900 ${s}`}>
      <span className="-my-0.5 -ml-1.5 mr-1.5 w-1.5 bg-blue-800" />
      {value || "без номера"}
    </span>
  );
}

function Btn({ children, onClick, kind = "ghost", className = "", type = "button", title }) {
  const kinds = {
    primary: "bg-blue-800 text-white hover:bg-blue-900",
    ghost: "bg-white text-slate-700 border border-slate-300 hover:border-slate-500",
    quiet: "text-slate-500 hover:text-slate-900 hover:bg-slate-100",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
  };
  return (
    <button type={type} title={title} onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${kinds[kind]} ${className}`}>
      {children}
    </button>
  );
}

function Field({ label, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

// Базовый вид поля БЕЗ ширины. Ширину задаём отдельно: если оставить
// w-full внутри, он побьёт w-16/w-28 в строках услуг — Tailwind описывает
// w-full позже по порядку, и поле названия схлопывается в пару пикселей.
// Цвета боксов. Приглушённая гамма в духе сайта: рядом с синим акцентом
// они не спорят и одинаково читаются на светлой и тёмной теме.
// Цвет — подсказка, а не единственный признак: подпись бокса всегда рядом.
const BOX_COLORS = {
  wash_1:   "#4f7a6a",   // приглушённый изумруд
  wash_2:   "#5b7c99",   // серо-голубой
  semi_dry: "#b08d57",   // тёплая охра
  dry:      "#8c5a4a",   // пыльный терракот
  leather:  "#7a4a52",   // глубокий бордо
};
const BOX_FALLBACK = "#6b7280";

// Палитра для выбора цвета бокса в настройках. Приглушённая, «old money»:
// такие цвета не спорят с синим акцентом и читаются на обеих темах.
const BOX_PALETTE = [
  { id: "emerald",   name: "Изумруд",     hex: "#4f7a6a" },
  { id: "steel",     name: "Серо-голубой", hex: "#5b7c99" },
  { id: "ochre",     name: "Охра",        hex: "#b08d57" },
  { id: "terracotta",name: "Терракот",    hex: "#8c5a4a" },
  { id: "bordeaux",  name: "Бордо",       hex: "#7a4a52" },
  { id: "olive",     name: "Олива",       hex: "#6f7548" },
  { id: "navy",      name: "Индиго",      hex: "#42527a" },
  { id: "plum",      name: "Слива",       hex: "#6b4f6e" },
  { id: "sand",      name: "Песок",       hex: "#a8926b" },
  { id: "teal",      name: "Морская волна", hex: "#3f6f73" },
  { id: "brick",     name: "Кирпич",      hex: "#9c5b48" },
  { id: "graphite",  name: "Графит",      hex: "#5d6068" },
];

// Цвет берём из настроек бокса; если его там нет — из палитры по умолчанию.
const boxColor = (id, data) => {
  const own = (data?.boxes || []).find((b) => b.id === id)?.color;
  return own || BOX_COLORS[id] || BOX_FALLBACK;
};
const boxName = (data, id) => (data.boxes || []).find((b) => b.id === id)?.name || "";

// Бот записывает машину одной строкой в title («VW Golf 2018»), CRM —
// раздельно в make/model. Показываем то, что заполнено.
const carLabel = (car) => {
  if (!car) return "";
  const mm = [car.make, car.model].filter(Boolean).join(" ").trim();
  return mm || car.title || "";
};

/* ------------------------------------------------------------------ */
/*  Темы оформления                                                    */
/*  Палитра взята с сайта студии. Разметка написана классами Tailwind,  */
/*  поэтому вместо правки двухсот мест переопределяем сами классы:      */
/*  так тема покрывает интерфейс целиком, включая то, что добавим позже.*/
/* ------------------------------------------------------------------ */
const THEME_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap');

:root {
  --c-page:      #f2f1ec;
  --c-surface:   #ffffff;
  --c-surface-2: #f7f6f2;
  --c-line:      #e3e0d8;
  --c-line-2:    #d6d2c8;
  --c-text:      #2f2f2f;
  --c-text-2:    #55585e;
  --c-muted:     #86898f;
  --c-accent:    #5468e6;
  --c-accent-dk: #333f9e;
  --c-gold:      #b08d57;
  --c-danger:    #b4453f;
  --c-ok:        #4f7a6a;
  --c-warn:      #a9853f;
  --c-tint:      rgba(84,104,230,0.10);
}

[data-theme="dark"] {
  --c-page:      #2f2f2f;
  --c-surface:   #3d4046;
  --c-surface-2: #484b52;
  --c-line:      #53565e;
  --c-line-2:    #63666e;
  --c-text:      #f1f0ec;
  --c-text-2:    #d6d5d0;
  --c-muted:     #aeb1b8;
  --c-accent:    #5468e6;
  --c-accent-dk: #6d80f0;
  --c-gold:      #d4af6a;
  --c-danger:    #e0736c;
  --c-ok:        #7fb39f;
  --c-warn:      #d4af6a;
  --c-tint:      rgba(84,104,230,0.18);
}

body, .crm-root { font-family: 'Montserrat', system-ui, sans-serif; }
.crm-page { background: var(--c-page); color: var(--c-text); }

/* поверхности */
.crm-root .bg-white      { background-color: var(--c-surface); }
.crm-root .bg-slate-50   { background-color: var(--c-surface-2); }
.crm-root .bg-slate-100  { background-color: var(--c-surface-2); }
.crm-root .hover\:bg-slate-50:hover  { background-color: var(--c-surface-2); }
.crm-root .hover\:bg-slate-100:hover { background-color: var(--c-line); }

/* Подсветка кликабельных строк. Отдельный класс, а не row-hover:
   имя не пересекается с базовыми утилитами, поэтому фон всегда берётся
   из темы и текст остаётся читаемым. Полупрозрачный акцент работает
   и на светлом, и на тёмном фоне. */
.crm-root .row-hover { transition: background-color .15s ease; }
.crm-root .row-hover:hover { background-color: var(--c-tint); }

/* текст */
.crm-root .text-slate-900, .crm-root .text-slate-800 { color: var(--c-text); }
.crm-root .text-slate-700, .crm-root .text-slate-600 { color: var(--c-text-2); }
.crm-root .text-slate-500, .crm-root .text-slate-400 { color: var(--c-muted); }
.crm-root .hover\:text-slate-900:hover { color: var(--c-text); }

/* границы */
.crm-root .border-slate-100 { border-color: var(--c-line); }
.crm-root .border-slate-200 { border-color: var(--c-line); }
.crm-root .border-slate-300 { border-color: var(--c-line-2); }

/* акцент */
.crm-root .bg-blue-800   { background-color: var(--c-accent); }
.crm-root .text-blue-800, .crm-root .text-blue-700,
.crm-root .text-blue-900 { color: var(--c-accent-dk); }
.crm-root .border-blue-700, .crm-root .border-blue-800 { border-color: var(--c-accent); }
.crm-root .hover\:border-blue-700:hover,
.crm-root .hover\:border-blue-800:hover { border-color: var(--c-accent); }
.crm-root .bg-blue-50, .crm-root .bg-blue-100 { background-color: var(--c-tint); }
.crm-root .hover\:bg-blue-50:hover { background-color: var(--c-tint); }
.crm-root .ring-blue-100 { --tw-ring-color: var(--c-tint); }
.crm-root .focus\:border-blue-700:focus { border-color: var(--c-accent); }

/* Кнопки-услуги и подобные «таблетки»: при наведении подсвечиваем фон
   и обязательно задаём цвет текста. Раньше менялся только фон, и в
   тёмной теме надпись сливалась с подсветкой. */
.crm-root .chip-pick {
  border-color: var(--c-line-2);
  color: var(--c-text);
  transition: background-color .15s ease, border-color .15s ease, color .15s ease;
}
.crm-root .chip-pick:hover {
  background-color: var(--c-tint);
  border-color: var(--c-accent);
  color: var(--c-text);
}
.crm-root .chip-pick:active { background-color: var(--c-accent); color: #fff; }

/* Обрезка длинного перечня услуг на карточке доски: без неё колонка
   растягивается и стадии перестают быть одинаковой высоты. */
.crm-root .line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
/* цена внутри таблетки приглушена, но при наведении не должна пропадать */
.crm-root .chip-pick .text-slate-500 { color: var(--c-muted); }
.crm-root .chip-pick:hover .text-slate-500 { color: var(--c-text); opacity: .75; }

/* поля ввода */
.crm-root input, .crm-root select, .crm-root textarea {
  background-color: var(--c-surface);
  color: var(--c-text);
  border-color: var(--c-line-2);
}
.crm-root input::placeholder, .crm-root textarea::placeholder { color: var(--c-muted); }
[data-theme="dark"] .crm-root input[type="date"],
[data-theme="dark"] .crm-root input[type="datetime-local"] { color-scheme: dark; }

/* смысловые цвета: в тёмной теме заливки делаем прозрачными,
   иначе светлые плашки выжигают глаза */
.crm-root .text-rose-500, .crm-root .text-rose-600,
.crm-root .text-rose-700 { color: var(--c-danger); }
.crm-root .text-amber-600, .crm-root .text-amber-800,
.crm-root .text-amber-900 { color: var(--c-warn); }
.crm-root .text-emerald-800 { color: var(--c-ok); }
[data-theme="dark"] .crm-root .bg-rose-50,
[data-theme="dark"] .crm-root .bg-rose-100    { background-color: rgba(224,115,108,0.16); }
[data-theme="dark"] .crm-root .bg-amber-50,
[data-theme="dark"] .crm-root .bg-amber-100   { background-color: rgba(212,175,106,0.16); }
[data-theme="dark"] .crm-root .bg-emerald-100 { background-color: rgba(127,179,159,0.18); }
[data-theme="dark"] .crm-root .bg-cyan-100    { background-color: rgba(91,124,153,0.22); }
[data-theme="dark"] .crm-root .bg-purple-100  { background-color: rgba(154,124,170,0.20); }
[data-theme="dark"] .crm-root .text-cyan-800  { color: #8fb4d0; }
[data-theme="dark"] .crm-root .text-purple-800{ color: #c0a6d4; }
[data-theme="dark"] .crm-root .text-orange-800{ color: #e0a173; }
[data-theme="dark"] .crm-root .hover\:text-rose-600:hover,
[data-theme="dark"] .crm-root .hover\:text-rose-700:hover { color: var(--c-danger); }
[data-theme="dark"] .crm-root .hover\:bg-rose-50:hover { background-color: rgba(224,115,108,0.16); }
/* Прокрутка внутри дашбордов: тонкая полоса в цветах интерфейса.
   Появляется при наведении на блок — системный серый ползунок
   выбивался из оформления. */
.scroll-slim {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  overscroll-behavior: contain;
  transition: scrollbar-color .25s ease;
}
.scroll-slim:hover, .scroll-slim:focus-within {
  scrollbar-color: var(--c-line-2) transparent;
}
.scroll-slim::-webkit-scrollbar { width: 8px; height: 8px; }
.scroll-slim::-webkit-scrollbar-track { background: transparent; }
.scroll-slim::-webkit-scrollbar-thumb {
  background-color: transparent;
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: content-box;
  transition: background-color .25s ease;
}
.scroll-slim:hover::-webkit-scrollbar-thumb,
.scroll-slim:focus-within::-webkit-scrollbar-thumb { background-color: var(--c-line-2); }
.scroll-slim::-webkit-scrollbar-thumb:hover { background-color: var(--c-muted); }

/* Полоса самой страницы — в том же оформлении, но видна всегда:
   на длинных списках заказов ею пользуются постоянно. */
.crm-root, html { scrollbar-width: thin; scrollbar-color: var(--c-line-2) transparent; }
body::-webkit-scrollbar, .crm-root::-webkit-scrollbar { width: 10px; height: 10px; }
body::-webkit-scrollbar-track, .crm-root::-webkit-scrollbar-track { background: transparent; }
body::-webkit-scrollbar-thumb, .crm-root::-webkit-scrollbar-thumb {
  background-color: var(--c-line-2);
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: content-box;
}
body::-webkit-scrollbar-thumb:hover, .crm-root::-webkit-scrollbar-thumb:hover {
  background-color: var(--c-muted);
}

/* Внутри модальных окон полоса не должна упираться в скруглённый угол */
.scroll-slim::-webkit-scrollbar-thumb { min-height: 32px; }

/* Числовые поля: системные стрелки выглядят чужеродно и мелкие для
   касания. Прячем их и подставляем свои кнопки — компонент NumField. */
.crm-root input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
.crm-root input[type="number"]::-webkit-outer-spin-button,
.crm-root input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.num-field { position: relative; display: inline-flex; align-items: center; }
.num-field > input { width: 100%; padding-right: 1.6rem; }
.num-field .num-steps {
  position: absolute;
  right: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  opacity: 0;
  transition: opacity .18s ease;
}
.num-field:hover .num-steps,
.num-field:focus-within .num-steps { opacity: 1; }
.num-field .num-steps button {
  display: flex;
  height: 12px;
  width: 16px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: var(--c-surface-2, rgba(127,127,127,.12));
  color: var(--c-muted);
  font-size: 9px;
  line-height: 1;
}
.num-field .num-steps button:hover { background: var(--c-accent); color: #fff; }

`;

function ThemeStyles({ theme }) {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  return <style>{THEME_CSS}</style>;
}

const inputBase =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100";
const inputCls = `w-full ${inputBase}`;

function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900 bg-opacity-40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className={`max-h-full w-full scroll-slim overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl ${wide ? "sm:max-w-3xl" : "sm:max-w-xl"}`}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// Кого предлагать исполнителем услуги: сперва мастера её отдела,
// а если отдел не задан или в нём никого — всех активных.
function staffForService(data, serviceId) {
  const active = (data.staff || []).filter((s) => s.active);
  const svc = (data.services || []).find((s) => s.id === serviceId);
  if (!svc || !svc.departmentId) return { list: active, exact: false };
  const inDep = active.filter((s) => (s.departmentIds || []).includes(svc.departmentId));
  return inDep.length ? { list: inDep, exact: true } : { list: active, exact: false };
}

// Сколько из цены услуги принадлежит другому отделу. Проценты считаем
// от цены строки, фиксированную сумму берём как есть, но не больше цены.
function splitAmountFor(item, service) {
  if (item.splitAmount != null && item.splitAmount !== "") return num(item.splitAmount);
  const rule = (service?.splits || [])[0];
  if (!rule) return 0;
  const line = num(item.price) * num(item.qty || 1);
  const raw = rule.kind === "percent" ? (line * num(rule.value)) / 100 : num(rule.value) * num(item.qty || 1);
  return Math.min(Math.round(raw), line);
}

const splitStaffIds = (i) => (i?.splitStaffIds || []).filter(Boolean);

// Исполнители одной позиции. Их может быть несколько: вдвоём моют
// большую машину или полируют в четыре руки.
const itemStaffIds = (i) =>
  (i?.staffIds && i.staffIds.length ? i.staffIds : (i?.staffId ? [i.staffId] : []));

// Услуги заказа делятся на группы по отделам: озонирование и химчистка
// уходят детейлерам одной строкой, полировка — полировщикам. Мастера
// назначаются на группу, а не на каждую позицию отдельно.
function groupItemsByDepartment(data, items) {
  const groups = [];
  items.forEach((it, idx) => {
    const svc = (data.services || []).find((s) => s.id === it.serviceId);
    const depId = svc?.departmentId || "";
    let g = groups.find((x) => x.depId === depId);
    if (!g) {
      const dep = (data.departments || []).find((d) => d.id === depId);
      g = { depId, name: dep?.name || "Без отдела", idxs: [] };
      groups.push(g);
    }
    g.idxs.push(idx);
  });
  return groups;
}

function staffForDepartment(data, depId) {
  const active = (data.staff || []).filter((s) => s.active);
  if (!depId) return { list: active, exact: false };
  const inDep = active.filter((s) => (s.departmentIds || []).includes(depId));
  return inDep.length ? { list: inDep, exact: true } : { list: active, exact: false };
}

// Выбор исполнителей группы: отмечаем нужных, чужой отдел — под «···».
function PerformerPicker({ data, depId, chosen = [], onChange }) {
  const { list, exact } = staffForDepartment(data, depId);
  const [all, setAll] = useState(false);
  const shown = all ? (data.staff || []).filter((s) => s.active) : list;
  // выбранного из другого отдела всё равно показываем — иначе не снять
  const extra = (data.staff || []).filter(
    (s) => chosen.includes(s.id) && !shown.some((x) => x.id === s.id));

  const toggle = (id) => onChange(
    chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {chosen.length === 0 && (
        <span className="text-xs text-amber-600">кто делал?</span>
      )}
      {[...shown, ...extra].map((s) => {
        const on = chosen.includes(s.id);
        return (
          <button key={s.id} onClick={() => toggle(s.id)} type="button"
            className={`rounded-full border px-2 py-0.5 text-xs transition ${
              on ? "border-blue-700 bg-blue-50 text-blue-900"
                 : "border-slate-200 text-slate-500 hover:border-slate-400"}`}>
            {on ? "✓ " : ""}{s.name}
          </button>
        );
      })}
      {exact && !all && (
        <button type="button" onClick={() => setAll(true)} title="Показать всех сотрудников"
          className="rounded px-1 text-xs text-slate-400 hover:text-blue-700">···</button>
      )}
      {chosen.length > 1 && (
        <span className="text-xs text-slate-400">делят поровну</span>
      )}
    </div>
  );
}

// Строка назначения под группой услуг: кто делал и сколько часов ушло.
// Часы вводятся на группу и раскладываются по позициям пропорционально
// их стоимости — так отчёты видят время у каждой услуги.
// Часть цены услуги отдаём другому отделу прямо в заказе: полировка
// включает подготовительную мойку, но бывает и разовая помощь, которой
// в прайсе нет. Сумма вычитается из этой услуги, цена клиента не меняется.
// Есть ли в заказе оплаченная услуга этого же отдела. Если клиент взял
// полноценную мойку, подготовка внутри полировки ею и покрыта — начислять
// отделу второй раз нельзя.
function departmentCovered(data, items, depId, selfIdx) {
  if (!depId) return null;
  return items.findIndex((it, i) => {
    if (i === selfIdx) return false;
    const svc = (data.services || []).find((s) => s.id === it.serviceId);
    return svc?.departmentId === depId;
  });
}

function ItemSplit({ data, item, items = [], index, money, onChange }) {
  const line = num(item.price) * num(item.qty || 1);
  const coveredIdx = departmentCovered(data, items, item.splitDep, index);
  const covered = coveredIdx != null && coveredIdx >= 0;

  if (!item.splitDep) {
    return (
      <button type="button"
        onClick={() => onChange({ splitDep: (data.departments || [])[0]?.id || "",
                                  splitAmount: "", splitStaffIds: [] })}
        className="ml-1 text-xs text-slate-400 hover:text-blue-700">
        + работа другого отдела
      </button>
    );
  }

  const amount = Math.min(num(item.splitAmount), line);
  const rest = line - amount;

  return (
    <div className="mt-1 space-y-1 rounded-lg border border-dashed border-slate-300 px-2 py-1.5">
      {covered && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-amber-700">
          <span>
            В заказе уже есть «{items[coveredIdx]?.name}» того же отдела — подготовка
            оплачена ею{amount > 0 ? ", иначе отдел получит дважды" : ""}.
          </span>
          {amount > 0 ? (
            <button type="button" onClick={() => onChange({ splitAmount: 0 })}
              className="rounded-full border border-amber-300 px-2 py-0.5 hover:bg-amber-100">
              убрать долю
            </button>
          ) : (
            <span className="text-slate-400">доля обнулена</span>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select value={item.splitDep} onChange={(e) => onChange({ splitDep: e.target.value })}
          className={`${inputBase} w-40 shrink-0`}>
          {(data.departments || []).map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <NumField value={item.splitAmount ?? ""} onChange={(v) => onChange({ splitAmount: v })}
          step={100} min={0} max={line} placeholder="сумма"
          wrapClass="w-28 shrink-0" className={`${inputBase} w-full text-right font-mono`} />
        {money && (
          <span className="text-xs text-slate-500">
            из {money(line)} · отделу {money(amount)}, исполнителю {money(rest)}
          </span>
        )}
        <button type="button"
          onClick={() => onChange({ splitDep: null, splitAmount: null, splitStaffIds: [] })}
          className="ml-auto rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
          <X size={14} />
        </button>
      </div>

      <PerformerPicker data={data} depId={item.splitDep}
        chosen={splitStaffIds(item)}
        onChange={(ids) => onChange({ splitStaffIds: ids })} />
    </div>
  );
}

function GroupAssign({ data, items, idxs, depId, money, onPatchItems,
                      byItem, onToggleByItem, withHours = true }) {
  // Позиции группы могут быть на разных людях: один мастер работает
  // в двух отделах, и в одном заказе делает мойку, а в другом полировку.
  const mixed = new Set(idxs.map((i) => itemStaffIds(items[i]).slice().sort().join(","))).size > 1;

  const chosen = (() => {
    const first = itemStaffIds(items[idxs[0]]);
    // если у позиций внутри группы разный состав, показываем объединение
    const all = new Set();
    idxs.forEach((i) => itemStaffIds(items[i]).forEach((s) => all.add(s)));
    return all.size ? [...all] : first;
  })();

  const groupHours = idxs.reduce((s, i) => s + num(items[i].hours), 0);
  const groupSum = idxs.reduce(
    (s, i) => s + num(items[i].price) * num(items[i].qty || 1), 0);

  const setStaff = (ids) => onPatchItems(idxs, () => ({ staffIds: ids }));

  const setHours = (value) => {
    const total = value === "" ? null : Math.max(0, Number(value) || 0);
    onPatchItems(idxs, (it) => {
      if (total === null) return { hours: "" };
      const w = groupSum > 0 ? (num(it.price) * num(it.qty || 1)) / groupSum : 1 / idxs.length;
      return { hours: Math.round(total * w * 100) / 100 };
    });
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
      {byItem ? (
        <span className="text-xs text-slate-500">
          Исполнители указаны у каждой услуги отдельно
        </span>
      ) : (
        <PerformerPicker data={data} depId={depId} chosen={chosen} onChange={setStaff} />
      )}

      {idxs.length > 1 && (
        <button type="button" onClick={onToggleByItem}
          title={byItem ? "Вернуться к общему выбору на всю группу"
                        : "Назначить исполнителей отдельно для каждой услуги"}
          className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-500 hover:border-blue-700 hover:text-blue-700">
          {byItem ? "общий выбор" : "по услугам"}
        </button>
      )}
      {mixed && !byItem && (
        <span className="text-xs text-amber-600" title="У позиций разные исполнители">
          состав различается
        </span>
      )}

      {withHours && (
        <div className="ml-auto flex items-center gap-1">
          <NumField value={groupHours || ""} onChange={setHours} step={0.5} min={0}
            placeholder="часы" wrapClass="w-24 shrink-0"
            className={`${inputBase} w-full text-right font-mono`} />
          <span className="text-xs text-slate-400">ч</span>
        </div>
      )}
      {money && <span className="font-mono text-xs text-slate-500">{money(groupSum)}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Деньги заказа по людям                                             */
/*                                                                     */
/*  Наёмный мастер получает свою долю зарплатного фонда. Собственник    */
/*  забирает полную стоимость услуг, которые сделал сам. На прибыль    */
/*  компании его доход не влияет: она считается как выручка минус фонд  */
/*  наёмных мастеров.                                                  */
/* ------------------------------------------------------------------ */

// Сколько работы каждого мастера в заказе (в деньгах, со скидкой,
// до применения ставки фонда) и сколько часов на него пришлось.
function orderWorkShares(o, orderTotal) {
  const gross = o.items.reduce((s, i) => s + num(i.price) * num(i.qty || 1), 0);
  const factor = gross > 0 ? orderTotal(o) / gross : 1;
  const fallback = orderStaffIds(o);

  const itemHours = o.items.reduce((s, i) => s + num(i.hours), 0);
  const rest = Math.max(0, num(o.hoursSpent) - itemHours);
  const restBase = o.items.reduce(
    (s, i) => s + (num(i.hours) ? 0 : num(i.price) * num(i.qty || 1)), 0);

  const value = {}, hours = {}, services = {};
  const add = (id, money_, h, name) => {
    value[id] = (value[id] || 0) + money_;
    hours[id] = (hours[id] || 0) + h;
    if (name) {
      services[id] = services[id] || {};
      services[id][name] = (services[id][name] || 0) + money_;
    }
  };

  let unassigned = 0;
  o.items.forEach((i) => {
    const line = num(i.price) * num(i.qty || 1);
    const splitRaw = i.splitDep ? Math.min(num(i.splitAmount), line) : 0;
    const team = splitStaffIds(i);
    const h = num(i.hours) || (restBase > 0 ? rest * line / restBase : 0);

    if (splitRaw > 0 && team.length) {
      team.forEach((k) => add(k, splitRaw * factor / team.length, 0, `${i.name} · подготовка`));
    }

    const own = itemStaffIds(i);
    const owners = own.length ? own : fallback;
    const money_ = (line - splitRaw) * factor;
    if (!owners.length) { unassigned += money_; return; }
    owners.forEach((k) => add(k, money_ / owners.length, h / owners.length, i.name));
    if (!own.length) unassigned += 0;
  });

  return { value, hours, services, unassigned, total: orderTotal(o) };
}

// Кто сколько заработал: наёмные — долю фонда, собственники — остаток.
function orderEarnings(o, orderTotal, isOwner, rate) {
  const { value, hours, services, total } = orderWorkShares(o, orderTotal);
  const ids = Object.keys(value);

  const hired = ids.filter((id) => !isOwner(id));
  const owners = ids.filter((id) => isOwner(id));

  const fund = hired.reduce((s, id) => s + value[id] * rate, 0);
  // Собственник получает свою работу целиком, а не долю фонда: он не
  // наёмный, а владелец. Чужую работу в его доход не приписываем.
  const ownerPool = owners.reduce((s, id) => s + value[id], 0);

  const earned = {};
  hired.forEach((id) => (earned[id] = value[id] * rate));
  owners.forEach((id) => (earned[id] = value[id]));

  return { earned, value, hours, services, fund, ownerPool, total };
}

// На заказе может быть несколько мастеров. staffIds — новый список,
// staffId — прежнее одиночное поле: оно осталось ради бота и календаря.
const orderStaffIds = (o) =>
  (o?.staffIds && o.staffIds.length ? o.staffIds : (o?.staffId ? [o.staffId] : []));

// Числовое поле со своими стрелками: системные мелкие и не вписываются
// в оформление. Шаг и границы задаются как у обычного input.
function NumField({ value, onChange, step = 1, min, max,
                   className = "", wrapClass = "", ...rest }) {
  const bump = (dir) => {
    const cur = Number(value);
    const base = isNaN(cur) ? 0 : cur;
    let next = Math.round((base + dir * step) * 100) / 100;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    onChange(String(next));
  };

  return (
    // обёртка держит ширину в строке, оформление остаётся на самом поле
    <span className={`num-field ${wrapClass}`}>
      <input type="number" value={value} step={step} min={min} max={max}
        className={className}
        onChange={(e) => onChange(e.target.value)} {...rest} />
      <span className="num-steps">
        <button type="button" tabIndex={-1} onClick={() => bump(1)} aria-label="больше">▲</button>
        <button type="button" tabIndex={-1} onClick={() => bump(-1)} aria-label="меньше">▼</button>
      </span>
    </span>
  );
}

function StatusChip({ id }) {
  const s = statusOf(id);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />{s.label}
    </span>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function Empty({ text, action }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-sm text-slate-500">{text}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Приложение                                                         */
/* ------------------------------------------------------------------ */

export default function App() {
  const VIEWS = ["shift", "inbox", "orders", "clients", "services", "staff", "parking",
                 "stock", "reports", "settings"];
  const hashView = () => {
    const h = (window.location.hash || "").replace("#", "");
    return VIEWS.includes(h) ? h : "shift";
  };

  const [me, setMe] = useState(undefined);   // undefined — ещё проверяем
  const [weakAdmin, setWeakAdmin] = useState(false);
  const [data, setData] = useState(null);
  const [view, setViewRaw] = useState(hashView);
  const setView = (v) => { window.location.hash = v; setViewRaw(v); };
  const [query, setQuery] = useState("");
  const [orderModal, setOrderModal] = useState(null);   // {order} | {} для нового
  const [stageModal, setStageModal] = useState(null);   // {order, stage:"work"|"done"}
  const [staffModal, setStaffModal] = useState(null);   // сотрудник | {} для нового
  const [rollback, setRollback] = useState(null);       // {order, to}
  const theme = data?.settings?.theme === "dark" ? "dark" : "light";
  const setTheme = (v) => {
    patch((d) => ({ ...d, settings: { ...d.settings, theme: v } }));
    api.saveSettings({ theme: v }).catch(console.warn);
  };
  const [clientModal, setClientModal] = useState(null);
  const [clientCard, setClientCard] = useState(null);   // id клиента
  const [serviceModal, setServiceModal] = useState(null);
  const [msgModal, setMsgModal] = useState(null);   // {mode:"all"} | {clientId}
  const [staffCard, setStaffCard] = useState(null); // id сотрудника: история работ
  const [shiftDay, setShiftDay] = useState(null);   // дата, на которую открыть «Смену»

  // из календаря отчётов проваливаемся в смену выбранного дня
  const openShiftOn = (isoDay) => { setShiftDay(isoDay); setView("shift"); };
  const [saving, setSaving] = useState(false);

  // Кто вошёл. Пока не ответил сервер, ничего не рисуем: иначе на секунду
  // мелькают разделы, к которым у человека нет доступа.
  useEffect(() => {
    api.me().then((r) => { setMe(r.user); setWeakAdmin(!!r.weakAdmin); })
      .catch(() => setMe(null));
    const onLogout = () => { setMe(null); setData(null); };
    window.addEventListener("crm-logout", onLogout);
    return () => window.removeEventListener("crm-logout", onLogout);
  }, []);

  useEffect(() => {
    if (!me) return;
    (async () => {
      const saved = await loadData();
      setData(saved || seed());
    })();
    if (!window.location.hash) window.location.hash = "shift";
    const onHash = () => setViewRaw(hashView());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [me]);

  // Автообновление раз в минуту. Пауза, когда открыта любая форма
  // или вкладка браузера неактивна — чтобы не затирать ввод.
  const anyModal = !!(orderModal || stageModal || staffModal || rollback ||
                      clientModal || clientCard || serviceModal || msgModal || staffCard);
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden || anyModal) return;
      api.state().then(setData).catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, [anyModal]);

  const patch = (fn) => setData((d) => fn({ ...d }));

  const cur = data ? data.settings.currency : "";
  const money = (v) => `${fmt(v)} ${cur}`;

  /* производные данные */
  const clientById = useMemo(() => {
    const m = {};
    (data?.clients || []).forEach((c) => (m[c.id] = c));
    return m;
  }, [data]);

  const carById = useMemo(() => {
    const m = {};
    (data?.clients || []).forEach((c) => c.cars.forEach((car) => (m[car.id] = { ...car, clientId: c.id })));
    return m;
  }, [data]);

  const staffById = useMemo(() => {
    const m = {};
    (data?.staff || []).forEach((s) => (m[s.id] = s));
    return m;
  }, [data]);

  // Скидка хранится в процентах: мастеру привычнее «10%», чем «2.500».
  const orderTotal = (o) => {
    const sum = o.items.reduce((s, i) => s + num(i.price) * num(i.qty || 1), 0);
    const pct = Math.min(Math.max(num(o.discount), 0), 100);
    return Math.round(sum * (1 - pct / 100));
  };

  /* операции */
  const reload = () => api.state().then(setData).catch(console.warn);

  const saveOrder = async (o) => {
    await api.saveOrder(o);
    await reload();
    setOrderModal(null);
  };
  const removeOrder = async (id) => {
    try {
      await api.deleteOrder(id);
      patch((d) => ({ ...d, orders: d.orders.filter((x) => x.id !== id) }));
    } catch (e) {
      alert("Не удалось удалить заказ: " + e.message);
      await reload();
    }
  };
  const setStatus = async (id, status) => {
    // «В работе» и «Готов» требуют данных от мастера — открываем форму.
    // Сервер такие переходы через /status отклоняет, и это правильно:
    // без перечня услуг, цен и срока клиенту нечего отправлять.
    const order = data.orders.find((o) => o.id === id);
    // Шаг назад — всегда через окно с причиной: так ложное нажатие
    // не уедет молча, а клиент узнает о задержке только если есть что сказать.
    if (order && isRollback(order.status, status)) return setRollback({ order, to: status });
    if (status === "work") return setStageModal({ order, stage: "work" });
    if (status === "done") return setStageModal({ order, stage: "done" });
    if (status === "issued") {
      if (!confirm(`Заказ №${order?.n}: машину забрали?`)) return;
      try {
        await api.issueOrder(id);
        await reload();
      } catch (e) {
        alert("Не удалось закрыть заказ: " + e.message);
      }
      return;
    }
    patch((d) => ({ ...d, orders: d.orders.map((o) => (o.id === id ? { ...o, status } : o)) }));
    try {
      await api.setOrderStatus(id, status);
    } catch (e) {
      // откат оптимистичного обновления, если сервер отклонил запрос
      await reload();
      alert("Не удалось сменить статус заказа: " + e.message);
    }
  };

  const saveClient = async (c) => {
    const res = await api.saveClient(c);
    await reload();
    setClientModal(null);
    return res;
  };
  const removeClient = async (id) => {
    // Сервер сначала предупреждает, что у клиента есть заказы и заявки,
    // и удаляет их только после явного согласия. Раньше такое удаление
    // просто падало на внешнем ключе с непонятной ошибкой.
    try {
      await api.deleteClient(id);
      patch((d) => ({ ...d, clients: d.clients.filter((c) => c.id !== id) }));
      return;
    } catch (e) {
      const m = String(e.message || "");
      if (!/заказ|заявк/i.test(m)) {
        alert("Не удалось удалить клиента: " + m);
        return;
      }
      if (!window.confirm(m + "\n\nУдалить клиента вместе со всей его историей?")) return;
    }
    try {
      await api.deleteClient(id, true);
      await reload();
    } catch (e) {
      alert("Не удалось удалить клиента: " + e.message);
    }
  };

  const saveService = async (s) => {
    await api.saveService(s);
    await reload();
    setServiceModal(null);
  };

  const acceptRequest = async (rid, opts = {}) => {
    const res = await api.acceptRequest(rid, opts);
    await reload();
    return res;
  };

  if (me === undefined) {
    return (
      <div className="flex h-96 items-center justify-center bg-slate-100 text-sm text-slate-500">
        Проверяю доступ…
      </div>
    );
  }

  if (!me) {
    return <LoginScreen onDone={(user, weak) => { setMe(user); setWeakAdmin(!!weak); }} />;
  }

  if (!data) {
    return (
      <div className="flex h-96 items-center justify-center bg-slate-100 text-sm text-slate-500">Загружаю базу…</div>
    );
  }

  // Мастера делят между собой долю от суммы заказа, остальное — прибыль
  // студии. Процент задаётся в настройках, по умолчанию четверть.
  const payrollRate = Math.min(Math.max(num(data.settings?.payroll_percent ?? 25), 0), 100) / 100;

  // Право текущего пользователя. Суперадмин помечен «*».
  const can = (perm) => !!me && (me.permissions.includes("*") || me.permissions.includes(perm));

  const searchResults = (() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    // Телефона у клиента может не быть: бот получает его только если
    // человек нажал «Поделиться номером». Обращение к методу пустого
    // значения роняло всё приложение — отсюда был белый экран.
    const low = (v) => String(v ?? "").toLowerCase();
    const digits = (v) => low(v).replace(/\s/g, "");
    return data.clients
      .filter((c) =>
        low(c.name).includes(q) ||
        digits(c.phone).includes(q.replace(/\s/g, "")) ||
        low(c.username).includes(q) ||
        (c.cars || []).some((car) => low(carLabel(car) + " " + car.plate).includes(q))
      )
      .slice(0, 6);
  })();

  // сколько всего совпало — иначе непонятно, что показаны только первые
  const searchTotal = (() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return 0;
    const low = (v) => String(v ?? "").toLowerCase();
    const digits = (v) => low(v).replace(/\s/g, "");
    return data.clients.filter((c) =>
      low(c.name).includes(q) ||
      digits(c.phone).includes(q.replace(/\s/g, "")) ||
      low(c.username).includes(q) ||
      (c.cars || []).some((car) => low(carLabel(car) + " " + car.plate).includes(q))
    ).length;
  })();

  const inboxCount = (data?.requests || []).length;
  // сколько позиций просело ниже точки заказа — цифра на кнопке «Склад»
  const lowStock = (data?.stockItems || [])
    .filter((i) => i.active && i.minQty > 0 && i.qty <= i.minQty).length;
  // на кнопке показываем свободные места: это то, что спрашивают чаще всего
  const parkingFree = (data?.parkingSpots || [])
    .filter((s) => s.active && !s.rentalId).length;

  const navAll = [
    { id: "shift", label: "Смена", icon: LayoutGrid },
    { id: "inbox", label: "Входящие", icon: Inbox, badge: inboxCount },
    { id: "orders", label: "Заказы", icon: ClipboardList },
    { id: "clients", label: "Клиенты", icon: Users },
    { id: "services", label: "Услуги", icon: Sparkles },
    { id: "staff", label: "Сотрудники", icon: UserCog },
    { id: "parking", label: "Парковка", icon: Car, badge: parkingFree },
    { id: "stock", label: "Склад", icon: Package, badge: lowStock },
    { id: "reports", label: "Отчёты", icon: BarChart3 },
    { id: "settings", label: "Настройки", icon: Cog },
  ];

  // Показываем только то, что человеку разрешено. Сервер всё равно
  // проверит права сам — это лишь чтобы не мозолить глаза.
  const nav = navAll.filter((x) => can(`${x.id}.view`));

  // Открыли раздел без доступа (например, по старой ссылке) — показываем
  // первый доступный. Считаем на месте: хук здесь нельзя, он оказался бы
  // ниже ранних return и ломал бы порядок хуков в React.
  const activeView = nav.some((x) => x.id === view) ? view : (nav[0]?.id || "shift");

  const ctx = { me, can, weakAdmin, payrollRate,
    data, patch, money, cur, clientById, carById, staffById, orderTotal,
    setOrderModal, setClientModal, setClientCard, setServiceModal, setStatus, setStaffModal,
    removeOrder, removeClient, acceptRequest, api, reload: () => api.state().then(setData),
    setMsgModal, setStaffCard, setView, shiftDay, setShiftDay, openShiftOn,
    theme, setTheme };

  return (
    <div className="crm-root crm-page min-h-screen pb-16 md:pb-0">
      <ThemeStyles theme={theme} />
      <div className="flex">
        {/* боковая панель */}
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
          <div className="border-b border-slate-200 px-5 py-5">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-800 text-white"><Car size={17} /></span>
              <span className="text-sm font-bold leading-tight text-slate-900">{data.settings.company}</span>
            </div>
          </div>
          <nav className="flex-1 space-y-1 p-3">
            {nav.map((n) => (
              <button key={n.id} onClick={() => setView(n.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  activeView === n.id ? "bg-blue-50 text-blue-900" : "text-slate-600 hover:bg-slate-100"}`}>
                <n.icon size={17} />
                <span className="flex-1 text-left">{n.label}</span>
                {n.badge > 0 && (
                  <span className="rounded-full bg-blue-800 px-1.5 py-0.5 font-mono text-xs text-white">{n.badge}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="p-3">
            <Btn kind="primary" className="w-full" onClick={() => setOrderModal({})}><Plus size={16} />Новый заказ</Btn>
          </div>
        </aside>

        {/* контент */}
        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-3">
            <div className="relative mx-auto flex max-w-screen-2xl items-center gap-3">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-3 text-slate-400" />
                <input value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Номер авто, телефон или имя"
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-700 focus:bg-white" />
                {searchResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-11 z-40 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                    {searchResults.map((c) => (
                      <button key={c.id} onClick={() => { setClientCard(c.id); setQuery(""); }}
                        className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-0 row-hover">
                        <span>
                          <span className="block text-sm font-medium">{c.name}</span>
                          <span className="block font-mono text-xs text-slate-500">{c.phone}</span>
                        </span>
                        {c.cars[0] && <Plate value={c.cars[0].plate} />}
                      </button>
                    ))}
                    {searchTotal > searchResults.length && (
                      <button onClick={() => { setView("clients"); setQuery(""); }}
                        className="w-full px-3 py-2 text-left text-xs text-blue-800 row-hover">
                        Ещё {searchTotal - searchResults.length} — открыть раздел «Клиенты»
                      </button>
                    )}
                  </div>
                )}
              </div>
              <Btn kind="primary" onClick={() => setOrderModal({})} className="md:hidden"><Plus size={16} /></Btn>
            </div>
          </header>

          {/* Доске нужен весь экран: пять стадий в ряд не помещались
              в прежнюю колонку. Остальные разделы читаются лучше узкими. */}
          {/* Доске и отчётам нужен весь экран, остальным разделам —
              умеренная колонка, иначе строки становятся слишком длинными. */}
          <div className={`mx-auto p-4 sm:p-5 ${
            ["shift", "reports"].includes(activeView) ? "max-w-screen-2xl" : "max-w-6xl"}`}>
            {activeView === "shift" && <ShiftView {...ctx} />}
            {activeView === "inbox" && <InboxView {...ctx} />}
            {activeView === "orders" && <OrdersView {...ctx} />}
            {activeView === "clients" && <ClientsView {...ctx} />}
            {activeView === "services" && <ServicesView {...ctx} />}
            {activeView === "staff" && <StaffView {...ctx} />}
            {activeView === "parking" && <ParkingView {...ctx} />}
            {activeView === "stock" && <StockView {...ctx} />}
            {activeView === "reports" && <ReportsView {...ctx} />}
            {activeView === "settings" && <SettingsView {...ctx} setData={setData} />}
          </div>
        </main>
      </div>

      {/* нижняя навигация на телефоне */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex border-t border-slate-200 bg-white md:hidden">
        {nav.map((n) => (
          <button key={n.id} onClick={() => setView(n.id)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${activeView === n.id ? "text-blue-800" : "text-slate-500"}`}>
            <n.icon size={18} />{n.label}
          </button>
        ))}
      </nav>

      {orderModal && (
        <OrderModal ctx={ctx} order={orderModal.id ? orderModal : null} presetClientId={orderModal.presetClientId}
          onClose={() => setOrderModal(null)} onSave={saveOrder} onSaveClient={saveClient}
          onDelete={async (id) => { await removeOrder(id); setOrderModal(null); }} />
      )}
      {staffModal && (
        <StaffModal ctx={ctx} member={staffModal.id ? staffModal : null}
          onClose={() => setStaffModal(null)}
          onSaved={async () => { setStaffModal(null); await api.state().then(setData); }} />
      )}
      {rollback && (
        <RollbackModal order={rollback.order} to={rollback.to}
          onClose={() => setRollback(null)}
          onDone={async () => { setRollback(null); await api.state().then(setData); }} />
      )}
      {stageModal && (
        <StageModal ctx={ctx} order={stageModal.order} stage={stageModal.stage}
          onClose={() => setStageModal(null)}
          onDone={async () => { setStageModal(null); await reload(); }} />
      )}
      {clientModal && (
        <ClientModal ctx={ctx} client={clientModal.id ? clientModal : null}
          onClose={() => setClientModal(null)} onSave={saveClient} />
      )}
      {serviceModal && (
        <ServiceModal ctx={ctx} service={serviceModal.id ? serviceModal : null}
          onClose={() => setServiceModal(null)} onSave={saveService} />
      )}
      {clientCard && (
        <ClientCard ctx={ctx} id={clientCard} onClose={() => setClientCard(null)} />
      )}
      {msgModal && (
        <MessageModal ctx={ctx} target={msgModal} onClose={() => setMsgModal(null)} />
      )}
      {staffCard && (
        <StaffCard ctx={ctx} id={staffCard} onClose={() => setStaffCard(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Смена                                                              */
/* ------------------------------------------------------------------ */

function ShiftView(ctx) {
  const { data, money, carById, clientById, staffById, orderTotal, setOrderModal, setStatus,
          shiftDay, setShiftDay } = ctx;

  // Смена не всегда сегодняшняя: мастеру нужно и вчерашние хвосты посмотреть,
  // и завтрашнюю загрузку. Сдвиг в днях от сегодня.
  const [dayShift, setDayShift] = useState(0);

  // пришли из календаря отчётов — открываем сразу нужный день
  useEffect(() => {
    if (!shiftDay) return;
    setDayShift(daysBetween(toLocal(new Date()).slice(0, 10), shiftDay));
    setShiftDay(null);
  }, [shiftDay]);
  const t = toLocal(shiftDays(dayShift)).slice(0, 10);
  const isToday = dayShift === 0;

  // Незакрытая машина переезжает на следующую смену: пока её не выдали,
  // она физически стоит в боксе и должна быть на доске.
  const isOpen = (o) => o.status !== "issued" && o.status !== "canceled" && o.status !== "cancelled";
  const onDay = (o, day) => dayKey(o.date) === day;
  const carried = (o, day) => dayKey(o.date) < day && isOpen(o);

  const today = data.orders.filter((o) => onDay(o, t) || carried(o, t));
  const fromPast = today.filter((o) => carried(o, t));

  const revenue = today.filter((o) => o.status !== "canceled").reduce((s, o) => s + orderTotal(o), 0);
  const paid = today.filter((o) => o.status === "issued").reduce((s, o) => s + orderTotal(o), 0);

  // сколько заказов в соседних днях — чтобы стрелка подсказывала, есть ли там что-то
  const countOn = (shift) => {
    const k = toLocal(shiftDays(shift)).slice(0, 10);
    return data.orders.filter((o) => onDay(o, k) || carried(o, k)).length;
  };
  const prevCount = countOn(dayShift - 1);
  const nextCount = countOn(dayShift + 1);

  const dayTitle = { "-1": "Вчера", "0": "Сегодня", "1": "Завтра" }[String(dayShift)];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button onClick={() => setDayShift(dayShift - 1)}
              title="Предыдущая смена"
              className="relative rounded-lg border border-slate-200 p-1.5 transition hover:border-slate-300">
              <ChevronLeft size={16} />
              {prevCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center
                  rounded-full bg-blue-800 px-1 text-xs font-semibold text-white">{prevCount}</span>
              )}
            </button>

            <h1 className="text-xl font-bold">Смена {humanDate(t)}</h1>

            <button onClick={() => setDayShift(dayShift + 1)}
              title="Следующая смена"
              className="relative rounded-lg border border-slate-200 p-1.5 transition hover:border-slate-300">
              <ChevronRight size={16} />
              {nextCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center
                  rounded-full bg-blue-800 px-1 text-xs font-semibold text-white">{nextCount}</span>
              )}
            </button>

            {!isToday && (
              <button onClick={() => setDayShift(0)}
                className="rounded-lg px-2 py-1 text-xs font-medium text-blue-800 hover:bg-blue-50">
                Сегодня
              </button>
            )}
          </div>
          <p className="text-sm text-slate-500">
            {dayTitle ? `${dayTitle} — машины в работе и очередь` : "Машины в работе и очередь на этот день"}
            {fromPast.length > 0 && (
              <span className="ml-1 text-amber-600">
                · {fromPast.length} с прошлых смен
              </span>
            )}
          </p>
        </div>
        <Btn kind="primary" className="hidden md:inline-flex" onClick={() => setOrderModal({})}><Plus size={16} />Новый заказ</Btn>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Заказов" value={today.length}
          sub={fromPast.length ? `${fromPast.length} переехали с прошлых смен` : null} />
        <Stat label="Ожидается" value={money(revenue)} />
        <Stat label="Закрыто" value={money(paid)} />
        <Stat label="Средний чек" value={today.length ? money(revenue / today.length) : "—"} />
      </div>

      {/* Пять стадий в ряд: на широком экране доска читается слева направо,
          на планшете складывается в три колонки, на телефоне в одну. */}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {BOARD.map((st) => {
          const col = today.filter((o) => o.status === st);
          const s = statusOf(st);
          return (
            <div key={st} className="rounded-xl bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                <span className="text-sm font-semibold">{s.label}</span>
                <span className="ml-auto font-mono text-xs text-slate-400">{col.length}</span>
              </div>
              <div className="space-y-2">
                {col.length === 0 && <p className="py-3 text-center text-xs text-slate-400">пусто</p>}
                {col.map((o) => {
                  const car = carById[o.carId];
                  const cl = clientById[o.clientId];
                  const next = BOARD[BOARD.indexOf(st) + 1];
                  const prev = BOARD[BOARD.indexOf(st) - 1];
                  return (
                    <div key={o.id}
                      className="rounded-lg border-l-4 bg-slate-50 p-2.5"
                      style={{ borderLeftColor: o.box ? boxColor(o.box, data) : "#1e40af" }}>
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => setOrderModal(o)} className="text-left">
                          <div className="font-mono text-xs text-slate-500">
                          {humanTime(o.date)} · №{o.n}
                          {carried(o, t) && (
                            <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-amber-800"
                              title="Машина осталась с прошлой смены">
                              с {humanDate(o.date)}
                            </span>
                          )}
                        </div>
                          <div className="text-sm font-semibold leading-tight">{cl ? cl.name : "Клиент удалён"}</div>
                        </button>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {car && <Plate value={car.plate} />}
                        {carLabel(car) && <span className="text-xs text-slate-600">{carLabel(car)}</span>}
                      </div>
                      {o.box && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: boxColor(o.box, data) }} />
                          <span className="text-xs font-medium" style={{ color: boxColor(o.box, data) }}>
                            {boxName(data, o.box) || o.box}
                          </span>
                        </div>
                      )}
                      <div className="mt-1.5 line-clamp-2 text-xs text-slate-600"
                        title={o.items.map((i) => i.name).join(", ")}>
                        {o.items.map((i) => i.name).join(", ")}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        {orderStaffIds(o).length > 1 ? "Мастера: " : "Мастер: "}
                        {orderStaffIds(o).map((id) => staffById[id]?.name).filter(Boolean).join(", ")
                          || "не назначен"}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <span className="whitespace-nowrap font-mono text-sm font-bold">
                          {money(orderTotal(o))}
                        </span>
                        <div className="flex items-center gap-1">
                          {prev && (
                            <button onClick={() => setStatus(o.id, prev)}
                              title={`Вернуть на «${statusOf(prev).label}»`}
                              className="rounded-md px-1.5 py-1.5 text-slate-400 transition hover:bg-white hover:text-slate-700">
                              <ChevronLeft size={14} />
                            </button>
                          )}
                          {next && (
                            <button onClick={() => setStatus(o.id, next)}
                              title={`Перевести на «${statusOf(next).label}»`}
                              className="inline-flex items-center gap-1 rounded-lg bg-blue-800 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90">
                              Вперёд<ChevronRight size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Заказы                                                             */
/* ------------------------------------------------------------------ */

function OrdersView(ctx) {
  const { data, money, clientById, carById, staffById, orderTotal, setOrderModal, removeOrder } = ctx;
  const [status, setStatusF] = useState("all");
  // По умолчанию окно вокруг сегодняшнего дня: неделя назад и три вперёд.
  // Прошлое нужно, чтобы видеть незакрытые заказы, будущее — записи,
  // которые мастер уже назначил. Точный период выбирается полями выше.
  const [from, setFrom] = useState(toLocal(shiftDays(-7)).slice(0, 10));
  const [to, setTo] = useState(toLocal(shiftDays(21)).slice(0, 10));

  const list = data.orders
    .filter((o) => (status === "all" ? true : o.status === status))
    .filter((o) => dayKey(o.date) >= from && dayKey(o.date) <= to)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  // Итог — только выданные заказы: деньги считаются полученными,
  // когда клиент забрал машину. Всё остальное ещё может измениться.
  const sum = list.filter((o) => o.status === "issued").reduce((s, o) => s + orderTotal(o), 0);
  // Отдельно показываем, сколько ещё в работе — чтобы не выглядело, будто
  // выручка провалилась, когда в списке полно незакрытых заказов.
  const pending = list
    .filter((o) => ["booked", "accepted", "work", "done"].includes(o.status))
    .reduce((s, o) => s + orderTotal(o), 0);

  const exportCsv = () => {
    const rows = [["Номер", "Дата", "Клиент", "Авто", "Услуги", "Мастер", "Статус", "Сумма"]];
    list.forEach((o) => {
      const c = clientById[o.clientId], car = carById[o.carId];
      rows.push([o.n, o.date.replace("T", " "), c ? c.name : "", car ? `${car.plate} ${car.make} ${car.model}` : "",
        o.items.map((i) => i.name).join("; "),
        orderStaffIds(o).map((id) => staffById[id]?.name).filter(Boolean).join(", "),
        statusOf(o.status).label, orderTotal(o)]);
    });
    const csv = "\uFEFF" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `orders_${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-bold">Заказы</h1>
        <div className="flex gap-2">
          <Btn onClick={exportCsv}><Download size={15} />Выгрузить CSV</Btn>
          <Btn kind="primary" onClick={() => setOrderModal({})}><Plus size={16} />Заказ</Btn>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <Field label="С"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></Field>
        <Field label="По"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></Field>
        <Field label="Статус">
          <select value={status} onChange={(e) => setStatusF(e.target.value)} className={inputCls}>
            <option value="all">Все</option>
            {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <div className="ml-auto pb-1 text-right">
          <div className="text-xs uppercase tracking-wide text-slate-500">Получено за период</div>
          <div className="font-mono text-lg font-bold">{money(sum)}</div>
          {pending > 0 && (
            <div className="text-xs text-slate-500">в работе ещё {money(pending)}</div>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <Empty text="За этот период заказов нет. Поменяйте даты или создайте заказ." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {list.map((o) => {
            const c = clientById[o.clientId], car = carById[o.carId];
            return (
              <div key={o.id}
                className="flex items-stretch border-b border-l-4 border-slate-100 last:border-b-0"
                style={{ borderLeftColor: o.box ? boxColor(o.box, data) : "transparent" }}>
                {/* вся строка — одна кнопка: попасть в заказ можно откуда угодно */}
                <button onClick={() => setOrderModal(o)}
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-3 px-4 py-3 text-left row-hover">
                  <div className="w-16 shrink-0 font-mono text-xs text-slate-500">
                    <div className="font-bold text-slate-700">№{o.n}</div>
                    {humanDate(o.date)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip id={o.status} />
                      <span className="text-sm font-semibold">{c ? c.name : "—"}</span>
                      {car && <Plate value={car.plate} />}
                      {carLabel(car) && <span className="text-xs text-slate-600">{carLabel(car)}</span>}
                      {o.box && (
                        <span className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                          style={{ background: boxColor(o.box, data) }}>
                          {boxName(data, o.box) || o.box}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      {o.items.map((i) => i.name).join(", ")}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {orderStaffIds(o).length > 1 ? "Мастера: " : "Мастер: "}
                      {orderStaffIds(o).map((id) => staffById[id]?.name).filter(Boolean).join(", ")
                        || "не назначен"}
                    </div>
                    {o.source === "bot" && (
                      <span className="mt-0.5 inline-block rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                        Telegram-бот
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-sm font-bold">{money(orderTotal(o))}</div>
                </button>
                <button title="Удалить заказ"
                  onClick={() => {
                    if (window.confirm(`Удалить заказ №${o.n}? Отменить это будет нельзя.`)) removeOrder(o.id);
                  }}
                  className="shrink-0 px-3 text-rose-500 transition hover:bg-rose-50 hover:text-rose-700">
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Клиенты                                                            */
/* ------------------------------------------------------------------ */

function ClientsView(ctx) {
  const { data, money, orderTotal, setClientModal, setClientCard, setMsgModal } = ctx;
  const [q, setQ] = useState("");
  const withTg = data.clients.filter((c) => c.tg_id).length;
  const [kind, setKind] = useState("all");   // all | wash | parking | both

  // Один и тот же человек может и мыть машину, и арендовать место.
  // Поэтому тип — не ярлык на карточке, а признаки: заказы и аренды.
  const hasOrders = (id) => (data.orders || []).some((o) => o.clientId === id);
  const kindOf = (c) => {
    const wash = hasOrders(c.id);
    if (wash && c.isParking) return "both";
    if (c.isParking) return "parking";
    return wash ? "wash" : "none";
  };
  const counts = { all: data.clients.length, wash: 0, parking: 0, both: 0 };
  data.clients.forEach((c) => {
    const k = kindOf(c);
    if (k === "both") { counts.both += 1; counts.wash += 1; counts.parking += 1; }
    else if (k === "wash") counts.wash += 1;
    else if (k === "parking") counts.parking += 1;
  });

  const rows = data.clients
    .map((c) => {
      // Считаем закрытые визиты: незакрытый заказ ещё не деньги.
      const done = data.orders.filter((o) => o.clientId === c.id && o.status === "issued");
      const open = data.orders.filter((o) => o.clientId === c.id &&
        o.status !== "issued" && o.status !== "canceled" && o.status !== "cancelled");
      const spent = done.reduce((s, o) => s + orderTotal(o), 0);
      const last = done.map((o) => o.date).sort().slice(-1)[0];
      return { c, visits: done.length, spent, last, open: open.length };
    })
    .filter(({ c }) => {
      if (kind === "wash" && !hasOrders(c.id)) return false;
      if (kind === "parking" && !c.isParking) return false;
      if (kind === "both" && !(c.isParking && hasOrders(c.id))) return false;
      const s = q.trim().toLowerCase();
      if (!s) return true;
      return ((c.name || "") + (c.phone || "") + (c.username || "") +
        c.cars.map((x) => `${x.plate || ""}${x.make || ""}${x.model || ""}`).join(" ")).toLowerCase().includes(s);
    })
    .sort((a, b) => b.spent - a.spent);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Клиенты <span className="font-mono text-base text-slate-400">{data.clients.length}</span></h1>
        <div className="flex gap-2">
          {withTg > 0 && (
            <Btn onClick={() => setMsgModal({ mode: "all" })}>
              <Users size={15} />Написать всем ({withTg})
            </Btn>
          )}
          <Btn kind="primary" onClick={() => setClientModal({})}><Plus size={16} />Клиент</Btn>
        </div>
      </div>

      <DuplicateHint ctx={ctx} />

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по имени, телефону, номеру" className={inputCls} />

      <div className="flex flex-wrap gap-1.5">
        {[["all", "Все"], ["wash", "Мойка"], ["parking", "Парковка"], ["both", "И то и другое"]]
          .map(([id, label]) => (
            <button key={id} onClick={() => setKind(id)}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                kind === id ? "border-blue-700 bg-blue-50 text-blue-900" : "chip-pick"}`}>
              {label} · {counts[id]}
            </button>
          ))}
      </div>

      {rows.length === 0 ? <Empty text="Никого не нашли." /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map(({ c, visits, spent, last }) => (
            <div key={c.id} onClick={() => setClientCard(c.id)} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") setClientCard(c.id); }}
              className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-700">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{c.name || "Без имени"}</span>
                    {c.isParking ? (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800"
                        title="Арендует место на парковке">
                        парковка
                      </span>
                    ) : null}
                    {c.isParking && hasOrders(c.id) ? (
                      <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs text-cyan-900"
                        title="Пользуется и мойкой, и парковкой">
                        + мойка
                      </span>
                    ) : null}
                    {c.tg_id && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setMsgModal({ clientId: c.id }); }}
                        title="Написать в Telegram"
                        className="rounded-md p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-700">
                        <Send size={14} />
                      </button>
                    )}
                  </div>
                  <div className="font-mono text-xs text-slate-500">
                    {c.phone || (c.username ? "@" + c.username : "контакта нет")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-bold">{money(spent)}</div>
                  <div className="text-xs text-slate-500">
                    {visits} визит(ов)
                    {open > 0 && <span className="text-amber-600"> · {open} в работе</span>}
                  </div>
                </div>
              </div>
              <div className="mt-2 space-y-1">
                {c.cars.map((car) => (
                  <div key={car.id} className="flex items-center gap-2">
                    <Plate value={car.plate} />
                    <span className="text-xs text-slate-600">{carLabel(car) || "марка не указана"}</span>
                  </div>
                ))}
              </div>
              {last && (
                <div className="mt-2 text-xs text-slate-500">
                  Последний визит {humanDate(last)}
                  {daysBetween(last, new Date()) > 45 && <span className="ml-1 font-semibold text-amber-700">· давно не был</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ClientCard({ ctx, id, onClose }) {
  const { data, money, orderTotal, carById, setOrderModal, setClientModal, setMsgModal, removeClient } = ctx;
  const [confirmDel, setConfirmDel] = useState(false);
  const c = data.clients.find((x) => x.id === id);
  if (!c) return null;
  const orders = data.orders.filter((o) => o.clientId === id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const spent = orders.filter((o) => o.status === "issued").reduce((s, o) => s + orderTotal(o), 0);

  return (
    <Modal open onClose={onClose} title={c.name || "Клиент без имени"} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          {c.phone ? (
            <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1.5 font-mono text-sm text-blue-800 hover:underline">
              <Phone size={14} />{c.phone}
            </a>
          ) : (
            <span className="text-sm text-slate-400">телефон не указан</span>
          )}
          {c.username && (
            <a href={`https://t.me/${c.username}`} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline">
              <Send size={13} />@{c.username}
            </a>
          )}
          {c.tg_id
            ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">есть Telegram</span>
            : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">без Telegram</span>}
          {(() => {
            const wash = orders.length > 0;
            if (!c.isParking && !wash) return null;
            const label = c.isParking && wash ? "мойка и парковка"
              : c.isParking ? "клиент парковки" : "клиент мойки";
            return (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                {label}
              </span>
            );
          })()}
          {c.source && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Пришёл: {c.source}</span>}
          <span className="text-xs text-slate-500">С нами с {humanDate(c.createdAt)}</span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Оставил" value={money(spent)} />
          <Stat label="Визитов" value={orders.filter((o) => o.status === "issued").length} />
          <Stat label="Средний чек"
            value={(() => {
              const paid = orders.filter((o) => o.status === "issued").length;
              return paid ? money(spent / paid) : "—";
            })()} />
        </div>

        {c.note && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{c.note}</p>}

        {(() => {
          const mine = (data.parkingSpots || []).filter((s) => String(s.clientId) === String(c.id));
          if (!mine.length) return null;
          return (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-blue-900">
                Парковка
              </h4>
              {mine.map((s) => (
                <div key={s.id} className="flex flex-wrap items-baseline gap-2 text-sm text-blue-900">
                  <span className="font-mono font-bold">{s.code}</span>
                  {s.zone && <span className="text-xs">{s.zone}</span>}
                  <span className="text-xs">
                    с {humanDate(s.startedAt)}
                    {s.endsAt ? ` по ${humanDate(s.endsAt)}` : " — без срока"}
                  </span>
                  <span className="ml-auto font-mono">
                    {money(s.price)}{s.period === "day" ? "/сут" : "/мес"}
                  </span>
                </div>
              ))}
            </div>
          );
        })()}

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Автомобили</h4>
          <div className="space-y-2">
            {c.cars.map((car) => (
              <div key={car.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-2.5">
                <Plate value={car.plate} size="lg" />
                <span className="text-sm">{car.make} {car.model}</span>
                <span className="text-xs text-slate-500">{car.color}</span>
                <span className="ml-auto text-xs text-slate-500">
                  {data.classes.find((cl) => cl.id === car.classId)?.name || "класс не указан"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">История</h4>
          {orders.length === 0 ? <Empty text="Заказов пока нет." /> : (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              {orders.map((o) => (
                <button key={o.id} onClick={() => { onClose(); setOrderModal(o); }}
                  className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-0 row-hover">
                  <span className="w-20 shrink-0 font-mono text-xs text-slate-500">{humanDate(o.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{o.items.map((i) => i.name).join(", ")}</span>
                  {carById[o.carId] && <Plate value={carById[o.carId].plate} />}
                  <span className="font-mono text-sm font-semibold">{money(orderTotal(o))}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
          <Btn kind="primary" onClick={() => { onClose(); setOrderModal({ presetClientId: c.id }); }}><Plus size={15} />Записать</Btn>
          <Btn onClick={() => { onClose(); setClientModal(c); }}><Pencil size={15} />Изменить</Btn>
          {c.tg_id && (
            <Btn onClick={() => { onClose(); setMsgModal({ clientId: c.id }); }}>
              <Send size={15} />Написать в Telegram
            </Btn>
          )}
          <Btn kind="danger" className="ml-auto"
            onClick={() => { if (confirmDel) { removeClient(c.id); onClose(); } else setConfirmDel(true); }}>
            <Trash2 size={15} />{confirmDel ? "Удалить вместе с заказами" : "Удалить"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Услуги                                                             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Сотрудники                                                         */
/* ------------------------------------------------------------------ */
function StaffView(ctx) {
  const { data, money, orderTotal, setStaffModal, setStaffCard, api, reload, payrollRate } = ctx;
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");

  // Статистика по каждому: сколько закрыл и на какую сумму.
  // Считаем по закрытым заказам — «в работе» ещё не выработка.
  const stats = {};
  // Заработок: наёмным — доля фонда, собственникам — остаток заказа
  // после расчёта с наёмными. Логика общая с отчётами.
  const isOwner = (sid) => !!(data.staff || []).find((s) => s.id === sid)?.isOwner;

  (data.orders || []).forEach((o) => {
    if (o.status !== "issued") return;
    const r = orderEarnings(o, orderTotal, isOwner, payrollRate);
    Object.keys(r.earned).forEach((sid) => {
      const st = (stats[sid] = stats[sid] || { count: 0, sum: 0, hours: 0, last: null });
      st.sum += r.earned[sid];
      st.hours += r.hours[sid] || 0;
      st.count += 1;
      const d = dayKey(o.date);
      if (!st.last || d > st.last) st.last = d;
    });
  });

  const list = (data.staff || [])
    .filter((m) => !q.trim() || `${m.name} ${m.role || ""} ${m.phone || ""}`
      .toLowerCase().includes(q.trim().toLowerCase()));

  const working = list.filter((m) => m.active);
  const archived = list.filter((m) => !m.active);

  const toggleActive = async (m) => {
    await api.saveStaff({ ...m, active: !m.active });
    await reload();
  };

  const remove = async (m) => {
    if (!window.confirm(`Удалить сотрудника «${m.name}»?`)) return;
    const res = await api.deleteStaff(m.id);
    if (res && res.archived) {
      setNote(`У «${m.name}» есть ${res.orders} заказ(ов), поэтому карточка не удалена, ` +
              `а переведена в архив — иначе история работ потеряла бы автора.`);
    } else {
      setNote("");
    }
    await reload();
  };

  const Card = ({ m }) => {
    const st = stats[m.id] || { count: 0, sum: 0, hours: 0, last: null };
    const initials = (m.name || "?").trim().split(/\s+/).slice(0, 2)
      .map((w) => w[0]).join("").toUpperCase();
    return (
      <div className={`rounded-xl border bg-white p-4 transition hover:border-blue-700
        ${m.active ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full
            bg-blue-800 font-semibold text-white">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">{m.name}</span>
              {m.isOwner && (
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                  title="Собственник: получает полную стоимость своих работ">
                  собственник
                </span>
              )}
              {!m.active && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">архив</span>
              )}
            </div>
            <div className="text-xs text-slate-500">{m.role || "должность не указана"}</div>
          </div>
          <div className="flex gap-1">
            <Btn kind="quiet" onClick={() => setStaffCard(m.id)} title="История работ">
              <ClipboardList size={15} />
            </Btn>
            <Btn kind="quiet" onClick={() => setStaffModal(m)} title="Изменить"><Pencil size={15} /></Btn>
            <Btn kind="quiet" onClick={() => remove(m)} title="Удалить"><Trash2 size={15} /></Btn>
          </div>
        </div>

        <div className="mt-3 space-y-1 text-sm">
          {m.phone && (
            <div className="flex items-center gap-2 text-slate-600">
              <Phone size={13} className="shrink-0 text-slate-400" />
              <a href={`tel:${m.phone}`} className="font-mono hover:text-blue-800">{m.phone}</a>
            </div>
          )}
          {m.telegram && (
            <div className="flex items-center gap-2 text-slate-600">
              <Send size={13} className="shrink-0 text-slate-400" />
              <a href={`https://t.me/${m.telegram}`} target="_blank" rel="noreferrer"
                className="hover:text-blue-800">@{m.telegram}</a>
            </div>
          )}
          {m.hiredAt && (
            <div className="flex items-center gap-2 text-slate-600">
              <CalendarDays size={13} className="shrink-0 text-slate-400" />
              <span className="text-xs">в студии с {humanDate(m.hiredAt)}</span>
            </div>
          )}
        </div>

        {m.note && (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{m.note}</p>
        )}

        <div onClick={() => setStaffCard(m.id)} role="button"
          className="mt-3 grid cursor-pointer grid-cols-3 gap-2 rounded-lg border-t border-slate-100 pt-3 text-center transition row-hover">
          <div>
            <div className="font-mono text-sm font-bold">{st.count}</div>
            <div className="text-xs text-slate-400">заказов</div>
          </div>
          <div>
            <div className="font-mono text-sm font-bold">{money(st.sum)}</div>
            <div className="text-xs text-slate-400">выработка</div>
          </div>
          <div>
            <div className="font-mono text-sm font-bold">{st.hours ? `${st.hours.toFixed(1)} ч` : "—"}</div>
            <div className="text-xs text-slate-400">часов</div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {st.last ? `последний заказ ${humanDate(st.last)}` : "заказов пока нет"}
          </span>
          <button onClick={() => toggleActive(m)}
            className={`rounded-md px-2 py-1 text-xs font-medium ${m.active
              ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
            {m.active ? "работает" : "не работает"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">
            Сотрудники <span className="font-mono text-base text-slate-400">{working.length}</span>
          </h1>
          <p className="text-sm text-slate-500">Кто работает в студии и что успел сделать</p>
        </div>
        <Btn kind="primary" onClick={() => setStaffModal({})}><Plus size={16} />Сотрудник</Btn>
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск по имени, должности, телефону" className={inputCls} />

      {note && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{note}</p>
      )}

      {working.length === 0 && archived.length === 0 ? (
        <Empty text="Сотрудников пока нет. Добавьте первого — и его можно будет назначать на заказы." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {working.map((m) => <Card key={m.id} m={m} />)}
        </div>
      )}

      {archived.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Архив</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {archived.map((m) => <Card key={m.id} m={m} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function StaffModal({ ctx, member, onClose, onSaved }) {
  // отделы задаются галочками: человек может и мыть, и полировать
  const { api, data } = ctx;
  const [f, setF] = useState(member
    ? { ...member, departmentIds: member.departmentIds || [] }
    : {
        id: uid("st"), name: "", role: "", phone: "", telegram: "",
        hiredAt: toLocal(new Date()).slice(0, 10), note: "", active: true,
        departmentIds: [], isOwner: false,
      });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    setErr("");
    if (!f.name.trim()) return setErr("Впишите имя — без него сотрудника не отличить в заказах.");
    setBusy(true);
    try {
      await api.saveStaff({ ...f, name: f.name.trim() });
      await onSaved();
    } catch (e) {
      setErr("Не удалось сохранить: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={member ? "Карточка сотрудника" : "Новый сотрудник"}>
      <div className="space-y-4">
        <Field label="Имя">
          <input value={f.name} onChange={(e) => set("name", e.target.value)}
            className={inputCls} placeholder="Например: Марко" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Должность">
            <input value={f.role || ""} onChange={(e) => set("role", e.target.value)}
              className={inputCls} placeholder="Мастер-детейлер" />
          </Field>
          <Field label="В студии с">
            <input type="date" value={(f.hiredAt || "").slice(0, 10)}
              onChange={(e) => set("hiredAt", e.target.value)} className={inputCls} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Телефон">
            <input value={f.phone || ""} onChange={(e) => set("phone", e.target.value)}
              className={`${inputCls} font-mono`} placeholder="+381 62 000 0000" />
          </Field>
          <Field label="Telegram">
            <input value={f.telegram || ""} onChange={(e) => set("telegram", e.target.value)}
              className={inputCls} placeholder="username без @" />
          </Field>
        </div>

        <Field label="Отделы">
          <div className="max-h-28 scroll-slim overflow-y-auto rounded-lg border border-slate-300 p-1.5">
            {(data.departments || []).length === 0 && (
              <span className="px-1 text-xs text-slate-400">
                Отделов пока нет — создайте их в настройках.
              </span>
            )}
            {(data.departments || []).map((d) => {
              const on = (f.departmentIds || []).includes(d.id);
              return (
                <label key={d.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm row-hover">
                  <input type="checkbox" checked={on}
                    onChange={() => set("departmentIds", on
                      ? (f.departmentIds || []).filter((x) => x !== d.id)
                      : [...(f.departmentIds || []), d.id])}
                    className="h-4 w-4 rounded border-slate-300 accent-blue-800" />
                  <span className="truncate">{d.name}</span>
                </label>
              );
            })}
          </div>
          <span className="mt-1 block text-xs text-slate-500">
            Мастер может быть сразу в нескольких — например, мыть и полировать.
          </span>
        </Field>

        <Field label="Заметка">
          <textarea value={f.note || ""} onChange={(e) => set("note", e.target.value)} rows={2}
            className={inputCls} placeholder="На чём специализируется, график, что учитывать при назначении…" />
        </Field>

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" checked={!!f.isOwner}
            onChange={(e) => set("isOwner", e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-blue-800" />
          <span>
            Собственник студии
            <span className="block text-xs text-slate-500">
              Зарплату не получает: забирает полную стоимость услуг, которые сделал сам.
              На прибыль компании это не влияет.
            </span>
          </span>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!f.active} onChange={(e) => set("active", e.target.checked)}
            className="h-4 w-4 rounded border-slate-300" />
          Работает сейчас — можно назначать на заказы
        </label>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" onClick={submit} className={busy ? "opacity-60 pointer-events-none" : ""}>
            {busy ? "Сохраняю…" : "Сохранить"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function ServicesView(ctx) {
  const { data, patch, cur, setServiceModal } = ctx;
  const [newCat, setNewCat] = useState("");
  const [note, setNote] = useState("");

  const addCategory = () => {
    if (!newCat.trim()) return;
    const c = { id: uid("cat"), name: newCat.trim() };
    api.saveCategory(c).then(() => patch((d) => ({ ...d, categories: [...d.categories, c] }))).catch(console.warn);
    setNewCat("");
  };
  const removeCategory = (id) => {
    if (data.services.some((s) => s.categoryId === id)) {
      setNote("Сначала уберите услуги из этого направления — тогда его можно удалить.");
      return;
    }
    setNote("");
    api.deleteCategory(id).then(() => patch((d) => ({ ...d, categories: d.categories.filter((c) => c.id !== id) }))).catch(console.warn);
  };
  const toggle = (id) => {
    const svc = data.services.find((s) => s.id === id);
    if (!svc) return;
    const updated = { ...svc, active: !svc.active };
    api.saveService(updated).catch(console.warn);
    patch((d) => ({ ...d, services: d.services.map((s) => (s.id === id ? updated : s)) }));
  };
  const removeService = (id) => {
    api.deleteService(id).catch(console.warn);
    patch((d) => ({ ...d, services: d.services.filter((s) => s.id !== id) }));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Прайс</h1>
          <p className="text-sm text-slate-500">Цены задаются отдельно для каждого класса авто</p>
        </div>
        <Btn kind="primary" onClick={() => setServiceModal({})}><Plus size={16} />Услуга</Btn>
      </div>

      {data.categories.map((cat) => {
        const items = data.services.filter((s) => s.categoryId === cat.id);
        return (
          <div key={cat.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">{cat.name}</h2>
              <button onClick={() => removeCategory(cat.id)} className="ml-auto text-slate-400 hover:text-rose-600"><X size={15} /></button>
            </div>
            <div className="scroll-slim overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 font-semibold">Услуга</th>
                    {data.classes.map((c) => <th key={c.id} className="px-3 py-2 text-right font-semibold">{c.name}</th>)}
                    <th className="px-3 py-2 text-right font-semibold">Время</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr><td colSpan={data.classes.length + 3} className="px-4 py-3 text-xs text-slate-400">Здесь пока пусто</td></tr>
                  )}
                  {items.map((s) => (
                    <tr key={s.id} className={`border-t border-slate-100 ${s.active ? "" : "opacity-40"}`}>
                      <td className="px-4 py-2 font-medium">
                        {s.name}
                        {(s.splits || []).length > 0 && (
                          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                            title="Часть цены уходит другому отделу">
                            + {(data.departments || []).find(
                                 (d) => d.id === s.splits[0].depId)?.name || "отдел"}
                          </span>
                        )}
                      </td>
                      {data.classes.map((c) => (
                        <td key={c.id} className="px-3 py-2 text-right font-mono">
                          {s.priceKind === "on_request"
                            ? <span className="text-xs text-slate-400">после осмотра</span>
                            : s.prices[c.id]
                              ? `${s.priceKind === "from" ? "от " : ""}${fmt(s.prices[c.id])}`
                              : "—"}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-mono text-xs text-slate-500">{s.duration} мин</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <button onClick={() => toggle(s.id)} title={s.active ? "Скрыть из заказа" : "Вернуть в прайс"}
                          className="mr-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><Check size={15} /></button>
                        <button onClick={() => setServiceModal(s)} className="mr-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><Pencil size={15} /></button>
                        <button onClick={() => removeService(s.id)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div className="flex gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-3">
        <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Новое направление: тонировка, шиномонтаж…" className={inputCls} />
        <Btn onClick={addCategory}><Plus size={15} />Добавить</Btn>
      </div>
      {note && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}
      <p className="text-xs text-slate-500">Валюта прайса: {cur}. Изменить можно в настройках.</p>
    </div>
  );
}

function ServiceModal({ ctx, service, onClose, onSave }) {
  const { data } = ctx;
  const [f, setF] = useState(
    service || { id: uid("s"), categoryId: data.categories[0]?.id || "", name: "",
                 duration: 60, prices: {}, active: true, priceKind: "fixed" }
  );
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setPrice = (clId, v) => setF((s) => ({ ...s, prices: { ...s.prices, [clId]: num(v) } }));
  const setSplit = (i, patch) => setF((s) => {
    const splits = [...(s.splits || [])];
    splits[i] = { ...splits[i], ...patch };
    return { ...s, splits };
  });

  return (
    <Modal open onClose={onClose} title={service ? "Услуга" : "Новая услуга"}>
      <div className="space-y-4">
        <Field label="Название">
          <input value={f.name} onChange={(e) => set("name", e.target.value)} className={inputCls} placeholder="Например: керамика 2 слоя" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Отдел">
            <select value={f.departmentId || ""} onChange={(e) => set("departmentId", e.target.value)}
              className={inputCls}>
              <option value="">не задан</option>
              {(data.departments || []).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              По нему подставляются исполнители при закрытии заказа.
            </span>
          </Field>
          <Field label="Направление">
            <select value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)} className={inputCls}>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Время, мин">
            <input type="number" value={f.duration} onChange={(e) => set("duration", num(e.target.value))} className={inputCls} />
          </Field>
        </div>
        <Field label="Как показывать цену клиенту">
          <select value={f.priceKind || "fixed"} onChange={(e) => set("priceKind", e.target.value)} className={inputCls}>
            <option value="fixed">Точная цена — «4.400 RSD»</option>
            <option value="from">Ориентир — «от 20.000 RSD»</option>
            <option value="on_request">Только после осмотра</option>
          </select>
        </Field>

        {(f.priceKind || "fixed") !== "on_request" && (
          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Цена по классам
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.classes.map((c) => (
                <label key={c.id} className="block">
                  <span className="mb-1 block text-xs text-slate-500">{c.name}</span>
                  <input type="number" value={f.prices[c.id] ?? ""} onChange={(e) => setPrice(c.id, e.target.value)} className={inputCls} placeholder="0" />
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Эти цены видит клиент в Telegram — бот перечитывает прайс раз в минуту.
            </p>
          </div>
        )}

        {/* Часть цены может принадлежать другому отделу: полировка включает
            подготовительную мойку, её делают мойщики. */}
        <div>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Входит работа другого отдела
          </span>
          {(f.splits || []).map((sp, i) => (
            <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
              <select value={sp.depId || ""} onChange={(e) => setSplit(i, { depId: e.target.value })}
                className={`${inputBase} min-w-0 flex-1`}>
                <option value="">выберите отдел</option>
                {(data.departments || []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <select value={sp.kind || "fixed"} onChange={(e) => setSplit(i, { kind: e.target.value })}
                className={`${inputBase} w-28 shrink-0`}>
                <option value="fixed">сумма</option>
                <option value="percent">процент</option>
              </select>
              <input type="number" value={sp.value ?? ""}
                onChange={(e) => setSplit(i, { value: e.target.value })}
                className={`${inputBase} w-24 shrink-0 text-right font-mono`} />
              <button onClick={() => set("splits", (f.splits || []).filter((_, x) => x !== i))}
                className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                <X size={16} />
              </button>
            </div>
          ))}
          <Btn kind="quiet"
            onClick={() => set("splits", [...(f.splits || []), { kind: "fixed", value: "" }])}>
            <Plus size={14} />Добавить долю отдела
          </Btn>
          <span className="mt-1 block text-xs text-slate-500">
            Эта часть цены уйдёт в выработку выбранного отдела, а не тому, кто делал саму
            услугу. Для клиента цена не меняется.
          </span>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" onClick={() => (f.name || "").trim() && onSave(f)}>Сохранить</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Клиент — форма                                                     */
/* ------------------------------------------------------------------ */

function ClientModal({ ctx, client, onClose, onSave }) {
  const { data } = ctx;
  const [f, setF] = useState(
    client || { id: uid("c"), name: "", phone: "", username: "", source: "", note: "", createdAt: toLocal(new Date()), cars: [] }
  );
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setCar = (i, k, v) => setF((s) => {
    const cars = [...s.cars]; cars[i] = { ...cars[i], [k]: v }; return { ...s, cars };
  });
  const addCar = () => setF((s) => ({
    ...s, cars: [...s.cars, { id: uid("car"), plate: "", make: "", model: "", color: "", classId: data.classes[0]?.id }],
  }));

  return (
    <Modal open onClose={onClose} title={client ? "Клиент" : "Новый клиент"} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Как обращаться"><input value={f.name || ""} onChange={(e) => set("name", e.target.value)} className={inputCls} placeholder="Как зовут клиента" /></Field>
          <Field label="Телефон"><input value={f.phone || ""} onChange={(e) => set("phone", e.target.value)} className={inputCls} placeholder="+381…" /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Telegram">
            <input value={f.username || ""} disabled={!!f.tg_id}
              onChange={(e) => set("username", e.target.value.trim().replace(/^@/, ""))}
              className={`${inputCls} ${f.tg_id ? "opacity-60" : ""}`}
              placeholder="username без @" />
            <span className="mt-1 block text-xs text-slate-500">
              {f.tg_id
                ? "Клиент пришёл через бот — имя пользователя берётся из Telegram."
                : "Заполняется вручную. Бот может писать только тем, кто сам начал с ним диалог."}
            </span>
          </Field>
          <div />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Откуда пришёл"><input value={f.source} onChange={(e) => set("source", e.target.value)} className={inputCls} placeholder="Instagram, рекомендация…" /></Field>
          <Field label="Заметка для мастеров"><input value={f.note} onChange={(e) => set("note", e.target.value)} className={inputCls} /></Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Автомобили</span>
            <Btn kind="quiet" onClick={addCar}><Plus size={14} />Добавить авто</Btn>
          </div>
          {f.cars.length === 0 && <p className="text-sm text-slate-400">Пока ни одной машины.</p>}
          <div className="space-y-2">
            {f.cars.map((car, i) => (
              <div key={car.id} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-5">
                <input value={car.plate} onChange={(e) => setCar(i, "plate", e.target.value.toUpperCase())} placeholder="Госномер" className={`${inputCls} font-mono`} />
                <input value={car.make} onChange={(e) => setCar(i, "make", e.target.value)} placeholder="Марка" className={inputCls} />
                <input value={car.model} onChange={(e) => setCar(i, "model", e.target.value)} placeholder="Модель" className={inputCls} />
                <input value={car.color} onChange={(e) => setCar(i, "color", e.target.value)} placeholder="Цвет" className={inputCls} />
                <select value={car.classId} onChange={(e) => setCar(i, "classId", e.target.value)} className={inputCls}>
                  {data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" onClick={() => (f.name || "").trim() && onSave(f)}>Сохранить</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Заказ — форма                                                      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Откат стадии назад                                                  */
/* ------------------------------------------------------------------ */
function RollbackModal({ order, to, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const label = { booked: "Записан", work: "В работе", done: "Готов", issued: "Выдан" };

  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      await api.rollbackOrder(order.id, to, reason.trim());
      await onDone();
    } catch (e) {
      setErr("Не удалось: " + e.message);
      setBusy(false);
    }
  };

  const willNotify = reason.trim().length > 0;

  return (
    <Modal open onClose={onClose} title={`Вернуть заказ №${order.n} на «${label[to] || to}»`}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Заказ уходит со стадии «{label[order.status] || order.status}» назад
          на «{label[to] || to}». Опишите причину, если о ней стоит знать клиенту.
        </p>

        <Field label="Причина отката">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            className={inputCls} autoFocus
            placeholder="Например: обнаружены сколы под плёнкой, работы продлятся ещё день" />
        </Field>

        <p className={`text-sm ${willNotify ? "text-amber-600" : "text-slate-500"}`}>
          {willNotify
            ? "Клиент получит это сообщение в Telegram."
            : "Поле пустое — клиенту ничего не отправим, стадия просто вернётся назад. "
              + "Так задумано: случайное нажатие не должно тревожить владельца машины."}
        </p>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind={willNotify ? "primary" : "ghost"} onClick={go}
            className={busy ? "opacity-60 pointer-events-none" : ""}>
            {busy ? "Возвращаю…" : willNotify ? "Вернуть и сообщить клиенту" : "Вернуть молча"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Этапы работы: «В работе» и «Готов»                                  */
/*  Оба перехода требуют данных от мастера, поэтому идут через форму,   */
/*  а не простым нажатием на доске.                                     */
/* ------------------------------------------------------------------ */
function StageModal({ ctx, order, stage, onClose, onDone }) {
  const { data, money, carById, clientById } = ctx;
  const isStart = stage === "work";

  const [items, setItems] = useState(
    (order.items || []).map((i) => ({ ...i, qty: i.qty || 1 })));
  const [box, setBox] = useState(order.box || data.boxes?.[0]?.id || "");
  const [readyAt, setReadyAt] = useState(order.readyAt || plusHours(4));
  const [plate, setPlate] = useState(carById[order.carId]?.plate || "");
  const [hours, setHours] = useState(suggestHours());
  const [byItemDeps, setByItemDeps] = useState({});
  const toggleByItem = (key) => setByItemDeps((s) => ({ ...s, [key]: !s[key] }));
  const [dups, setDups] = useState(null);       // найденные похожие карточки
  const [dupChecked, setDupChecked] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const car = carById[order.carId];
  const client = clientById[order.clientId];
  const catalog = (data.services || []).filter((s) => s.active);
  const total = items.reduce((a, i) => a + (Number(i.price) || 0) * (i.qty || 1), 0)
    - (order.discount || 0);

  function plusHours(h) {
    const d = new Date();
    d.setHours(d.getHours() + h);
    return toLocal(d);
  }

  // Только «Комплекс (3 фазы)» и ничего больше. От этого зависят две вещи:
  // автоматический подсчёт часов и то, требовать ли госномер.
  // Объявлено функцией, а не стрелкой: suggestHours() зовёт её ещё при
  // создании состояния, до этой строки. С const это давало ошибку
  // и белый экран при переводе заказа в «Готов».
  function isWashOnly(list) {
    return list.length > 0 && list.every((i) => {
      const svc = (data.services || []).find((x) => x.id === i.serviceId);
      return svc && svc.service_key === "ext1";
    });
  }

  // Точное время считаем только для мойки: там работа идёт подряд
  // и укладывается в один день. Во всех остальных случаях цифру
  // ставит мастер — календарное время ничего не сказало бы о труде.
  function suggestHours() {
    if (!order.workStartedAt) return "";
    if (!isWashOnly(order.items || [])) return "";
    const start = new Date(order.workStartedAt.replace(" ", "T"));
    const diff = (Date.now() - start.getTime()) / 3600000;
    return diff > 0 && diff < 24 ? diff.toFixed(1) : "";
  }

  const setItem = (idx, patchObj) =>
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patchObj } : it)));
  const dropItem = (idx) => setItems(items.filter((_, i) => i !== idx));
  // назначение мастеров и часов сразу на всю группу услуг
  const patchItems = (idxs, make) =>
    setItems(items.map((it, i) => (idxs.includes(i) ? { ...it, ...make(it) } : it)));
  const addFromCatalog = (svc) => {
    const size = car?.classId || car?.size || "";
    const prices = svc.prices || {};
    setItems([...items, {
      serviceId: svc.id, name: svc.name,
      price: prices[size] ?? 0, qty: 1,
    }]);
  };
  const addCustom = () => setItems([...items, { serviceId: null, name: "", price: 0, qty: 1 }]);

  const submit = async () => {
    setErr("");
    if (isStart) {
      if (items.length === 0) return setErr("Добавьте хотя бы одну услугу.");
      if (items.some((i) => !String(i.name || "").trim()))
        return setErr("У каждой позиции должно быть название.");
      if (!readyAt) return setErr("Укажите срок готовности.");
      if (new Date(readyAt.replace(" ", "T")) <= new Date())
        return setErr("Срок готовности должен быть позже текущего времени.");
      if (!box) return setErr("Выберите бокс.");
      // Госномер обязателен: по нему машина ищется в базе и по нему же
      // проверяется, не заводим ли мы того же клиента второй раз.
      if (!plate.trim()) return setErr("Укажите госномер — без него нельзя начать работу.");

      // Похожие карточки показываем один раз: мастер либо объединяет,
      // либо подтверждает, что это разные люди.
      if (!dupChecked) {
        try {
          const q = `?plate=${encodeURIComponent(plate.trim())}` +
            `&phone=${encodeURIComponent(client?.phone || "")}` +
            `&name=${encodeURIComponent(client?.name || "")}` +
            `&exclude=${order.clientId || 0}`;
          const found = await ctx.api.similarClients(q);
          setDupChecked(true);
          if (found.length) { setDups(found); return; }
        } catch (e) {
          setDupChecked(true);   // проверка не удалась — не держим мастера
        }
      }
    } else {
      // Без исполнителя заказ закрывать нельзя: иначе выработку опять
      // придётся делить поровну и правда о том, кто что делал, теряется.
      const empty = groupItemsByDepartment(data, items)
        .filter((g) => g.idxs.every((i) => itemStaffIds(items[i]).length === 0));
      if (empty.length) {
        return setErr("Укажите исполнителей: " + empty.map((g) => g.name).join(", ") + ".");
      }
      if (hours !== "" && !(Number(hours) >= 0)) {
        return setErr("Часы указаны неверно.");
      }
    }
    setBusy(true);
    try {
      if (isStart) {
        await api.startOrder(order.id, { items, box, readyAt, plate: plate.trim() });
      } else {
        await api.finishOrder(order.id, { items, hoursSpent: hours === "" ? null : Number(hours) });
      }
      await onDone();
    } catch (e) {
      setErr("Не удалось сохранить: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose}
      title={isStart ? `Начало работ — заказ №${order.n}` : `Работа завершена — заказ №${order.n}`}>
      {dups && (
        <div className="mb-4 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="text-sm text-amber-900">
            Похоже, этот клиент уже есть в базе. Совпадение по номеру, телефону или имени —
            проверьте, прежде чем заводить второго.
          </div>

          <div className="space-y-2">
            {dups.map((c) => (
              <div key={c.id} className="rounded-lg border border-amber-200 bg-white p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name || "без имени"}</span>
                  {c.phone && <span className="font-mono text-xs text-slate-500">{c.phone}</span>}
                  {c.tgId ? (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                      Telegram
                    </span>
                  ) : null}
                  <span className="ml-auto text-xs text-slate-500">{c.orders} заказ(ов)</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {c.cars.map((car, x) => (
                    <span key={x} className="text-xs text-slate-600">
                      {car.plate ? <Plate value={car.plate} /> : null} {car.title}
                    </span>
                  ))}
                </div>
                <div className="mt-1 text-xs text-amber-800">{c.reasons.join(", ")}</div>
                <div className="mt-2">
                  <Btn onClick={async () => {
                    try {
                      await ctx.api.mergeClients({ keepId: c.id, dropId: order.clientId });
                      await ctx.reload();
                      setDups(null);
                    } catch (e) { setErr(e.message); }
                  }}>
                    <Users size={15} />Это он — объединить карточки
                  </Btn>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Btn kind="quiet" onClick={() => setDups(null)}>Это разные люди, продолжить</Btn>
          </div>
        </div>
      )}
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="font-semibold">{client ? client.name : "Клиент удалён"}</div>
          <div className="text-slate-600">{carLabel(car) || "марка не указана"}</div>
        </div>

        {isStart && (
          <Field label="Госномер">
            <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="BG 123 AB" className={`${inputCls} font-mono uppercase`} />
            <p className={`mt-1 text-xs ${plate.trim() ? "text-slate-400" : "text-amber-600"}`}>
              {plate.trim()
                ? "Номер сохранится в карточке машины и проверится по базе."
                : "Без номера начать работу нельзя: по нему машина ищется в базе."}
            </p>
          </Field>
        )}

        {isStart && (
          <p className="text-xs text-slate-500">
            Клиент получит перечень работ с ценой по каждой позиции и срок готовности.
          </p>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Услуги и цены</span>
            <button onClick={addCustom} className="text-xs font-medium text-blue-800">+ Своя строка</button>
          </div>
          <div className="space-y-2">
            {groupItemsByDepartment(data, items).map((g) => (
              <div key={g.depId || "none"} className="mb-2 rounded-lg border border-slate-200 p-2">
                <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {g.name}
                </div>
                {g.idxs.map((idx) => {
                  const it = items[idx];
                  return (
                    <div key={idx} className="mb-1 flex flex-wrap items-center gap-2">
                      <input value={it.name} onChange={(e) => setItem(idx, { name: e.target.value })}
                        placeholder="Название услуги" className={`${inputBase} min-w-0 flex-1`} />
                      <NumField value={it.qty} min={1}
                        onChange={(v) => setItem(idx, { qty: Math.max(1, +v || 1) })}
                        wrapClass="w-16 shrink-0"
                        className={`${inputBase} w-full text-center`} />
                      <input type="number" value={it.price}
                        onChange={(e) => setItem(idx, { price: +e.target.value || 0 })}
                        className={`${inputBase} w-24 shrink-0 text-right`} />
                      <button onClick={() => dropItem(idx)} className="text-slate-400 hover:text-red-600">
                        <X size={16} />
                      </button>
                      {byItemDeps[g.depId || "none"] && (
                        <div className="w-full pl-1">
                          <PerformerPicker data={data} depId={g.depId}
                            chosen={itemStaffIds(it)}
                            onChange={(ids) => setItem(idx, { staffIds: ids })} />
                        </div>
                      )}
                      <div className="w-full">
                        <ItemSplit data={data} item={it} items={items} index={idx} money={money}
                          onChange={(patch) => patchItems([idx], () => patch)} />
                      </div>
                    </div>
                  );
                })}
                {/* На старте назначаем людей, часы вносим при сдаче работы */}
                <GroupAssign data={data} items={items} idxs={g.idxs} depId={g.depId}
                  money={money} onPatchItems={patchItems} withHours={!isStart}
                  byItem={!!byItemDeps[g.depId || "none"]}
                  onToggleByItem={() => toggleByItem(g.depId || "none")} />
              </div>
            ))}
            {items.length === 0 && (
              <p className="py-2 text-center text-xs text-slate-400">услуг пока нет</p>
            )}
          </div>

          <div className="mt-2 max-h-32 scroll-slim overflow-y-auto rounded-lg bg-slate-50 p-2">
            <div className="flex flex-wrap gap-1">
              {catalog.map((svc) => (
                <button key={svc.id} onClick={() => addFromCatalog(svc)}
                  className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs hover:border-blue-800">
                  {svc.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isStart ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Field label="Бокс">
              <select value={box} onChange={(e) => setBox(e.target.value)} className={inputCls}>
                <option value="">не выбран</option>
                {(data.boxes || []).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              </Field>
              <p className="mt-1 text-xs text-slate-400">Бокс будет занят в календаре до срока готовности.</p>
            </div>
            <div>
              <Field label="Готово к">
                <input type="datetime-local" value={readyAt}
                  onChange={(e) => setReadyAt(e.target.value)} className={inputCls} />
              </Field>
              <div className="mt-1 flex flex-wrap gap-1">
                {[["+2 ч", 2], ["+4 ч", 4], ["+8 ч", 8], ["завтра", 24]].map(([lbl, h]) => (
                  <button key={lbl} onClick={() => setReadyAt(plusHours(h))}
                    className="rounded-md border border-slate-200 px-2 py-0.5 text-xs hover:border-blue-800">
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <Field label="Затрачено часов">
              <input type="number" step="0.5" min="0" value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="например 5.5" className={`${inputCls} w-40`} />
            </Field>
            <p className="mt-1 text-xs text-slate-400">
              Для мойки подставляется автоматически, в остальных случаях впишите сами.
              Можно оставить пустым и заполнить позже.
            </p>
          </div>
        )}

        {err && <p className="text-sm text-red-600">{err}</p>}

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <div>
            <div className="text-xs text-slate-500">К оплате</div>
            <div className="font-mono text-lg font-bold">{money(Math.max(total, 0))}</div>
          </div>
          <div className="flex gap-2">
            <Btn onClick={onClose}>Отмена</Btn>
            <Btn kind="primary" onClick={submit}
              className={busy ? "opacity-60 pointer-events-none" : ""}>
              {busy ? "Сохраняю…" : isStart ? "Начать работу" : "Работа готова"}
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}


function OrderModal({ ctx, order, presetClientId, onClose, onSave, onSaveClient, onDelete }) {
  const { data, money, carById } = ctx;
  const presetClient = data.clients.find((c) => c.id === presetClientId);
  const [mode, setMode] = useState("exist");
  const [err, setErr] = useState("");
  const [clientId, setClientId] = useState(order ? order.clientId : presetClient ? presetClient.id : "");
  const [carId, setCarId] = useState(order ? order.carId : presetClient?.cars[0]?.id || "");
  const [newC, setNewC] = useState({ name: "", phone: "", plate: "", make: "", model: "", classId: data.classes[0]?.id });
  const [f, setF] = useState(
    // staffIds у заказа не держим: состав собирается из исполнителей услуг
    order
      ? { ...order, staffIds: undefined }
      : {
          id: uid("o"), clientId: "", carId: "",
          // Заявку завёл администратор — значит, студия её уже взяла.
          // «Записан» остаётся для того, что приходит из бота само.
          date: toLocal(new Date()), status: "accepted", items: [], discount: 0,
          comment: "", createdAt: toLocal(new Date()),
        }
  );
  const [q, setQ] = useState("");
  // Группы, где исполнителей назначают по каждой услуге отдельно:
  // мастер может числиться сразу в нескольких отделах.
  const [byItemDeps, setByItemDeps] = useState({});
  const toggleByItem = (key) => setByItemDeps((s) => ({ ...s, [key]: !s[key] }));

  const client = data.clients.find((c) => c.id === clientId);
  const car = carById[carId];
  const classId = car ? car.classId : newC.classId;

  const priceOf = (s) => s.prices[classId] ?? Object.values(s.prices)[0] ?? 0;
  const addItem = (s) => setF((o) => {
    const item = { serviceId: s.id, name: s.name, price: priceOf(s), qty: 1 };
    // правило доли переносим в заказ: цена услуги потом может измениться
    const rule = (s.splits || [])[0];
    if (rule?.depId) {
      item.splitDep = rule.depId;
      item.splitAmount = splitAmountFor(item, s);
      item.splitStaffIds = [];
    }
    let items = [...o.items, item];

    // Добавили полноценную услугу отдела — подготовка внутри других услуг
    // становится лишней: отдел не должен получить за одну работу дважды.
    if (s.departmentId) {
      items = items.map((it, i) =>
        i !== items.length - 1 && it.splitDep === s.departmentId && num(it.splitAmount) > 0
          ? { ...it, splitAmount: 0 }
          : it);
    }
    return { ...o, items };
  });
  const addCustom = () => setF((o) => ({ ...o, items: [...o.items, { serviceId: null, name: "", price: 0, qty: 1 }] }));
  const setItem = (i, k, v) => setF((o) => { const items = [...o.items]; items[i] = { ...items[i], [k]: v }; return { ...o, items }; });
  const dropItem = (i) => setF((o) => ({ ...o, items: o.items.filter((_, x) => x !== i) }));
  // правка сразу нескольких позиций: назначение мастеров на группу услуг
  const patchItems = (idxs, make) => setF((o) => ({
    ...o,
    items: o.items.map((it, x) => (idxs.includes(x) ? { ...it, ...make(it) } : it)),
  }));

  // Скидка — процент. Старые заказы хранят её суммой, поэтому значение
  // больше 100 считаем наследием и в расчёт не берём, пока мастер не поправит.
  const subtotal = f.items.reduce((s, i) => s + num(i.price) * num(i.qty || 1), 0);
  const discountPct = Math.min(Math.max(num(f.discount), 0), 100);
  const total = Math.round(subtotal * (1 - discountPct / 100));
  const dur = f.items.reduce((s, i) => {
    const sv = data.services.find((x) => x.id === i.serviceId);
    return s + (sv ? sv.duration * num(i.qty || 1) : 0);
  }, 0);

  const matches = data.clients.filter((c) => {
    const s = q.trim().toLowerCase();
    if (!s) return false;
    return ((c.name || "") + (c.phone || "") + c.cars.map((x) => x.plate || "").join(" ")).toLowerCase().includes(s);
  }).slice(0, 5);

  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setErr("");
    if (f.items.length === 0) { setErr("Добавьте хотя бы одну услугу — нажмите на неё в прайсе ниже."); return; }
    if (mode === "new" && !order && !newC.name.trim() && !newC.plate.trim()) {
      setErr("Для нового клиента нужно имя или госномер."); return;
    }
    if (mode === "exist" && !clientId) { setErr("Выберите клиента или переключитесь на «Новый»."); return; }
    // Откат стадии делается только на «Смене»: там спрашивают причину,
    // а отсюда он ушёл бы молча, и клиент ничего не узнал бы.
    if (order && isRollback(order.status, f.status)) {
      setErr(`Вернуть заказ на «${statusOf(f.status).label}» можно на «Смене» — там спросят причину.`);
      return;
    }

    setSaving(true);
    try {
      if (mode === "new" && !order) {
        const newCar = { plate: newC.plate.toUpperCase(), make: newC.make, model: newC.model, color: "", classId: newC.classId };
        const c = { name: newC.name.trim() || newC.plate.toUpperCase(), phone: newC.phone, source: "", note: "", cars: [newCar] };
        // Клиента и машину сначала сохраняем, и только потом создаём заказ:
        // заказу нужны НАСТОЯЩИЕ id из базы, иначе внешний ключ не сойдётся.
        const res = await onSaveClient(c);
        if (!res || !res.id) throw new Error("сервер не вернул id клиента");
        await onSave({ ...f, clientId: res.id, carId: (res.cars && res.cars[0]) || null });
        return;
      }
      await onSave({ ...f, clientId, carId: carId || client?.cars[0]?.id || null });
    } catch (e) {
      setErr("Не удалось сохранить: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={order ? `Заказ №${order.n}` : "Новый заказ"} wide>
      <div className="space-y-5">
        {/* клиент */}
        {!order && (
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="mb-3 flex gap-2">
              <button onClick={() => setMode("exist")}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "exist" ? "bg-blue-800 text-white" : "bg-slate-100 text-slate-600"}`}>Постоянный</button>
              <button onClick={() => setMode("new")}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "new" ? "bg-blue-800 text-white" : "bg-slate-100 text-slate-600"}`}>Новый</button>
            </div>

            {mode === "exist" ? (
              <div className="space-y-2">
                {client ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold">{client.name}</span>
                    <span className="font-mono text-xs text-slate-500">{client.phone}</span>
                    <button onClick={() => { setClientId(""); setCarId(""); }} className="text-xs text-blue-800 hover:underline">сменить</button>
                    <div className="w-full">
                      <Field label="Авто">
                        <select value={carId} onChange={(e) => setCarId(e.target.value)} className={inputCls}>
                          {client.cars.map((c) => <option key={c.id} value={c.id}>{c.plate} · {c.make} {c.model}</option>)}
                        </select>
                      </Field>
                    </div>
                  </div>
                ) : (
                  <div>
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Начните вводить имя, телефон или номер" className={inputCls} />
                    <div className="mt-1 space-y-1">
                      {matches.map((c) => (
                        <button key={c.id} onClick={() => { setClientId(c.id); setCarId(c.cars[0]?.id || ""); setQ(""); }}
                          className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-blue-700">
                          <span className="font-medium">{c.name}</span>
                          <span className="font-mono text-xs text-slate-500">{c.phone}</span>
                          {c.cars[0] && <span className="ml-auto"><Plate value={c.cars[0].plate} /></span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                <input value={newC.name} onChange={(e) => setNewC({ ...newC, name: e.target.value })} placeholder="Имя" className={inputCls} />
                <input value={newC.phone} onChange={(e) => setNewC({ ...newC, phone: e.target.value })} placeholder="Телефон" className={inputCls} />
                <input value={newC.plate} onChange={(e) => setNewC({ ...newC, plate: e.target.value.toUpperCase() })} placeholder="Госномер" className={`${inputCls} font-mono`} />
                <input value={newC.make} onChange={(e) => setNewC({ ...newC, make: e.target.value })} placeholder="Марка" className={inputCls} />
                <input value={newC.model} onChange={(e) => setNewC({ ...newC, model: e.target.value })} placeholder="Модель" className={inputCls} />
                <select value={newC.classId} onChange={(e) => setNewC({ ...newC, classId: e.target.value })} className={inputCls}>
                  {data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {order && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3">
            <span className="font-semibold">{ctx.clientById[order.clientId]?.name || "—"}</span>
            {carById[order.carId] && <Plate value={carById[order.carId].plate} size="lg" />}
            <span className="ml-auto text-xs text-slate-500">создан {humanDate(order.createdAt)}</span>
          </div>
        )}

        {/* услуги */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Услуги</span>
            <Btn kind="quiet" onClick={addCustom}><Plus size={14} />Своя строка</Btn>
          </div>
          <div className="space-y-2">
            {groupItemsByDepartment(data, f.items).map((g) => (
              <div key={g.depId || "none"} className="rounded-lg border border-slate-200 p-2">
                <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {g.name}
                </div>
                {g.idxs.map((i) => {
                  const it = f.items[i];
                  return (
                    <div key={i} className="mb-1 flex flex-wrap items-center gap-2">
                      <input value={it.name} onChange={(e) => setItem(i, "name", e.target.value)} className={`${inputBase} min-w-0 flex-1`} placeholder="Название" />
                      <NumField value={it.qty} onChange={(v) => setItem(i, "qty", num(v))} min={1}
                        wrapClass="w-16 shrink-0"
                        className={`${inputBase} w-full text-center font-mono`} />
                      <input type="number" value={it.price} onChange={(e) => setItem(i, "price", num(e.target.value))} className={`${inputBase} w-24 shrink-0 text-right font-mono`} />
                      <button onClick={() => dropItem(i)} className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><X size={16} /></button>
                      {byItemDeps[g.depId || "none"] && (
                        <div className="w-full pl-1">
                          <PerformerPicker data={data} depId={g.depId}
                            chosen={itemStaffIds(it)}
                            onChange={(ids) => setItem(i, "staffIds", ids)} />
                        </div>
                      )}
                      <div className="w-full">
                        <ItemSplit data={data} item={it} items={f.items} index={i} money={money}
                          onChange={(patch) => patchItems([i], () => patch)} />
                      </div>
                    </div>
                  );
                })}
                <GroupAssign data={data} items={f.items} idxs={g.idxs} depId={g.depId}
                  money={money} onPatchItems={patchItems}
                  byItem={!!byItemDeps[g.depId || "none"]}
                  onToggleByItem={() => toggleByItem(g.depId || "none")} />
              </div>
            ))}
          </div>

          <div className="mt-3 max-h-44 scroll-slim overflow-y-auto rounded-lg border border-slate-200 p-2">
            {data.categories.map((cat) => {
              const items = data.services.filter((s) => s.categoryId === cat.id && s.active);
              if (!items.length) return null;
              return (
                <div key={cat.id} className="mb-2">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{cat.name}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((s) => (
                      <button key={s.id} onClick={() => addItem(s)}
                        className="chip-pick rounded-full border px-2.5 py-1 text-xs">
                        {s.name} <span className="font-mono text-slate-500">{fmt(priceOf(s))}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* параметры */}
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Дата и время">
            <input type="datetime-local" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inputCls} />
          </Field>
          {/* Общего списка мастеров больше нет: исполнителей выбирают
              в группах услуг выше, а состав заказа собирается из них. */}
          <Field label="Статус">
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className={inputCls}>
              {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Скидка, %">
            <input type="number" min="0" max="100" value={f.discount}
              onChange={(e) => setF({ ...f, discount: Math.min(100, Math.max(0, num(e.target.value))) })}
              className={`${inputCls} font-mono`} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Бокс">
            <select value={f.box || ""} onChange={(e) => setF({ ...f, box: e.target.value })} className={inputCls}>
              <option value="">не выбран</option>
              {(data.boxes || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Комментарий">
          <textarea value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} rows={2} className={inputCls}
            placeholder="Что просил клиент, повреждения при приёмке…" />
        </Field>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">К оплате</div>
            <div className="font-mono text-2xl font-bold">{money(total)}</div>
            {discountPct > 0 && (
              <div className="text-xs text-slate-500">
                скидка {discountPct}% — минус {money(subtotal - total)}
              </div>
            )}
            {num(f.discount) > 100 && (
              <div className="text-xs text-amber-600">
                В поле скидки {num(f.discount)} — похоже, старое значение суммой. Впишите процент.
              </div>
            )}
            {dur > 0 && (
              <div className="flex items-center gap-1 text-xs text-slate-500"><Clock size={12} />≈ {Math.floor(dur / 60)} ч {dur % 60} мин работы</div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3">
            {err && <span className="max-w-xs text-xs font-medium text-rose-600">{err}</span>}
            {/* Удаление только у существующего заказа: новый удалять нечего */}
            {order && onDelete && (
              <button
                onClick={() => {
                  if (window.confirm(`Удалить заказ №${order.n}? Отменить это будет нельзя.`)) {
                    onDelete(order.id);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium
                  text-rose-600 transition hover:bg-rose-50">
                <Trash2 size={15} />Удалить
              </button>
            )}
            <Btn onClick={onClose}>Отмена</Btn>
            <Btn kind="primary" onClick={submit} className={saving ? "opacity-60 pointer-events-none" : ""}>
              {saving ? "Сохраняю…" : "Сохранить заказ"}
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Отчёты                                                             */
/* ------------------------------------------------------------------ */

// Периоды отчётов: одни и те же в самом отчёте и в блоке скидок.
// 0 — «всё время», 1 — «сегодня».
const PERIOD_OPTIONS = [
  [1, "Сегодня"], [7, "7 дней"], [30, "30 дней"], [90, "90 дней"],
  [180, "180 дней"], [365, "Год"], [0, "Всё время"],
];

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн",
                      "июл", "авг", "сен", "окт", "ноя", "дек"];

// Подпись столбца: дата для дней и недель, «сен 2026» для месяцев.
function barLabel(b) {
  if (!b) return "";
  if (b.label && b.label.length === 7) {
    const [y, m] = b.label.split("-");
    return `${MONTHS_SHORT[Number(m) - 1]} ${y}`;
  }
  return humanDate(b.k);
}

// Столбцы графика: день, неделя или месяц — смотря какой период выбран.
function buildBars(days, byDay, orders = []) {
  const dayList = Object.keys(byDay);
  const firstOrder = orders.length
    ? orders.map((o) => dayKey(o.date)).filter(Boolean).sort()[0] : null;

  // всё время: от первого заказа и до сегодня, по месяцам
  if (days === 0) {
    const start = firstOrder || toLocal(new Date()).slice(0, 10);
    const out = [];
    const d = new Date(start.slice(0, 7) + "-01");
    const now = new Date();
    while (d <= now) {
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      out.push({ k: key + "-01", label: key, v: 0 });
      d.setMonth(d.getMonth() + 1);
    }
    dayList.forEach((k) => {
      const b = out.find((x) => x.label === k.slice(0, 7));
      if (b) b.v += byDay[k];
    });
    return out;
  }

  if (days <= 31) {
    return Array.from({ length: days }, (_, i) => {
      const k = toLocal(shiftDays(-(days - 1 - i))).slice(0, 10);
      return { k, label: k, v: byDay[k] || 0 };
    });
  }

  if (days <= 180) {
    const weeks = Math.ceil(days / 7);
    return Array.from({ length: weeks }, (_, i) => {
      const startShift = -(days - 1) + i * 7;
      const k = toLocal(shiftDays(startShift)).slice(0, 10);
      let v = 0;
      for (let d = 0; d < 7; d++) {
        const key = toLocal(shiftDays(startShift + d)).slice(0, 10);
        v += byDay[key] || 0;
      }
      return { k, label: k, v };
    });
  }

  const months = Math.ceil(days / 30.44);
  const out = [];
  const d = new Date();
  d.setMonth(d.getMonth() - (months - 1), 1);
  for (let i = 0; i < months; i++) {
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    out.push({ k: key + "-01", label: key, v: 0 });
    d.setMonth(d.getMonth() + 1);
  }
  Object.keys(byDay).forEach((k) => {
    const b = out.find((x) => x.label === k.slice(0, 7));
    if (b) b.v += byDay[k];
  });
  return out;
}

function ReportsView(ctx) {
  const { data, money, orderTotal, staffById, payrollRate } = ctx;
  const [days, setDays] = useState(30);
  const [calMonth, setCalMonth] = useState(() => new Date());
  // days = 1 значит «сегодня», 0 — всё время
  const from = days === 0 ? "0000-00-00" : toLocal(shiftDays(-(days - 1))).slice(0, 10);

  // Деньги считаются только по выданным машинам: пока заказ в работе,
  // это ещё не выручка. Остальные висят в прогнозе ниже.
  const inPeriod = data.orders.filter(
    (o) => o.status !== "canceled" && o.status !== "cancelled" && dayKey(o.date) >= from);
  const list = inPeriod.filter((o) => o.status === "issued");
  const pipeline = inPeriod.filter((o) => o.status !== "issued");

  const revenue = list.reduce((s, o) => s + orderTotal(o), 0);
  const avg = list.length ? revenue / list.length : 0;

  // Прогноз: всё, что уже в системе, но ещё не выдано. Считаем целиком,
  // а не только за период — это деньги, которые студия ждёт.
  const openOrders = data.orders.filter(
    (o) => o.status !== "canceled" && o.status !== "cancelled" && o.status !== "issued");
  const forecast = openOrders.reduce((s, o) => s + orderTotal(o), 0);
  const byStage = {};
  openOrders.forEach((o) => {
    const b = byStage[o.status] || (byStage[o.status] = { n: 0, sum: 0 });
    b.n += 1; b.sum += orderTotal(o);
  });

  const byDay = {};
  list.forEach((o) => { byDay[dayKey(o.date)] = (byDay[dayKey(o.date)] || 0) + orderTotal(o); });

  // На длинных периодах по дню столбцы превращаются в кашу, поэтому
  // до месяца показываем дни, до полугода — недели, дальше — месяцы.
  const bars = buildBars(days, byDay, data.orders);
  const max = Math.max(1, ...bars.map((b) => b.v));

  // Цена до скидки. orderTotal() уже отдаёт сумму со скидкой,
  // поэтому разница между ними и есть скидка в деньгах.
  const gross = (o) => o.items.reduce((s, i) => s + num(i.price) * num(i.qty || 1), 0);

  // Скидка снимается со всего заказа, поэтому по услугам разносим её
  // пропорционально: иначе сумма услуг не сходится с выручкой.
  const byService = {};
  list.forEach((o) => {
    const g = gross(o);
    const factor = g > 0 ? orderTotal(o) / g : 1;
    o.items.forEach((i) => {
      byService[i.name] = byService[i.name] || { count: 0, sum: 0, full: 0 };
      byService[i.name].count += num(i.qty || 1);
      byService[i.name].full += num(i.price) * num(i.qty || 1);
      byService[i.name].sum += num(i.price) * num(i.qty || 1) * factor;
    });
  });
  // Ничего не обрезаем: список прокручивается целиком, иначе часть
  // выручки исчезала из виду и цифры не сходились.
  const topServices = Object.entries(byService).sort((a, b) => b[1].sum - a[1].sum);

  // Выработка: деньги и часы. Часы вносит мастер при закрытии работы,
  // поэтому у части заказов их может не быть — такие в ставку не идут.
  // Заработок по людям: наёмные получают долю фонда, собственники —
  // остаток заказа. Прибыль компании считается отдельно и от дохода
  // собственников не зависит.
  const isOwner = (id) => !!(data.staff || []).find((s) => s.id === id)?.isOwner;

  const byStaff = {};
  const bucket = (k) => byStaff[k] || (byStaff[k] = {
    sum: 0, hours: 0, orders: 0, paidHours: 0, shared: 0, byService: {}, noStaff: 0,
    owner: isOwner(k),
  });

  let payrollFund = 0;      // реальный расход на зарплату наёмных
  let ownerIncome = 0;      // доход собственников

  list.forEach((o) => {
    const r = orderEarnings(o, orderTotal, isOwner, payrollRate);
    payrollFund += r.fund;
    ownerIncome += r.ownerPool;

    Object.keys(r.earned).forEach((id) => {
      const s = bucket(id);
      s.sum += r.earned[id];
      s.hours += r.hours[id] || 0;
      if ((r.hours[id] || 0) > 0) s.paidHours += r.earned[id];
      s.orders += 1;
      Object.entries(r.services[id] || {}).forEach(([name, v]) => {
        // в разбивке по услугам показываем заработок, а не стоимость работ
        const k = r.value[id] > 0 ? r.earned[id] / r.value[id] : 0;
        s.byService[name] = (s.byService[name] || 0) + v * k;
      });
    });
  });

  // список для блока «Заработок мастеров»: сначала те, кто заработал больше
  const staffRows = Object.entries(byStaff).sort((a, b) => b[1].sum - a[1].sum);

  const profit = revenue - payrollFund;

  // Топ клиентов — за всё время, а не за выбранный период:
  // важно, сколько человек принёс с первого визита.
  const clientStats = (() => {
    const acc = {};
    data.orders.forEach((o) => {
      // Деньги клиента — это выданные машины. Пока заказ в работе,
      // сумма ещё может измениться, и в топ он попадать не должен.
      if (o.status !== "issued") return;
      const a = acc[o.clientId] || (acc[o.clientId] = { spent: 0, visits: 0, first: null, last: null });
      const d = dayKey(o.date);
      a.spent += orderTotal(o);
      a.visits += 1;
      if (!a.first || d < a.first) a.first = d;
      if (!a.last || d > a.last) a.last = d;
    });
    return Object.entries(acc).map(([id, a]) => {
      const c = data.clients.find((x) => x.id === Number(id) || x.id === id);
      const start = a.first || (c?.createdAt || "").slice(0, 10);
      const days = Math.max(1, daysBetween(start, new Date()));
      const months = days / 30.44;
      return { id, name: c?.name || "Клиент удалён", phone: c?.phone,
               ...a, start, days, months, perMonth: a.spent / Math.max(1, months) };
    }).sort((x, y) => y.spent - x.spent);
  })();
  const topClients = clientStats;

  // Доля тех, кто вернулся. Считаем от клиентов с закрытыми визитами:
  // раньше делили на всю базу, включая карточки вообще без заказов,
  // и показатель почти всегда был близок к нулю.
  const returning = (() => {
    const counts = {};
    data.orders.forEach((o) => {
      if (o.status !== "issued") return;
      counts[o.clientId] = (counts[o.clientId] || 0) + 1;
    });
    const withVisits = Object.values(counts).length;
    const rep = Object.values(counts).filter((c) => c > 1).length;
    return withVisits ? Math.round((rep / withVisits) * 100) : 0;
  })();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Отчёты</h1>
        <div className="flex gap-1 rounded-lg bg-white p-1">
          {PERIOD_OPTIONS.map(([d, label]) => (
            <button key={d} onClick={() => setDays(d)}
              className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${
                days === d ? "bg-blue-800 text-white" : "text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Выручка" value={money(revenue)} />
        <Stat label="Выдано машин" value={list.length}
          sub={pipeline.length ? `${pipeline.length} ещё в работе` : null} />
        <Stat label="Средний чек" value={money(avg)} />
        <Stat label="Фонд мастеров" value={money(payrollFund)}
          sub={`${Math.round(payrollRate * 100)}% с работ наёмных`} />
        <Stat label="Прибыль компании" value={money(profit)}
          sub={ownerIncome > 0 ? `доход собственников ${money(ownerIncome)} сверх этого` : null} />
        <Stat label="Повторных клиентов" value={returning + "%"}
          sub="от тех, кто уже забирал машину" />
      </div>

      {/* Деньги: сперва факт и динамика, затем ожидания и потери */}

      {days !== 1 && (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-bold">Выручка по дням</h3>
        <div className="flex h-40 items-end gap-1">
          {bars.map((b) => (
            <div key={b.k} className="group relative flex-1" title={`${barLabel(b)}: ${money(b.v)}`}>
              <div className="w-full rounded-t bg-blue-800 transition-all hover:bg-cyan-500"
                style={{ height: Math.max(2, (b.v / max) * 150) + "px" }} />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between font-mono text-xs text-slate-400">
          <span>{barLabel(bars[0])}</span>
          <span>{days > 31 ? (days === 0 ? "по месяцам" : days <= 180 ? "по неделям" : "по месяцам") : ""}</span>
          <span>{barLabel(bars[bars.length - 1])}</span>
        </div>
      </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <ForecastPanel ctx={ctx} forecast={forecast} byStage={byStage} count={openOrders.length} />
        <DiscountPanel ctx={ctx} days={days} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-bold">Что приносит деньги</h3>
          {topServices.length === 0 ? <p className="text-sm text-slate-400">Данных пока нет.</p> : (
            <div className="max-h-80 space-y-2 scroll-slim overflow-y-auto pr-1">
              {topServices.map(([name, v]) => (
                <div key={name}>
                  <div className="flex justify-between text-sm">
                    <span className="truncate pr-2">{name}</span>
                    <span className="font-mono font-semibold">{money(v.sum)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full bg-cyan-500"
                      style={{ width: Math.min(100, (v.sum / Math.max(1, topServices[0][1].sum)) * 100) + "%" }} />
                  </div>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>{v.count} шт.</span>
                    {v.full - v.sum > 1 && (
                      <span title="Столько срезали скидки">
                        до скидок {money(v.full)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {topServices.length > 0 && (
            <div className="mt-2 border-t border-slate-200 pt-2">
              <div className="flex justify-between text-sm font-semibold">
                <span>Итого · {topServices.length} услуг(и)</span>
                <span className="font-mono">{money(revenue)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-bold">
            Заработок мастеров
            <span className="ml-2 font-normal text-slate-400">
              наёмные — {Math.round(payrollRate * 100)}%, собственники — стоимость своих работ
            </span>
          </h3>
          {staffRows.length === 0 ? <p className="text-sm text-slate-400">Данных пока нет.</p> : (
            <div className="max-h-80 space-y-2 scroll-slim overflow-y-auto pr-1">
              {staffRows.map(([id, v]) => (
                <div key={id}
                  onClick={() => staffById[id] && ctx.setStaffCard(id)}
                  role={staffById[id] ? "button" : undefined}
                  className={`rounded-lg bg-slate-50 px-3 py-2 ${
                    staffById[id] ? "cursor-pointer transition hover:bg-slate-100" : ""}`}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      {staffById[id]?.name || "Без мастера"}
                      {v.owner && (
                        <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500"
                          title="Собственник: получает полную стоимость своих работ">
                          собственник
                        </span>
                      )}
                    </span>
                    <span className="font-mono font-semibold">{money(v.sum)}</span>
                  </div>
                  <div className="mt-0.5 flex justify-between text-xs text-slate-500">
                    <span>
                      {v.orders} заказ(ов)
                      {v.noStaff > 0 ? ` · ${v.noStaff} услуг(и) без исполнителя` : ""}
                      {v.hours > 0 ? ` · ${v.hours.toFixed(1)} ч` : " · часы не внесены"}
                    </span>
                    {v.hours > 0 && (
                      <span className="font-mono" title="Заработок мастера за час работы">
                        {money(v.paidHours / v.hours)}/час
                      </span>
                    )}
                  </div>
                </div>
              ))}

            </div>
          )}
        </div>
      </div>

      {/* Операционная часть: сколько заняли времени и кто загружен.
          На широком экране идут парой — это связанные показатели. */}
      <div className="grid gap-4 xl:grid-cols-2">
        <FunnelPanel ctx={ctx} orders={inPeriod} />
        <WorkloadPanel ctx={ctx} byStaff={byStaff} list={list} />
      </div>

      <WashOnlyPanel ctx={ctx} />

      <TopClientsPanel ctx={ctx} rows={topClients} total={clientStats.length}
        allSpent={clientStats.reduce((s, r) => s + r.spent, 0)} />

      <CalendarPanel ctx={ctx} month={calMonth} onMonth={setCalMonth} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Календарь месяца: сколько заказов и на какую сумму в каждый день    */
/* ------------------------------------------------------------------ */
function CalendarPanel({ ctx, month, onMonth }) {
  const { data, money, orderTotal, clientById, carById } = ctx;

  const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
                  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  const y = month.getFullYear(), m = month.getMonth();
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;          // неделя начинается с понедельника
  const todayKeyStr = toLocal(new Date()).slice(0, 10);

  // раскладываем заказы месяца по дням
  const byDay = {};
  data.orders.forEach((o) => {
    if (o.status === "canceled" || o.status === "cancelled") return;
    const k = dayKey(o.date);
    if (!k.startsWith(`${y}-${pad(m + 1)}`)) return;
    (byDay[k] = byDay[k] || []).push(o);
  });

  const maxSum = Math.max(1, ...Object.values(byDay).map(
    (list) => list.reduce((s, o) => s + orderTotal(o), 0)));

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${y}-${pad(m + 1)}-${pad(d)}`);

  const monthOrders = Object.values(byDay).flat();
  // Разделяем факт и план: выданные машины — это деньги, остальные ещё нет.
  const monthDone = monthOrders.filter((o) => o.status === "issued");
  const monthSum = monthDone.reduce((s, o) => s + orderTotal(o), 0);
  const monthOpenSum = monthOrders
    .filter((o) => o.status !== "issued")
    .reduce((s, o) => s + orderTotal(o), 0);
  const shift = (delta) => onMonth(new Date(y, m + delta, 1));


  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold">Календарь</h3>
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="rounded-md border border-slate-200 px-2 py-1 text-sm row-hover">←</button>
          <span className="min-w-36 text-center text-sm font-semibold">{MONTHS[m]} {y}</span>
          <button onClick={() => shift(1)} className="rounded-md border border-slate-200 px-2 py-1 text-sm row-hover">→</button>
        </div>
      </div>

      <div className="mb-3 text-xs text-slate-500">
        За месяц: <span className="font-mono font-semibold text-slate-700">{monthOrders.length}</span> заказов ·
        выдано <span className="font-mono font-semibold text-slate-700">{monthDone.length}</span> на{" "}
        <span className="font-mono font-semibold text-slate-700">{money(monthSum)}</span>
        {monthOpenSum > 0 && (
          <span className="text-amber-600"> · ожидается {money(monthOpenSum)}</span>
        )}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WD.map((w) => (
          <div key={w} className="pb-1 text-center text-xs font-semibold uppercase text-slate-400">{w}</div>
        ))}
        {cells.map((k, i) => {
          if (!k) return <div key={`e${i}`} />;
          const list = byDay[k] || [];
          const sum = list.reduce((s, o) => s + orderTotal(o), 0);
          const heat = sum / maxSum;
          const isToday = k === todayKeyStr;
          return (
            <button key={k} onClick={() => ctx.openShiftOn(k)}
              className={`min-h-16 rounded-lg border p-1.5 text-left transition
                ${isToday ? "border-blue-400" : "border-slate-200 hover:border-slate-300"}`}
              title="Открыть смену этого дня"
              style={sum ? { background: `rgba(84,104,230,${0.06 + heat * 0.22})` } : undefined}>
              <div className={`text-xs ${isToday ? "font-bold text-blue-800" : "text-slate-500"}`}>
                {parseInt(k.slice(-2), 10)}
              </div>
              {list.length > 0 && (
                <>
                  <div className="mt-0.5 font-mono text-xs font-semibold text-slate-800">{list.length}</div>
                  <div className="truncate font-mono text-xs text-slate-500">{money(sum)}</div>
                </>
              )}
            </button>
          );
        })}
      </div>

    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Настройки                                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Боксы: названия и цвета                                            */
/*  Список приходит из прайса бота, но названия и цвета живут здесь.    */
/*  Синхронизация только добавляет недостающие боксы и правки не трёт.  */
/* ------------------------------------------------------------------ */
function BoxesEditor({ data, patch }) {
  const boxes = data.boxes || [];
  const [newName, setNewName] = useState("");
  const [openFor, setOpenFor] = useState(null);

  const save = (list) => {
    patch((d) => ({ ...d, boxes: list, settings: { ...d.settings, boxes: JSON.stringify(list) } }));
    api.saveSettings({ boxes: JSON.stringify(list) }).catch(console.warn);
  };

  const update = (id, changes) => save(boxes.map((b) => (b.id === id ? { ...b, ...changes } : b)));

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const add = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    // ключ бокса — латиницей: он уходит в календарь и в прайс бота
    const base = "box_" + Math.random().toString(36).slice(2, 7);
    const used = boxes.map((b) => b.color).filter(Boolean);
    const free = BOX_PALETTE.find((p) => !used.includes(p.hex)) || BOX_PALETTE[0];

    setBusy(true);
    setNote("");
    try {
      // сервер попросит бота завести календарь: сама CRM в Google не ходит
      const res = await api.saveBox({ id: base, name, withCalendar: true });
      save([...boxes, { id: base, name, color: free.hex,
                        calendar_id: res?.calendar?.calendar_id || "" }]);
      setNote(res?.calendar?.ok
        ? `Календарь «${name}» создан и открыт для ${res.calendar.shared_with}. ` +
          `Добавьте его у себя: Google Calendar → «Другие календари» → «Подписаться по ID».`
        : "Бокс добавлен, но календарь создать не удалось — проверьте, что бот запущен.");
      setNewName("");
    } catch (e) {
      setNote("Не удалось сохранить бокс.");
    } finally {
      setBusy(false);
    }
  };

  const makeCalendar = async (b) => {
    setBusy(true); setNote("");
    try {
      const res = await api.saveBox({ id: b.id, name: b.name, withCalendar: true });
      if (res?.calendar?.ok) {
        update(b.id, { calendar_id: res.calendar.calendar_id });
        setNote(`Календарь создан и открыт для ${res.calendar.shared_with}.`);
      } else {
        setNote("Календарь создать не удалось — проверьте, что бот запущен.");
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b) => {
    if (!window.confirm(`Удалить бокс «${b.name}»? Календарь в Google останется — ` +
      `в нём история записей.`)) return;
    try {
      await api.deleteBox(b.id);
      save(boxes.filter((x) => x.id !== b.id));
    } catch (e) {
      setNote("Бокс не удалён: в нём есть незакрытые заказы.");
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold">Боксы</h3>
      <p className="text-sm text-slate-500">
        По цвету бокса подсвечиваются карточки на «Смене» и строки в «Заказах».
        Список приходит из прайса бота — названия и цвета правятся здесь и не затираются.
      </p>

      <div className="space-y-2">
        {boxes.map((b) => (
          <div key={b.id} className="rounded-lg border border-slate-200 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setOpenFor(openFor === b.id ? null : b.id)}
                className="h-8 w-8 shrink-0 rounded-lg border border-slate-300"
                style={{ background: boxColor(b.id, data) }} title="Выбрать цвет" />
              <input value={b.name} onChange={(e) => update(b.id, { name: e.target.value })}
                className={`${inputBase} min-w-0 flex-1`} placeholder="Название бокса" />
              <span className="font-mono text-xs text-slate-400">{b.id}</span>
              {b.calendar_id
                ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800"
                        title={b.calendar_id}>календарь есть</span>
                : <button onClick={() => makeCalendar(b)} disabled={busy}
                    className="chip-pick rounded-full border px-2 py-0.5 text-xs">
                    завести календарь
                  </button>}
              <button onClick={() => remove(b)} title="Удалить бокс"
                className="px-2 text-rose-500 transition hover:text-rose-700">
                <Trash2 size={15} />
              </button>
            </div>

            {openFor === b.id && (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
                {BOX_PALETTE.map((c) => (
                  <button key={c.id} title={c.name}
                    onClick={() => { update(b.id, { color: c.hex }); setOpenFor(null); }}
                    className={`h-7 w-7 rounded-md border-2 transition
                      ${boxColor(b.id, data) === c.hex ? "border-slate-900" : "border-transparent"}`}
                    style={{ background: c.hex }} />
                ))}
              </div>
            )}
          </div>
        ))}

        {boxes.length === 0 && (
          <p className="text-sm text-slate-400">
            Боксов пока нет. Добавьте вручную или запустите sync_catalog.py — он подтянет их из прайса бота.
          </p>
        )}
      </div>

      {note && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}

      <div className="flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Название нового бокса" className={inputCls} />
        <Btn onClick={add} className={busy ? "opacity-60" : ""}>
          <Plus size={15} />{busy ? "Создаю…" : "Добавить"}
        </Btn>
      </div>
    </div>
  );
}

function SettingsView(ctx) {
  const { data, patch, setData, setView, theme, setTheme, reload, api } = ctx;
  const [className, setClassName] = useState("");
  const [wipe, setWipe] = useState(false);

  const setS = (k, v) => {
    patch((d) => ({ ...d, settings: { ...d.settings, [k]: v } }));
    api.saveSettings({ [k]: v }).catch(console.warn);
  };

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-xl font-bold">Настройки</h1>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold">Заведение</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Название"><input value={data.settings.company} onChange={(e) => setS("company", e.target.value)} className={inputCls} /></Field>
          <Field label="Фонд мастеров, %">
            <NumField value={data.settings.payroll_percent ?? 25}
              onChange={(v) => setS("payroll_percent", v)} step={1} min={0} max={100}
              wrapClass="w-full" className={`${inputCls} font-mono`} />
            <span className="mt-1 block text-xs text-slate-500">
              Эту долю от суммы заказа делят между собой мастера. Остальное — прибыль студии.
            </span>
          </Field>
          <Field label="Валюта"><input value={data.settings.currency} onChange={(e) => setS("currency", e.target.value)} className={inputCls} /></Field>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold">Оформление</h3>
        <p className="text-sm text-slate-500">
          Тема сохраняется в настройках студии — значит одинакова на всех устройствах,
          где открыта CRM.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { id: "light", label: "Светлая", hint: "для дневного света в боксе",
              swatch: ["#f2f1ec", "#ffffff", "#5468e6", "#2f2f2f"] },
            { id: "dark", label: "Тёмная", hint: "как на сайте студии",
              swatch: ["#2f2f2f", "#3d4046", "#5468e6", "#f1f0ec"] },
          ].map((opt) => (
            <button key={opt.id} onClick={() => setTheme(opt.id)}
              className={`rounded-xl border p-3 text-left transition
                ${theme === opt.id ? "border-blue-700 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{opt.label}</span>
                {theme === opt.id && <Check size={14} className="text-blue-800" />}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{opt.hint}</div>
              <div className="mt-2 flex gap-1">
                {opt.swatch.map((c, i) => (
                  <span key={i} className="h-5 w-8 rounded"
                    style={{ background: c, border: "1px solid rgba(0,0,0,0.12)" }} />
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>

      <BoxesEditor data={data} patch={patch} />

      <DepartmentsEditor data={data} api={api} reload={reload} />

      <SuppliersEditor data={data} api={api} reload={reload} />

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold">Классы автомобилей</h3>
        <p className="text-xs text-slate-500">По ним считается цена в прайсе. Добавите класс — в услугах появится новая колонка.</p>
        <div className="space-y-2">
          {data.classes.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <input value={c.name}
                onChange={(e) => patch((d) => ({ ...d, classes: d.classes.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)) }))}
                className={inputCls} />
              <button onClick={() => patch((d) => ({ ...d, classes: d.classes.filter((x) => x.id !== c.id) }))}
                className="rounded p-2 text-slate-400 hover:text-rose-600"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={className} onChange={(e) => setClassName(e.target.value)} placeholder="Например: пикап, микроавтобус" className={inputCls} />
          <Btn onClick={() => { if (className.trim()) { patch((d) => ({ ...d, classes: [...d.classes, { id: uid("cl"), name: className.trim() }] })); setClassName(""); } }}>
            <Plus size={15} />Добавить
          </Btn>
        </div>
      </div>

      {ctx.can("settings.users") && <UsersEditor ctx={ctx} />}

      <PasswordCard ctx={ctx} />

      <div className="space-y-3 rounded-xl border border-rose-200 bg-white p-4">
        <h3 className="text-sm font-bold">Данные</h3>
        <p className="text-xs text-slate-500">База хранится в этом приложении и остаётся между сессиями.</p>
        <div className="flex flex-wrap gap-2">
          <Btn onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
            const a = document.createElement("a"); a.href = url; a.download = "crm-backup.json"; a.click(); URL.revokeObjectURL(url);
          }}><Download size={15} />Скачать резервную копию</Btn>
          {ctx.can("settings.wipe") && (
            <Btn kind="danger" onClick={() => setWipe(true)}>
              <Trash2 size={15} />Очистить базу
            </Btn>
          )}
        </div>
      </div>

      {wipe && <WipeModal ctx={ctx} onClose={() => setWipe(false)} />}
    </div>
  );
}


// Маппинг ключей услуг бота → человеческие названия (ru)
const SERVICE_KEY_NAMES = {
  ext1: "Комплекс (3 фазы)",
  ext2: "Детейлинг мойка кузова",
  ext3: "Детейлинг мотора",
  ext4: "Керамика дисков",
  ext5: "Мойка + воск кузова",
  ext6: "Детейлинг арок и днища",
  int1: "Химчистка салона",
  int2: "Химчистка ковров и матов",
  int3: "Озонирование",
  int4: "Покраска и реставрация кожи",
  int5: "Полировка пластика салона",
  pol1: "Абразивная полировка (1 этап)",
  pol2: "Абразивная полировка (2 этапа)",
  pol3: "Антиголограммная полировка",
  pol4: "Керамика (1 слой)",
  pol5: "Керамика (2 слоя)",
  pol6: "Воск / защитное покрытие",
  pol7: "Жидкое стекло",
  pol8: "Керамика для плёнки",
  opt1: "Полировка фар",
  opt2: "Покрытие фар керамикой",
  opt3: "Гидрофоб стёкол",
  opt4: "Восстановление пластика",
};
const svcName = (key) => SERVICE_KEY_NAMES[key] || key;

// Источник заявки / заказа
const SOURCE_BADGE = {
  bot: { label: "Telegram-бот", cls: "bg-blue-100 text-blue-800" },
  crm: { label: "CRM (вручную)", cls: "bg-slate-100 text-slate-600" },
};

/* ------------------------------------------------------------------ */
/*  Входящие заявки из Telegram-бота                                   */
/* ------------------------------------------------------------------ */

function InboxView(ctx) {
  const { data, money, clientById, carById, staffById, acceptRequest, api, reload } = ctx;
  const requests = data.requests || [];

  const STATUS_LABELS = {
    new: { label: "Новая", chip: "bg-blue-100 text-blue-800" },
    contacting: { label: "Связываемся", chip: "bg-amber-100 text-amber-800" },
    confirmed: { label: "Подтверждена", chip: "bg-cyan-100 text-cyan-800" },
    arrived: { label: "Приехал", chip: "bg-purple-100 text-purple-800" },
    in_progress: { label: "В работе", chip: "bg-orange-100 text-orange-800" },
    rejected: { label: "Отклонена", chip: "bg-rose-100 text-rose-700" },
    cancelled: { label: "Отменена", chip: "bg-slate-100 text-slate-500" },
  };

  const [accepting, setAccepting] = React.useState(null);
  const [staffSel, setStaffSel] = React.useState({});
  const [dateSel, setDateSel] = React.useState({});
  const [errs, setErrs] = React.useState({});

  // Клиент больше не выбирает время (кроме одиночной мойки), поэтому
  // визит назначает мастер прямо здесь — без даты заказ не создать.
  const dateFor = (r) => dateSel[r.id] ?? (r.scheduledAt || r.wishDate || "").replace(" ", "T").slice(0, 16);

  const doAccept = async (rid, r) => {
    const when = dateFor(r);
    if (!when) {
      setErrs((e) => ({ ...e, [rid]: "Выберите дату и время визита." }));
      return;
    }
    setErrs((e) => ({ ...e, [rid]: "" }));
    setAccepting(rid);
    try {
      await acceptRequest(rid, { staffId: staffSel[rid] || null, date: when.replace("T", " ") });
    } catch (e) {
      setErrs((er) => ({ ...er, [rid]: "Не удалось принять: " + e.message }));
    } finally {
      setAccepting(null);
    }
  };

  const doDelete = async (r) => {
    if (!window.confirm(
      `Удалить заявку №${r.id} насовсем?\n\n` +
      (r.orderId ? "Созданный по ней заказ останется — его удаляйте отдельно.\n\n" : "") +
      "Клиенту ничего не отправится. Если нужно просто отказать — жмите «Отклонить»."
    )) return;
    try {
      await api.deleteRequest(r.id);
      await reload();
    } catch (e) {
      alert("Не удалось удалить заявку: " + e.message);
    }
  };

  const doReject = async (rid) => {
    await api.requestStatus(rid, "rejected");
    await reload();
  };

  const doCancel = async (rid) => {
    if (!window.confirm("Отменить эту запись? Клиент получит уведомление.")) return;
    await api.requestStatus(rid, "cancelled");
    await reload();
  };

  const doContacting = async (rid) => {
    await api.requestStatus(rid, "contacting");
    await reload();
  };

  if (requests.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Входящие из Telegram</h1>
        <Empty text="Новых заявок нет. Когда клиент напишет в бот — заявка появится здесь." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          Входящие из Telegram
          <span className="ml-2 rounded-full bg-blue-800 px-2 py-0.5 font-mono text-sm text-white">{requests.length}</span>
        </h1>
        <Btn onClick={reload}><Clock size={15} />Обновить</Btn>
      </div>

      <div className="space-y-3">
        {requests.map((r) => {
          const client = clientById[r.clientId] || {};
          const car = carById[r.carId] || {};
          const st = STATUS_LABELS[r.status] || { label: r.status, chip: "bg-slate-100 text-slate-600" };
          const services = (r.items || []).map((i) => svcName(i.serviceKey)).join(", ");

          return (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{client.name || "Клиент #" + r.clientId}</span>
                    {client.phone && (
                      <a href={`tel:${(client.phone || "").replace(/\s/g, "")}`}
                        className="inline-flex items-center gap-1 font-mono text-xs text-blue-800 hover:underline">
                        <Phone size={12} />{client.phone}
                      </a>
                    )}
                    {client.username && (
                      <a href={`https://t.me/${client.username}`} target="_blank" rel="noreferrer"
                        className="text-xs text-blue-700 hover:underline">@{client.username}</a>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {car.plate && <Plate value={car.plate} />}
                    {car.make && <span className="text-sm text-slate-600">{car.make} {car.model}</span>}
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${st.chip}`}>
                      {st.label}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-400">#{r.id} · {humanDate(r.createdAt)}</div>
                  {r.createdBy === "master"
                    ? <span className="mt-1 inline-block rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-800">👨‍🔧 Мастер</span>
                    : <span className="mt-1 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">👤 Клиент (бот)</span>
                  }
                </div>
              </div>

              {services && (
                <div className="mt-2 text-sm text-slate-700">
                  <span className="font-medium">Услуги: </span>{services}
                </div>
              )}

              {r.wishDate && (
                <div className="mt-1 text-sm text-slate-600">
                  <span className="font-medium">Пожелание: </span>
                  {humanDate(r.wishDate)}
                  {r.wishSlot && ` · ${r.wishSlot}`}
                </div>
              )}

              {r.comment && (
                <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {r.comment}
                </div>
              )}

              {["new", "confirmed", "contacting"].includes(r.status) && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  {r.status !== "confirmed" && (
                    <select
                      value={staffSel[r.id] || ""}
                      onChange={(e) => setStaffSel((s) => ({ ...s, [r.id]: e.target.value }))}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                      <option value="">Мастер не назначен</option>
                      {(data.staff || []).filter((s) => s.active).map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  )}

                  {/* Дата визита: без неё заказ не создать.
                      Клиент её больше не называет, назначает мастер. */}
                  {r.status !== "confirmed" && (
                    <input type="datetime-local" value={dateFor(r)}
                      onChange={(e) => setDateSel((d) => ({ ...d, [r.id]: e.target.value }))}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                  )}

                  {/* бокс можно наметить заранее — окончательный выбор при начале работ */}
                  <select
                    value={r.box || ""}
                    onChange={async (e) => { await api.setRequestBox(r.id, e.target.value); await reload(); }}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    style={r.box ? { borderColor: boxColor(r.box, data), color: boxColor(r.box, data) } : undefined}>
                    <option value="">Бокс не выбран</option>
                    {(data.boxes || []).map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>

                  {errs[r.id] && (
                    <span className="w-full text-sm font-medium text-rose-600">{errs[r.id]}</span>
                  )}

                  {/* Удаление насовсем — для тестовых и мусорных заявок.
                      «Отклонить» лишь меняет статус и уведомляет клиента. */}
                  <button onClick={() => doDelete(r)} title="Удалить заявку из базы"
                    className="ml-auto rounded-lg px-2 py-1.5 text-rose-500 transition hover:bg-rose-50 hover:text-rose-700">
                    <Trash2 size={15} />
                  </button>

                  {r.status === "new" && (
                    <>
                      <Btn kind="primary" onClick={() => doAccept(r.id, r)}
                        className={accepting === r.id ? "opacity-60" : ""}>
                        <Check size={15} />
                        {accepting === r.id ? "Создаю заказ…" : "Принять → создать заказ"}
                      </Btn>
                      <Btn kind="ghost" onClick={() => doContacting(r.id)}>
                        Свяжусь сам
                      </Btn>
                      <Btn kind="danger" onClick={() => doReject(r.id)}>
                        <X size={15} />Отклонить
                      </Btn>
                    </>
                  )}

                  {r.status === "contacting" && (
                    <>
                      <Btn kind="primary" onClick={() => doAccept(r.id, r)}
                        className={accepting === r.id ? "opacity-60" : ""}>
                        <Check size={15} />
                        {accepting === r.id ? "Создаю заказ…" : "Принять → создать заказ"}
                      </Btn>
                      <Btn kind="danger" onClick={() => doReject(r.id)}>
                        <X size={15} />Отклонить
                      </Btn>
                    </>
                  )}

                  {/* confirmed: заказ уже создан ботом при подтверждении в Telegram —
                      в CRM остаётся только отменить, если что-то пошло не так */}
                  {r.status === "confirmed" && (
                    <Btn kind="danger" onClick={() => doCancel(r.id)}>
                      <X size={15} />Отменить запись
                    </Btn>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Сообщения клиентам через бота                                      */
/* ------------------------------------------------------------------ */

function MessageModal({ ctx, target, onClose }) {
  const { data, api, reload } = ctx;
  const [text, setText] = useState("");
  const [state, setState] = useState("edit");   // edit | sending | done
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const all = target.mode === "all";
  const one = all ? null : data.clients.find((c) => c.id === target.clientId);
  const recipients = all ? data.clients.filter((c) => c.tg_id) : (one && one.tg_id ? [one] : []);

  const send = async () => {
    if (!text.trim()) { setErr("Напишите текст сообщения."); return; }
    setErr(""); setState("sending");
    try {
      const res = await api.sendMessage({
        text: text.trim(),
        clientIds: all ? "all" : [target.clientId],
      });
      setResult(res);
      setState("done");
      reload();
    } catch (e) {
      setErr("Не удалось поставить сообщение в очередь. Проверьте, что API обновлён и работает.");
      setState("edit");
    }
  };

  const title = all ? "Сообщение всем клиентам" : `Сообщение: ${one?.name || "клиент"}`;

  return (
    <Modal open onClose={onClose} title={title}>
      {state === "done" ? (
        <div className="space-y-4">
          <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">
            В очереди на отправку: <b>{result?.queued ?? 0}</b>
            {result?.skipped ? <> · пропущено без Telegram: {result.skipped}</> : null}
            <div className="mt-1">Бот разошлёт их в течение минуты. Кто заблокировал бота — будет пропущен.</div>
          </div>
          <div className="flex justify-end"><Btn kind="primary" onClick={onClose}>Закрыть</Btn></div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            {all ? (
              <>Получателей: <b>{recipients.length}</b> — все клиенты, у которых есть Telegram.</>
            ) : recipients.length ? (
              <>Получатель: <b>{one.name || "без имени"}</b>{one.username ? ` · @${one.username}` : ""}</>
            ) : (
              <span className="text-rose-600">У клиента нет Telegram — бот не сможет написать, позвоните.</span>
            )}
          </div>

          <Field label="Текст сообщения">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className={inputCls}
              placeholder={all
                ? "Например: с понедельника работаем до 20:00. Записаться можно прямо здесь, в боте."
                : "Например: машина готова, можно забирать."} />
          </Field>

          <p className="text-xs text-slate-500">
            Рассылка уходит людям, которые оставляли заявку. Частые сообщения без повода приводят к блокировке бота.
          </p>

          {err && <p className="text-sm font-medium text-rose-600">{err}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <Btn onClick={onClose}>Отмена</Btn>
            <Btn kind="primary" onClick={send}
              className={state === "sending" || !recipients.length ? "opacity-60" : ""}>
              <Send size={15} />
              {state === "sending" ? "Ставлю в очередь…" : all ? `Отправить (${recipients.length})` : "Отправить"}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Один человек в двух карточках                                      */
/* ------------------------------------------------------------------ */

function DuplicateHint({ ctx }) {
  const { data, api, reload } = ctx;
  const [busy, setBusy] = useState(null);
  const [hidden, setHidden] = useState([]);

  const groups = (data.duplicates || []).filter((g) => !hidden.includes(g.ids.join("-")));
  if (groups.length === 0) return null;

  const merge = async (g) => {
    const ranked = g.ids
      .map((id) => ({ id, n: data.orders.filter((o) => o.clientId === id).length }))
      .sort((a, b) => b.n - a.n || a.id - b.id);
    setBusy(g.ids.join("-"));
    try {
      await api.mergeClients({ keepId: ranked[0].id, dropId: ranked[1].id });
      await reload();
    } catch (e) {
      setHidden((h) => [...h, g.ids.join("-")]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const key = g.ids.join("-");
        return (
          <div key={key} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="min-w-0 flex-1 text-sm text-amber-900">
              Один телефон <span className="font-mono">{g.phone}</span> в двух карточках: <b>{g.names.join(" и ")}</b>.
              <div className="text-xs text-amber-800">
                При объединении заказы, машины и Telegram переедут в карточку с историей.
              </div>
            </div>
            <Btn onClick={() => merge(g)} className={busy === key ? "opacity-60" : ""}>
              <Users size={15} />{busy === key ? "Объединяю…" : "Объединить"}
            </Btn>
            <Btn kind="quiet" onClick={() => setHidden((h) => [...h, key])}>Это разные</Btn>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Склад: материалы, закупки, расход                                  */
/*  Остаток меняется только движением — каждый расход объясним.        */
/* ------------------------------------------------------------------ */

const STOCK_CATEGORIES = ["Химия", "Расходники", "Абразивы", "Защитные составы", "Инструмент", "Прочее"];
const STOCK_UNITS = ["шт", "л", "мл", "кг", "г", "м", "упак"];

function StockView(ctx) {
  const { data, money, api, reload } = ctx;
  const [tab, setTab] = useState("stock");        // stock | buy | log
  const [itemModal, setItemModal] = useState(null);
  const [moveModal, setMoveModal] = useState(null);
  const [q, setQ] = useState("");
  const [openCat, setOpenCat] = useState(null);   // раскрытая категория
  const [catEdit, setCatEdit] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [catNote, setCatNote] = useState("");

  const items = data.stockItems || [];
  const low = items.filter((i) => i.active && i.minQty > 0 && i.qty <= i.minQty);
  const stockValue = items.reduce((s, i) => s + (i.qty || 0) * (i.price || 0), 0);
  const spent30 = items.reduce((s, i) => s + (i.spent30 || 0) * (i.price || 0), 0);

  const shown = items.filter((i) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return ((i.name || "") + (i.category || "")).toLowerCase().includes(s);
  });

  // Категории приходят из настроек, плюс те, что уже стоят у позиций:
  // так ничего не потеряется, даже если категорию убрали из списка.
  const cats = [...new Set([
    ...(data.stockCategories || []),
    ...items.map((i) => i.category || "Прочее"),
  ])];

  const byCat = {};
  const byCatAll = {};
  cats.forEach((c) => { byCat[c] = []; byCatAll[c] = []; });
  shown.forEach((i) => (byCat[i.category || "Прочее"] ||= []).push(i));
  items.forEach((i) => (byCatAll[i.category || "Прочее"] ||= []).push(i));

  const catSum = (c) => (byCat[c] || []).reduce((s, i) => s + (i.qty || 0) * (i.price || 0), 0);

  const saveCats = async (list) => {
    setCatNote("");
    try {
      await api.saveStockCategories(list);
      await reload();
    } catch (e) {
      setCatNote("Не удалось сохранить: " + e.message);
    }
  };

  const addCat = () => {
    const name = newCat.trim();
    if (!name || cats.includes(name)) { setNewCat(""); return; }
    saveCats([...(data.stockCategories || cats), name]);
    setNewCat("");
  };

  const removeCat = (c, used) => {
    if (used > 0) {
      setCatNote(`В «${c}» ${used} позиц. — сначала перенесите их в другую категорию.`);
      return;
    }
    saveCats((data.stockCategories || cats).filter((x) => x !== c));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Склад</h1>
        <div className="flex gap-2">
          <Btn onClick={() => setItemModal({})}><Plus size={15} />Позиция</Btn>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Позиций" value={items.length} />
        <Stat label="Склад на сумму" value={money(stockValue)} />
        <Stat label="Израсходовано за 30 дней" value={money(spent30)} />
        <Stat label="Пора купить" value={low.length}
          sub={low.length ? "ниже точки заказа" : "всё в норме"} />
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-white p-1">
        {[["stock", "Остатки"], ["buy", `Закупить${low.length ? " · " + low.length : ""}`],
          ["boxes", "Боксы"], ["log", "Движения"]]
          .map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === id ? "bg-blue-800 text-white" : "text-slate-600"}`}>
              {label}
            </button>
          ))}
      </div>

      {tab === "stock" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по названию или категории"
              className={`${inputBase} min-w-0 flex-1`} />
            {openCat && (
              <Btn onClick={() => setOpenCat(null)}>← Все категории</Btn>
            )}
          </div>

          {/* Кнопки категорий: быстрый переход, не листая страницу */}
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setOpenCat(null)}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                !openCat ? "border-blue-700 bg-blue-50 text-blue-900"
                         : "chip-pick"}`}>
              Все · {shown.length}
            </button>
            {cats.map((c) => {
              const list = byCat[c] || [];
              const lowN = list.filter((i) => i.minQty > 0 && i.qty <= i.minQty).length;
              return (
                <button key={c} onClick={() => setOpenCat(c)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    openCat === c ? "border-blue-700 bg-blue-50 text-blue-900" : "chip-pick"}`}>
                  {c} · {list.length}
                  {lowN > 0 && <span className="ml-1 text-amber-600">▲{lowN}</span>}
                </button>
              );
            })}
            <button onClick={() => setCatEdit(!catEdit)}
              className="rounded-full border border-dashed px-2.5 py-1 text-xs chip-pick">
              {catEdit ? "готово" : "+ категория"}
            </button>
          </div>

          {catEdit && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex gap-2">
                <input value={newCat} onChange={(e) => setNewCat(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCat()}
                  placeholder="Например: полироли" className={inputCls} />
                <Btn onClick={addCat}><Plus size={15} />Добавить</Btn>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cats.map((c) => {
                  const used = (byCatAll[c] || []).length;
                  return (
                    <span key={c}
                      className="flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-xs">
                      {c} <span className="text-slate-400">{used}</span>
                      <button onClick={() => removeCat(c, used)}
                        className="text-slate-400 hover:text-rose-600"><X size={12} /></button>
                    </span>
                  );
                })}
              </div>
              {catNote && <p className="text-xs text-amber-700">{catNote}</p>}
            </div>
          )}

          {items.length === 0 ? (
            <Empty text="Склад пуст. Заведите первую позицию — например, шампунь или полироль."
              action={<Btn kind="primary" onClick={() => setItemModal({})}><Plus size={15} />Позиция</Btn>} />
          ) : openCat ? (
            /* Раскрытая категория: подробный список на всю ширину */
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">{openCat}</h2>
                <span className="text-xs text-slate-500">
                  {(byCat[openCat] || []).length} позиц. на {money(catSum(openCat))}
                </span>
              </div>
              {(byCat[openCat] || []).map((i) => <StockRow key={i.id} ctx={ctx} item={i}
                onMove={setMoveModal} onEdit={setItemModal} />)}
              {(byCat[openCat] || []).length === 0 && (
                <p className="px-4 py-3 text-sm text-slate-400">В этой категории пока пусто.</p>
              )}
            </div>
          ) : (
            /* Плитка категорий: несколько в ряд, клик раскрывает целиком */
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {cats.filter((c) => (byCat[c] || []).length).map((c) => {
                const list = byCat[c];
                const lowList = list.filter((i) => i.minQty > 0 && i.qty <= i.minQty);
                return (
                  <div key={c} onClick={() => setOpenCat(c)} role="button" tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && setOpenCat(c)}
                    className="row-hover cursor-pointer rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">{c}</h2>
                      <span className="font-mono text-sm font-bold">{money(catSum(c))}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {list.length} позиц.
                      {lowList.length > 0 && (
                        <span className="text-amber-600"> · {lowList.length} заканчивается</span>
                      )}
                    </div>

                    <div className="mt-2 space-y-1">
                      {list.slice(0, 4).map((i) => {
                        const isLow = i.minQty > 0 && i.qty <= i.minQty;
                        return (
                          <div key={i.id} className="flex items-baseline justify-between gap-2 text-sm">
                            <span className="min-w-0 truncate">{i.name}</span>
                            <span className={`shrink-0 font-mono text-xs ${isLow ? "text-amber-700" : "text-slate-500"}`}>
                              {i.qty} {i.unit}
                            </span>
                          </div>
                        );
                      })}
                      {list.length > 4 && (
                        <div className="text-xs text-slate-400">и ещё {list.length - 4}…</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "buy" && <BuyList ctx={ctx} low={low} onMove={(m) => setMoveModal(m)} />}
      {tab === "boxes" && <BoxStock ctx={ctx} onMove={(m) => setMoveModal(m)} />}
      {tab === "log" && <StockLog ctx={ctx} />}

      {itemModal && (
        <StockItemModal ctx={ctx} item={itemModal.id ? itemModal : null}
          onClose={() => setItemModal(null)} />
      )}
      {moveModal && (
        <StockMoveModal ctx={ctx} item={moveModal.item} kind={moveModal.kind}
          preset={moveModal} onClose={() => setMoveModal(null)} />
      )}
    </div>
  );
}

/* ── Список закупки ────────────────────────────────────────── */

function BuyList({ ctx, low, onMove }) {
  const { data, money } = ctx;
  const suppliers = data.suppliers || [];

  if (low.length === 0) {
    return <Empty text="Всё в наличии. Позиции появятся здесь, когда остаток опустится до точки заказа." />;
  }

  // сколько взять: до двойного минимума — запас на смену вперёд
  const need = (i) => Math.max(i.minQty * 2 - i.qty, i.minQty || 1);
  const total = low.reduce((s, i) => s + need(i) * (i.price || 0), 0);

  const bySupplier = {};
  low.forEach((i) => {
    const key = i.supplierId || "—";
    (bySupplier[key] = bySupplier[key] || []).push(i);
  });

  const copyList = () => {
    const lines = low.map((i) => `${i.name} — ${need(i)} ${i.unit}`).join("\n");
    navigator.clipboard?.writeText(lines);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="text-sm text-amber-900">
          К закупке <b>{low.length}</b> позиц. примерно на <b>{money(total)}</b>
        </div>
        <Btn onClick={copyList}><Download size={15} />Скопировать список</Btn>
      </div>

      {Object.entries(bySupplier).map(([sid, list]) => {
        const sup = suppliers.find((s) => s.id === sid);
        return (
          <div key={sid} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
              <ShoppingCart size={15} className="text-slate-500" />
              <h2 className="text-sm font-bold">{sup ? sup.name : "Поставщик не указан"}</h2>
              {sup?.phone && <span className="font-mono text-xs text-slate-500">{sup.phone}</span>}
              {sup?.link && (
                <a href={sup.link} target="_blank" rel="noreferrer"
                  className="text-xs text-blue-700 hover:underline">сайт</a>
              )}
            </div>
            {list.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{i.name}</div>
                  <div className="text-xs text-slate-500">
                    осталось {i.qty} {i.unit} при минимуме {i.minQty}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-bold">{need(i)} {i.unit}</div>
                  {i.price > 0 && (
                    <div className="text-xs text-slate-500">≈ {money(need(i) * i.price)}</div>
                  )}
                </div>
                <Btn onClick={() => onMove({ item: i, kind: "in" })}>
                  <TrendingUp size={15} />Оприходовать
                </Btn>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ── Журнал движений ───────────────────────────────────────── */

function StockLog({ ctx }) {
  const { api, money } = ctx;
  const [rows, setRows] = useState(null);

  const [limit, setLimit] = useState(80);

  useEffect(() => {
    api.stockMoves("?limit=" + limit).then(setRows).catch(() => setRows([]));
  }, [limit]);

  if (rows === null) return <p className="text-sm text-slate-400">Загружаю журнал…</p>;
  if (rows.length === 0) return <Empty text="Движений пока не было." />;

  const KIND = {
    in: { label: "приход", cls: "bg-emerald-100 text-emerald-800", sign: "+" },
    out: { label: "списание", cls: "bg-rose-100 text-rose-700", sign: "−" },
    adjust: { label: "пересчёт", cls: "bg-slate-100 text-slate-600", sign: "=" },
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {rows.map((m) => {
        const k = KIND[m.kind] || KIND.adjust;
        return (
          <div key={m.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0">
            <span className="w-24 shrink-0 font-mono text-xs text-slate-500">
              {(m.created_at || "").slice(0, 16).replace("T", " ")}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${k.cls}`}>{k.label}</span>
            <span className="min-w-0 flex-1 truncate text-sm">
              {m.itemName}
              {m.orderN ? <span className="text-slate-500"> · заказ №{m.orderN}</span> : null}
              {m.staffName ? <span className="text-slate-500"> · {m.staffName}</span> : null}
              {m.note ? <span className="text-slate-400"> · {m.note}</span> : null}
            </span>
            <span className="font-mono text-sm font-bold">
              {k.sign}{m.qty} {m.unit}
            </span>
            {m.price ? <span className="font-mono text-xs text-slate-500">{money(m.price * m.qty)}</span> : null}
          </div>
        );
      })}

      {rows.length >= limit && (
        <button onClick={() => setLimit(limit + 120)}
          className="w-full border-t border-slate-100 px-4 py-2.5 text-sm text-blue-800 row-hover">
          Показаны последние {rows.length} — загрузить ещё
        </button>
      )}
    </div>
  );
}

/* ── Карточка позиции ──────────────────────────────────────── */

function StockItemModal({ ctx, item, onClose }) {
  const { data, api, reload } = ctx;
  const [f, setF] = useState(item || {
    name: "", category: (data.stockCategories || STOCK_CATEGORIES)[0], unit: "шт",
    qty: 0, minQty: 0, price: 0, supplierId: "", note: "", active: true,
  });
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!(f.name || "").trim()) { setErr("Без названия позицию не найти."); return; }
    await api.saveStockItem({ ...f, name: f.name.trim() });
    await reload();
    onClose();
  };

  const remove = async () => {
    if (!confirmDel) { setConfirmDel(true); return; }
    await api.deleteStockItem(f.id);
    await reload();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={item ? "Позиция склада" : "Новая позиция"}>
      <div className="space-y-4">
        <Field label="Название">
          <input value={f.name} onChange={(e) => set("name", e.target.value)} className={inputCls}
            placeholder="Например: шампунь для бесконтактной мойки" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Категория">
            <select value={f.category || ""} onChange={(e) => set("category", e.target.value)} className={inputCls}>
              {[...new Set([...(data.stockCategories || STOCK_CATEGORIES),
                            ...(f.category ? [f.category] : [])])]
                .map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Единица">
            <select value={f.unit} onChange={(e) => set("unit", e.target.value)} className={inputCls}>
              {STOCK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
          <Field label="Цена за единицу">
            <input type="number" value={f.price} onChange={(e) => set("price", num(e.target.value))}
              className={`${inputCls} font-mono`} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={item ? "Остаток (меняется движениями)" : "Начальный остаток"}>
            <input type="number" value={f.qty} disabled={!!item}
              onChange={(e) => set("qty", num(e.target.value))}
              className={`${inputCls} font-mono ${item ? "opacity-60" : ""}`} />
          </Field>
          <Field label="Точка заказа">
            <input type="number" value={f.minQty} onChange={(e) => set("minQty", num(e.target.value))}
              className={`${inputCls} font-mono`} />
            <span className="mt-1 block text-xs text-slate-500">
              Опустится до этого значения — позиция попадёт в «Закупить».
            </span>
          </Field>
        </div>

        <Field label="Поставщик">
          <select value={f.supplierId || ""} onChange={(e) => set("supplierId", e.target.value)} className={inputCls}>
            <option value="">не указан</option>
            {(data.suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>

        <Field label="Заметка">
          <input value={f.note || ""} onChange={(e) => set("note", e.target.value)} className={inputCls}
            placeholder="Разведение, артикул, что угодно" />
        </Field>

        {err && <p className="text-sm font-medium text-rose-600">{err}</p>}

        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
          {item && (
            <Btn kind="danger" onClick={remove}>
              <Trash2 size={15} />{confirmDel ? "Удалить вместе с историей" : "Удалить"}
            </Btn>
          )}
          <div className="ml-auto flex gap-2">
            <Btn onClick={onClose}>Отмена</Btn>
            <Btn kind="primary" onClick={save}>Сохранить</Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ── Приход и списание ─────────────────────────────────────── */

function StockMoveModal({ ctx, item, kind: initialKind, preset, onClose }) {
  const { data, api, reload, money } = ctx;
  const [kind, setKind] = useState(initialKind || "out");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState(item.price || "");
  const [orderId, setOrderId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [note, setNote] = useState("");
  const [box, setBox] = useState(preset?.box || "");
  const [err, setErr] = useState("");

  // списываем обычно на сегодняшнюю машину — показываем свежие заказы
  const recent = (data.orders || []).slice(0, 20);
  const boxes = data.boxes || [];

  const submit = async () => {
    const n = num(qty);
    if (!n && kind !== "adjust") { setErr("Укажите количество."); return; }
    if (kind === "out" && n > item.qty) {
      setErr(`На складе только ${item.qty} ${item.unit}. Сначала оприходуйте приход.`);
      return;
    }
    try {
      await api.stockMove({
        itemId: item.id, kind, qty: n,
        price: kind === "in" ? num(price) : null,
        orderId: kind === "out" && orderId ? Number(orderId) : null,
        staffId: staffId || null, note: note.trim() || null,
        box: kind === "adjust" ? null : (box || null),
      });
      await reload();
      onClose();
    } catch (e) {
      setErr("Не удалось записать движение.");
    }
  };

  const TABS = [["in", "Приход"], ["out", "Списание"], ["adjust", "Пересчёт"]];

  return (
    <Modal open onClose={onClose} title={item.name}>
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          Сейчас на складе: <b className="font-mono">{item.qty} {item.unit}</b>
          {item.minQty > 0 && <span className="text-slate-500"> · минимум {item.minQty}</span>}
        </div>

        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => { setKind(id); setErr(""); }}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${
                kind === id ? "bg-white shadow-sm" : "text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={kind === "adjust" ? `Фактически на складе, ${item.unit}` : `Сколько, ${item.unit}`}>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus
              className={`${inputCls} font-mono`} placeholder="0" />
          </Field>
          {kind === "in" && (
            <Field label="Цена за единицу">
              <input type="number" value={price} onChange={(e) => setPrice(e.target.value)}
                className={`${inputCls} font-mono`} />
              <span className="mt-1 block text-xs text-slate-500">Обновит цену позиции.</span>
            </Field>
          )}
          {kind === "out" && (
            <Field label="На заказ">
              <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className={inputCls}>
                <option value="">без привязки</option>
                {recent.map((o) => (
                  <option key={o.id} value={o.id}>
                    №{o.n} · {(o.date || "").slice(0, 10)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        {kind !== "adjust" && (
          <Field label={kind === "in" ? "В какой бокс" : "Из какого бокса"}>
            <select value={box} onChange={(e) => setBox(e.target.value)} className={inputCls}>
              <option value="">общий склад</option>
              {boxes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              По боксам считается расход химии и остаток на посту.
            </span>
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Кто">
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={inputCls}>
              <option value="">не указан</option>
              {(data.staff || []).filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Комментарий">
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls}
              placeholder="Необязательно" />
          </Field>
        </div>

        {kind === "in" && num(qty) > 0 && num(price) > 0 && (
          <p className="text-sm text-slate-600">
            Сумма прихода: <b className="font-mono">{money(num(qty) * num(price))}</b>
          </p>
        )}
        {err && <p className="text-sm font-medium text-rose-600">{err}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" onClick={submit}>Записать</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ── Поставщики (в настройках) ─────────────────────────────── */

function SuppliersEditor({ data, api, reload }) {
  const [form, setForm] = useState(null);
  const list = data.suppliers || [];

  const save = async () => {
    if (!(form.name || "").trim()) return;
    await api.saveSupplier(form);
    await reload();
    setForm(null);
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold">Поставщики</h3>
      <p className="text-sm text-slate-500">
        Привязываются к позициям склада: в разделе «Закупить» список сам разложится по поставщикам.
      </p>

      <div className="space-y-2">
        {list.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
            <span className="font-medium">{s.name}</span>
            {s.phone && <span className="font-mono text-xs text-slate-500">{s.phone}</span>}
            {s.contact && <span className="text-xs text-slate-500">{s.contact}</span>}
            <div className="ml-auto flex gap-1">
              <button onClick={() => setForm(s)}
                className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900">
                <Pencil size={15} />
              </button>
              <button onClick={async () => { await api.deleteSupplier(s.id); await reload(); }}
                className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
        {list.length === 0 && <p className="text-sm text-slate-400">Пока никого.</p>}
      </div>

      {form ? (
        <div className="space-y-2 rounded-lg border border-slate-300 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Название" className={inputCls} />
            <input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="Телефон" className={inputCls} />
            <input value={form.contact || ""} onChange={(e) => setForm({ ...form, contact: e.target.value })}
              placeholder="Контактное лицо" className={inputCls} />
            <input value={form.link || ""} onChange={(e) => setForm({ ...form, link: e.target.value })}
              placeholder="Сайт или чат" className={inputCls} />
          </div>
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setForm(null)}>Отмена</Btn>
            <Btn kind="primary" onClick={save}>Сохранить</Btn>
          </div>
        </div>
      ) : (
        <Btn onClick={() => setForm({ name: "" })}><Plus size={15} />Добавить поставщика</Btn>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Топ клиентов: сколько принёс и за какой срок                       */
/* ------------------------------------------------------------------ */

// «за 3 нед» / «за 8 мес» / «за 1 г 2 мес» — короткая подпись стажа
function ageLabel(days) {
  if (days < 14) return `${Math.max(1, Math.round(days))} дн`;
  if (days < 61) return `${Math.round(days / 7)} нед`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} мес`;
  const y = Math.floor(months / 12), m = months % 12;
  return m ? `${y} г ${m} мес` : `${y} г`;
}

function TopClientsPanel({ ctx, rows, total, allSpent = 0 }) {
  const { money, setClientCard } = ctx;
  const [sort, setSort] = useState("spent");   // spent | perMonth | visits

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-bold">Топ клиентов</h3>
        <p className="text-sm text-slate-400">Пока нет закрытых заказов.</p>
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) =>
    sort === "visits" ? b.visits - a.visits
    : sort === "perMonth" ? b.perMonth - a.perMonth
    : b.spent - a.spent);
  const max = Math.max(1, ...sorted.map((r) =>
    sort === "visits" ? r.visits : sort === "perMonth" ? r.perMonth : r.spent));

  const TABS = [["spent", "По сумме"], ["perMonth", "В месяц"], ["visits", "По визитам"]];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold">
          Топ клиентов <span className="font-normal text-slate-400">за всё время · всего {total}</span>
        </h3>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setSort(id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                sort === id ? "bg-white shadow-sm" : "text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-96 space-y-2 scroll-slim overflow-y-auto pr-1">
        {sorted.map((r, idx) => {
          const val = sort === "visits" ? r.visits : sort === "perMonth" ? r.perMonth : r.spent;
          return (
            <div key={r.id} onClick={() => setClientCard(Number(r.id))} role="button" tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setClientCard(Number(r.id))}
              className="cursor-pointer rounded-lg px-2 py-1.5 transition row-hover">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  <span className="mr-2 font-mono text-xs text-slate-400">{idx + 1}</span>
                  {r.name}
                </span>
                <span className="font-mono font-semibold">
                  {sort === "visits" ? `${r.visits} визит(ов)` : money(val)}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full bg-blue-800"
                  style={{ width: Math.min(100, (val / max) * 100) + "%" }} />
              </div>
              <div className="mt-0.5 flex justify-between text-xs text-slate-500">
                <span>с {humanDate(r.start)} · {ageLabel(r.days)} с нами</span>
                <span>
                  {r.visits} визит(ов) · {money(r.perMonth)}/мес
                </span>
              </div>
            </div>
          );
        })}

      </div>

      <div className="mt-2 flex justify-between border-t border-slate-200 px-2 pt-2 text-sm font-semibold">
        <span>Всего за историю · {total} клиент(ов)</span>
        <span className="font-mono">{money(allSpent)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Скидки: сколько отдали и кому                                      */
/*  Свой фильтр периода — скидки смотрят реже, чем выручку.            */
/* ------------------------------------------------------------------ */

function DiscountPanel({ ctx, days }) {
  const { data, money, orderTotal, staffById, clientById } = ctx;

  const from = days === 0 ? "0000-00-00" : toLocal(shiftDays(-(days - 1))).slice(0, 10);
  // Только выданные машины: пока заказ не закрыт, скидка ещё может
  // измениться, и в отчёт такие суммы попадать не должны.
  const list = data.orders.filter((o) => o.status === "issued" && dayKey(o.date) >= from);

  const gross = (o) => o.items.reduce((s, i) => s + num(i.price) * num(i.qty || 1), 0);
  const discounted = list.filter((o) => num(o.discount) > 0 && gross(o) > 0);

  const grossAll = list.reduce((s, o) => s + gross(o), 0);
  const netAll = list.reduce((s, o) => s + orderTotal(o), 0);
  const lost = grossAll - netAll;
  const avgPct = discounted.length
    ? discounted.reduce((s, o) => s + num(o.discount), 0) / discounted.length : 0;
  const share = list.length ? Math.round((discounted.length / list.length) * 100) : 0;

  // кому уходят скидки
  const byClient = {};
  discounted.forEach((o) => {
    const k = o.clientId;
    const a = byClient[k] || (byClient[k] = { lost: 0, count: 0, maxPct: 0 });
    a.lost += gross(o) - orderTotal(o);
    a.count += 1;
    a.maxPct = Math.max(a.maxPct, num(o.discount));
  });
  const topClients = Object.entries(byClient).sort((a, b) => b[1].lost - a[1].lost);

  // кто их даёт
  const byStaff = {};
  discounted.forEach((o) => {
    const ids = orderStaffIds(o);
    const keys = ids.length ? ids : ["—"];
    const part = 1 / keys.length;
    keys.forEach((k) => {
      const a = byStaff[k] || (byStaff[k] = { lost: 0, count: 0 });
      a.lost += (gross(o) - orderTotal(o)) * part;
      a.count += 1;
    });
  });
  const staffRows = Object.entries(byStaff).sort((a, b) => b[1].lost - a[1].lost);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-bold">Скидки</h3>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Выручка до скидок" value={money(grossAll)} />
        <Stat label="Заказов со скидкой" value={discounted.length}
          sub={`${share}% от выданных`} />
        <Stat label="Средняя скидка" value={avgPct ? avgPct.toFixed(1) + "%" : "—"} />
        <Stat label="Отдали скидками" value={money(lost)} />
      </div>

      {discounted.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">За этот период скидок не давали.</p>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Кому уходят скидки
            </h4>
            <div className="max-h-64 space-y-1.5 scroll-slim overflow-y-auto pr-1">
              {topClients.map(([id, v]) => (
                <div key={id} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    {clientById[id]?.name || "Клиент удалён"}
                    <span className="ml-1 text-xs text-slate-400">
                      {v.count} заказ(ов), до {v.maxPct}%
                    </span>
                  </span>
                  <span className="font-mono font-semibold text-rose-600">−{money(v.lost)}</span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between border-t border-slate-200 pt-1.5 text-sm font-semibold">
              <span>Итого · {topClients.length} клиент(ов)</span>
              <span className="font-mono text-rose-600">−{money(lost)}</span>
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Кто их даёт
            </h4>
            <div className="max-h-64 space-y-1.5 scroll-slim overflow-y-auto pr-1">
              {staffRows.map(([id, v]) => (
                <div key={id} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    {staffById[id]?.name || "Без мастера"}
                    <span className="ml-1 text-xs text-slate-400">{v.count} заказ(ов)</span>
                  </span>
                  <span className="font-mono font-semibold text-rose-600">−{money(v.lost)}</span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between border-t border-slate-200 pt-1.5 text-sm font-semibold">
              <span>Итого · {staffRows.length} мастер(ов)</span>
              <span className="font-mono text-rose-600">−{money(lost)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Карточка сотрудника: чем занимался и что заработал                 */
/* ------------------------------------------------------------------ */

function StaffCard({ ctx, id, onClose }) {
  const { data, money, orderTotal, clientById, carById, setOrderModal, setStaffModal,
          payrollRate } = ctx;
  const [days, setDays] = useState(30);

  const m = (data.staff || []).find((s) => s.id === id);
  if (!m) return null;

  const from = days === 0 ? "0000-00-00" : toLocal(shiftDays(-(days - 1))).slice(0, 10);
  const mine = (data.orders || [])
    .filter((o) => orderStaffIds(o).includes(id)
      && o.status !== "canceled" && o.status !== "cancelled")
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const period = mine.filter((o) => dayKey(o.date) >= from);

  // выработка считается по закрытым: «в работе» ещё не деньги
  // Эффективность — только по выданным машинам: работа считается
  // сделанной, когда клиент забрал автомобиль.
  const closed = period.filter((o) => o.status === "issued");
  const isOwner = (sid) => !!(data.staff || []).find((s) => s.id === sid)?.isOwner;

  // Считаем по услугам: берём позиции, где исполнителем стоит этот мастер.
  // Для старых заказов без исполнителей — прежнее деление поровну.
  // Заработок мастера в заказе: наёмному — доля фонда, собственнику —
  // остаток заказа после расчёта с наёмными.
  const mineIn = (o) => {
    const r = orderEarnings(o, orderTotal, isOwner, payrollRate);
    const services = Object.entries(r.services[id] || {}).map(([name, v]) => {
      const k = r.value[id] > 0 ? r.earned[id] / r.value[id] : 0;
      return { name, money: v * k, assigned: true };
    });
    return { money: r.earned[id] || 0, hours: r.hours[id] || 0, services };
  };

  const sum = closed.reduce((s, o) => s + mineIn(o).money, 0);
  const hours = closed.reduce((s, o) => s + mineIn(o).hours, 0);

  // сколько принёс по каждой услуге
  const byService = {};
  closed.forEach((o) => mineIn(o).services.forEach((x) => {
    const a = byService[x.name] || (byService[x.name] = { money: 0, count: 0 });
    a.money += x.money; a.count += 1;
  }));
  const serviceRows = Object.entries(byService).sort((a, b) => b[1].money - a[1].money);
  const avg = closed.length ? sum / closed.length : 0;

  const PERIODS = [[1, "Сегодня"], [7, "7 дней"], [30, "30 дней"], [90, "90 дней"], [0, "Всё время"]];

  return (
    <Modal open onClose={onClose} title={m.name} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-600">{m.role || "должность не указана"}</span>
          {m.phone && (
            <a href={`tel:${m.phone}`} className="inline-flex items-center gap-1.5 font-mono text-sm text-blue-800 hover:underline">
              <Phone size={14} />{m.phone}
            </a>
          )}
          {m.telegram && (
            <a href={`https://t.me/${m.telegram}`} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline">
              <Send size={13} />@{m.telegram}
            </a>
          )}
          {m.hiredAt && <span className="text-xs text-slate-500">в студии с {humanDate(m.hiredAt)}</span>}
          {!m.active && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">архив</span>
          )}
        </div>

        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {PERIODS.map(([d, label]) => (
            <button key={d} onClick={() => setDays(d)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                days === d ? "bg-white shadow-sm" : "text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Заработал" value={money(sum)}
            sub={m.isOwner
              ? "полная стоимость своих работ"
              : `${Math.round(payrollRate * 100)}% от своих работ`} />
          <Stat label="Закрыто заказов" value={closed.length}
            sub={period.length > closed.length ? `${period.length - closed.length} в работе` : null} />
          <Stat label="Часов" value={hours ? hours.toFixed(1) : "—"} />
          <Stat label="В час" value={hours ? money(sum / hours) : "—"}
            sub={hours ? "заработок за час" : "часы не внесены"} />
        </div>

        {serviceRows.length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Что принесло деньги
            </h4>
            <div className="max-h-48 scroll-slim space-y-1.5 overflow-y-auto pr-1">
              {serviceRows.map(([name, v]) => (
                <div key={name}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      {name} <span className="text-xs text-slate-400">×{v.count}</span>
                    </span>
                    <span className="font-mono font-semibold">{money(v.money)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full bg-cyan-500"
                      style={{ width: Math.min(100, (v.money / Math.max(1, serviceRows[0][1].money)) * 100) + "%" }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-sm font-semibold">
              <span>Итого · {serviceRows.length} услуг(и)</span>
              <span className="font-mono">{money(sum)}</span>
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              История работ
            </h4>
            <span className="text-xs text-slate-400">
              {period.length ? `${period.length} за период · всего ${mine.length}` : `всего ${mine.length}`}
            </span>
          </div>

          {period.length === 0 ? (
            <Empty text="За этот период заказов нет. Возьмите период шире." />
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              {period.slice(0, 40).map((o) => {
                const c = clientById[o.clientId];
                const car = carById[o.carId];
                return (
                  <button key={o.id} onClick={() => { onClose(); setOrderModal(o); }}
                    className="flex w-full flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-left last:border-0 row-hover">
                    <span className="w-20 shrink-0 font-mono text-xs text-slate-500">
                      {humanDate(o.date)}
                    </span>
                    <span className="font-mono text-xs text-slate-400">№{o.n}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {c ? c.name : "—"}
                      {car?.plate ? <span className="ml-1 text-slate-400">· {car.plate}</span> : null}
                      <span className="block truncate text-xs text-slate-500">
                        {o.items.map((i) => i.name).join(", ") || "услуги не указаны"}
                      </span>
                    </span>
                    <StatusChip id={o.status} />
                    {orderStaffIds(o).length > 1 && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                        title={orderStaffIds(o).map((sid) => ctx.staffById[sid]?.name)
                          .filter(Boolean).join(", ")}>
                        в паре
                      </span>
                    )}
                    {num(o.hoursSpent) > 0 && (
                      <span className="font-mono text-xs text-slate-500">{num(o.hoursSpent)} ч</span>
                    )}
                    <span className="font-mono text-sm font-semibold">
                      {money(mineIn(o).money)}
                    </span>
                  </button>
                );
              })}

              {period.length > 40 && (
                <div className="flex justify-between border-t border-slate-100 px-3 py-2 text-sm text-slate-500">
                  <span>Ещё {period.length - 40} заказ(ов)</span>
                  <span className="font-mono">
                    {money(period.slice(40).reduce((s, o) => s + mineIn(o).money, 0))}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
          <Btn onClick={() => { onClose(); setStaffModal(m); }}>
            <Pencil size={15} />Изменить карточку
          </Btn>
          <Btn className="ml-auto" onClick={onClose}>Закрыть</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Отделы: мойщики, полировщики, детейлеры                            */
/*  Услуга привязана к отделу — по нему подставляются исполнители.     */
/* ------------------------------------------------------------------ */

function DepartmentsEditor({ data, api, reload }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const list = data.departments || [];
  const staff = (data.staff || []).filter((s) => s.active);

  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setNote("");
    try {
      await api.saveDepartment({ name: name.trim() });
      await reload();
      setName("");
    } finally { setBusy(false); }
  };

  const rename = async (d, value) => {
    await api.saveDepartment({ id: d.id, name: value });
    await reload();
  };

  const toggleStaff = async (d, sid) => {
    const next = d.staffIds.includes(sid)
      ? d.staffIds.filter((x) => x !== sid)
      : [...d.staffIds, sid];
    await api.saveDepartment({ id: d.id, name: d.name, staffIds: next });
    await reload();
  };

  const remove = async (d) => {
    setNote("");
    try {
      await api.deleteDepartment(d.id);
      await reload();
    } catch (e) {
      setNote(`Отдел «${d.name}» не удалён: к нему привязаны услуги. Переназначьте их в прайсе.`);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold">Отделы</h3>
      <p className="text-sm text-slate-500">
        Мойщики, полировщики, детейлеры. Услуга привязывается к отделу в прайсе, и при
        закрытии заказа CRM предлагает исполнителей именно из него.
      </p>

      {note && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}

      <div className="space-y-3">
        {list.map((d) => {
          const services = (data.services || []).filter((s) => s.departmentId === d.id);
          return (
            <div key={d.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-2">
                <input value={d.name} onChange={(e) => rename(d, e.target.value)}
                  className={`${inputCls} font-medium`} />
                <button onClick={() => remove(d)}
                  className="rounded p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                  <Trash2 size={15} />
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {staff.length === 0 && <span className="text-xs text-slate-400">сотрудников нет</span>}
                {staff.map((s) => {
                  const on = d.staffIds.includes(s.id);
                  return (
                    <button key={s.id} onClick={() => toggleStaff(d, s.id)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition ${
                        on ? "border-blue-700 bg-blue-50 text-blue-900"
                           : "border-slate-200 text-slate-500 hover:border-slate-400"}`}>
                      {on ? "✓ " : ""}{s.name}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 text-xs text-slate-500">
                {services.length
                  ? `Услуг в отделе: ${services.length}`
                  : "Услуги пока не привязаны — сделайте это в разделе «Услуги»."}
              </div>
            </div>
          );
        })}
        {list.length === 0 && <p className="text-sm text-slate-400">Отделов пока нет.</p>}
      </div>

      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Например: полировщики" className={inputCls} />
        <Btn onClick={add} className={busy ? "opacity-60" : ""}>
          <Plus size={15} />Добавить
        </Btn>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Загруженность: часы по мастерам и отделам                          */
/*  Плюс заказы, где исполнители не проставлены — их надо закрыть.     */
/* ------------------------------------------------------------------ */

function WorkloadPanel({ ctx, byStaff, list }) {
  const { data, money, staffById, setOrderModal } = ctx;
  const [tab, setTab] = useState("staff");

  const rows = Object.entries(byStaff)
    .map(([id, v]) => ({ id, name: staffById[id]?.name || "Без мастера", ...v }))
    .sort((a, b) => b.hours - a.hours || b.sum - a.sum);
  const totalHours = rows.reduce((s, r) => s + r.hours, 0);

  // по отделам: часы мастера делим между его отделами, если он в нескольких
  const byDep = {};
  rows.forEach((r) => {
    const deps = (data.staff || []).find((s) => s.id === r.id)?.departmentIds || [];
    const keys = deps.length ? deps : ["—"];
    keys.forEach((d) => {
      const a = byDep[d] || (byDep[d] = { hours: 0, sum: 0 });
      a.hours += r.hours / keys.length;
      a.sum += r.sum / keys.length;
    });
  });
  const depRows = Object.entries(byDep).sort((a, b) => b[1].hours - a[1].hours);
  const depName = (id) => (data.departments || []).find((d) => d.id === id)?.name || "Без отдела";

  // услуги, у которых не указан исполнитель
  const unassigned = list.filter((o) => o.items.some((i) => itemStaffIds(i).length === 0));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold">
          Загруженность
          {totalHours > 0 && (
            <span className="ml-2 font-mono font-normal text-slate-400">
              {totalHours.toFixed(1)} ч за период
            </span>
          )}
        </h3>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {[["staff", "По мастерам"], ["dep", "По отделам"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                tab === id ? "bg-white shadow-sm" : "text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {totalHours === 0 ? (
        <p className="text-sm text-slate-400">
          Часы не внесены. Их ставят при закрытии работы — по каждой услуге отдельно.
        </p>
      ) : tab === "staff" ? (
        <div className="max-h-72 scroll-slim space-y-2 overflow-y-auto pr-1">
          {rows.filter((r) => r.hours > 0).map((r) => (
            <div key={r.id}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{r.name}</span>
                <span className="font-mono">
                  {r.hours.toFixed(1)} ч
                  <span className="ml-1 text-xs text-slate-400">
                    {Math.round((r.hours / totalHours) * 100)}%
                  </span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full bg-blue-800"
                  style={{ width: (r.hours / totalHours) * 100 + "%" }} />
              </div>
              <div className="text-xs text-slate-500">
                {money(r.sum)}{r.hours > 0 ? ` · ${money(r.sum / r.hours)}/час` : ""}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="max-h-72 scroll-slim space-y-2 overflow-y-auto pr-1">
          {depRows.map(([id, v]) => (
            <div key={id}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span>{depName(id)}</span>
                <span className="font-mono">
                  {v.hours.toFixed(1)} ч
                  <span className="ml-1 text-xs text-slate-400">
                    {Math.round((v.hours / totalHours) * 100)}%
                  </span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full bg-cyan-500"
                  style={{ width: (v.hours / totalHours) * 100 + "%" }} />
              </div>
              <div className="text-xs text-slate-500">{money(v.sum)}</div>
            </div>
          ))}
        </div>
      )}

      {unassigned.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="text-sm text-amber-900">
            В <b>{unassigned.length}</b> заказ(ах) у услуг не указан исполнитель — их деньги
            делятся между мастерами поровну. Откройте заказ и проставьте, кто что делал.
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {unassigned.slice(0, 12).map((o) => (
              <button key={o.id} onClick={() => setOrderModal(o)}
                className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs hover:border-amber-500">
                №{o.n} · {humanDate(o.date)}
              </button>
            ))}
            {unassigned.length > 12 && (
              <span className="self-center text-xs text-amber-800">
                и ещё {unassigned.length - 12}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Химия по боксам: что израсходовано, что осталось, что делали       */
/* ------------------------------------------------------------------ */

function BoxStock({ ctx, onMove }) {
  const { data, money, api } = ctx;
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [pickItem, setPickItem] = useState({});

  // приход или списание прямо из карточки бокса
  const moveFor = (b, kind) => {
    const item = (data.stockItems || []).find((i) => i.id === pickItem[b.id]);
    if (!item) return;
    onMove({ item, kind, box: b.id });
  };

  const from = days === 0 ? "0000-01-01" : toLocal(shiftDays(-(days - 1))).slice(0, 10);
  const to = toLocal(new Date()).slice(0, 10);

  // data меняется после каждого движения — пересчитываем и раскладку
  useEffect(() => {
    api.stockByBox(`?from=${from}&to=${to}`).then(setRows).catch(() => setRows([]));
  }, [days, data.stockItems]);

  if (rows === null) return <p className="text-sm text-slate-400">Считаю по боксам…</p>;

  const spendOf = (b) => b.spent.reduce((s, r) => s + (r.sum || 0), 0);
  const qtyOf = (b) => b.spent.reduce((s, r) => s + (r.qty || 0), 0);
  const totalSpend = rows.reduce((s, b) => s + spendOf(b), 0);
  const sorted = [...rows].sort((a, b) => spendOf(b) - spendOf(a));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-slate-500">
          Израсходовано химии за период: <b className="font-mono text-slate-700">{money(totalSpend)}</b>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {PERIOD_OPTIONS.map(([d, label]) => (
            <button key={d} onClick={() => setDays(d)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                days === d ? "bg-white shadow-sm" : "text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 && <Empty text="Движений по боксам пока не было." />}

      {sorted.map((b) => {
        const spend = spendOf(b);
        const isOpen = open === b.id;
        return (
          <div key={b.id || "none"} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <button onClick={() => setOpen(isOpen ? null : b.id)}
              className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left row-hover">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{b.name}</div>
                <div className="text-xs text-slate-500">
                  {b.orders} заказ(ов) · {b.spent.length} позиц. химии
                  {qtyOf(b) > 0 && ` · израсходовано ${Math.round(qtyOf(b) * 100) / 100} ед.`}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-lg font-bold text-emerald-700">
                  {money(b.revenue || 0)}
                </div>
                <div className="font-mono text-xs text-rose-600">− {money(spend)} химия</div>
              </div>
              <ChevronRight size={16}
                className={`text-slate-400 transition ${isOpen ? "rotate-90" : ""}`} />
            </button>

            {totalSpend > 0 && (
              <div className="h-1 bg-slate-100">
                <div className="h-1 bg-blue-800" style={{ width: (spend / totalSpend) * 100 + "%" }} />
              </div>
            )}

            {isOpen && (
              <div className="border-t border-slate-100 p-4">
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Принёс" value={money(b.revenue || 0)}
                    sub={`${b.orders} заказ(ов)`} />
                  <Stat label="Химия" value={money(spend)}
                    sub={qtyOf(b) > 0 ? `${Math.round(qtyOf(b) * 100) / 100} ед.` : null} />
                  <Stat label="Разница" value={money((b.revenue || 0) - spend)} />
                  <Stat label="Доля химии"
                    value={b.revenue > 0 ? Math.round((spend / b.revenue) * 100) + "%" : "—"}
                    sub="от выручки бокса" />
                </div>

                <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
                  <select value={pickItem[b.id] || ""}
                    onChange={(e) => setPickItem({ ...pickItem, [b.id]: e.target.value })}
                    className={`${inputBase} min-w-0 flex-1`}>
                    <option value="">выберите химию…</option>
                    {(data.stockItems || []).filter((i) => i.active).map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                  <Btn onClick={() => moveFor(b, "in")}><TrendingUp size={15} />Завести в бокс</Btn>
                  <Btn onClick={() => moveFor(b, "out")}><TrendingDown size={15} />Списать</Btn>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Израсходовано
                  </h4>
                  {b.spent.length === 0 ? (
                    <p className="text-sm text-slate-400">Ничего не списывали.</p>
                  ) : (
                    <div className="max-h-52 scroll-slim space-y-1.5 overflow-y-auto pr-1">
                      {b.spent.map((r) => (
                        <div key={r.itemId} className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate">
                            {r.name}
                            <span className="ml-1 text-xs text-slate-400">
                              {Math.round(r.qty * 100) / 100} {r.unit}
                            </span>
                          </span>
                          <span className="font-mono">{money(r.sum)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between border-t border-slate-200 pt-1.5 text-sm font-semibold">
                        <span>Итого</span>
                        <span className="font-mono">{money(spend)}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Остаток в боксе
                  </h4>
                  {b.balance.length === 0 ? (
                    <p className="text-sm text-slate-400">Пусто — химию сюда не приходовали.</p>
                  ) : (
                    <div className="max-h-52 scroll-slim space-y-1.5 overflow-y-auto pr-1">
                      {b.balance.map((r) => (
                        <div key={r.itemId} className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate">{r.name}</span>
                          <span className={`font-mono ${r.qty < 0 ? "text-rose-600" : ""}`}>
                            {Math.round(r.qty * 100) / 100} {r.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    Минус значит, что списали больше, чем приходовали в этот бокс.
                  </p>
                </div>

                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Что делали
                  </h4>
                  {b.services.length === 0 ? (
                    <p className="text-sm text-slate-400">Закрытых заказов нет.</p>
                  ) : (
                    <div className="max-h-52 scroll-slim space-y-1.5 overflow-y-auto pr-1">
                      {b.services.map((r) => (
                        <div key={r.name} className="flex items-baseline gap-3 text-sm">
                          <span className="min-w-0 flex-1 truncate">{r.name}</span>
                          <span className="w-10 shrink-0 text-right font-mono">{r.count}</span>
                          <span className="w-24 shrink-0 text-right font-mono text-xs text-slate-500">
                            {money(r.sum)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <p className="text-xs text-slate-500">
        Чтобы завести химию на пост, нажмите «приход» у позиции в «Остатках» и выберите бокс.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Вход                                                               */
/* ------------------------------------------------------------------ */

function LoginScreen({ onDone }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await api.login({ login: login.trim(), password });
      setToken(r.token);
      const me = await api.me();
      onDone(r.user, me.weakAdmin);
    } catch (e) {
      setErr(e.message || "Не удалось войти");
      setBusy(false);
    }
  };

  return (
    <div className="crm-root flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-800 text-white">
            <Car size={18} />
          </span>
          <span className="text-lg font-bold">Вход в CRM</span>
        </div>

        <div className="space-y-3">
          <Field label="Логин">
            <input value={login} onChange={(e) => setLogin(e.target.value)} autoFocus
              onKeyDown={(e) => e.key === "Enter" && submit()} className={inputCls} />
          </Field>
          <Field label="Пароль">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} className={inputCls} />
          </Field>

          {err && <p className="text-sm font-medium text-rose-600">{err}</p>}

          <Btn kind="primary" className={`w-full ${busy ? "opacity-60" : ""}`} onClick={submit}>
            {busy ? "Проверяю…" : "Войти"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Пользователи и роли                                                */
/*  Права ограничивают только доступ к CRM и с отделами не связаны.    */
/* ------------------------------------------------------------------ */

function UsersEditor({ ctx }) {
  const { me, data, api } = ctx;
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("users");
  const [userForm, setUserForm] = useState(null);
  const [err, setErr] = useState("");

  const load = () => api.users().then(setState).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (!state) return <p className="text-sm text-slate-400">Загружаю пользователей…</p>;

  const saveUser = async (u) => {
    setErr("");
    try {
      await api.saveUser(u);
      await load();
      setUserForm(null);
    } catch (e) { setErr(e.message); }
  };

  const removeUser = async (u) => {
    setErr("");
    try { await api.deleteUser(u.id); await load(); }
    catch (e) { setErr(e.message); }
  };

  const togglePerm = async (role, perm) => {
    const next = role.permissions.includes(perm)
      ? role.permissions.filter((p) => p !== perm)
      : [...role.permissions, perm];
    setErr("");
    try { await api.saveRole({ ...role, permissions: next }); await load(); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold">Пользователи и роли</h3>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {[["users", `Люди · ${state.users.length}`], ["roles", `Роли · ${state.roles.length}`]]
            .map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  tab === id ? "bg-white shadow-sm" : "text-slate-600"}`}>
                {label}
              </button>
            ))}
        </div>
      </div>

      <p className="text-sm text-slate-500">
        Права управляют только доступом к разделам CRM. На отделы, выработку и деньги
        они не влияют — это разные вещи.
      </p>

      {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}

      {tab === "users" ? (
        <div className="space-y-2">
          {state.users.map((u) => (
            <div key={u.id}
              className={`flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2.5 ${
                u.active ? "" : "opacity-50"}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{u.name || u.login}</span>
                  <span className="font-mono text-xs text-slate-500">{u.login}</span>
                  {u.id === me.id && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">это вы</span>
                  )}
                  {!u.active && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">отключён</span>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  {u.roleName || "роль не назначена"}
                  {u.lastSeen ? ` · заходил ${humanDate(u.lastSeen)}` : " · ещё не заходил"}
                </div>
              </div>
              <Btn kind="quiet" onClick={() => setUserForm(u)}><Pencil size={15} /></Btn>
              <Btn kind="quiet" onClick={() => removeUser(u)}><Trash2 size={15} /></Btn>
            </div>
          ))}

          <Btn onClick={() => setUserForm({ active: true, roleId: "washers" })}>
            <Plus size={15} />Добавить пользователя
          </Btn>
        </div>
      ) : (
        <div className="space-y-3">
          {state.roles.map((role) => (
            <div key={role.id} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-medium">{role.name}</span>
                <span className="text-xs text-slate-500">
                  {role.users} человек(а)
                  {role.system && " · права менять нельзя"}
                </span>
                {!role.system && role.users === 0 && (
                  <button onClick={async () => {
                    setErr("");
                    try { await api.deleteRole(role.id); await load(); }
                    catch (e) { setErr(e.message); }
                  }} className="ml-auto rounded p-1 text-slate-400 hover:text-rose-600">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

              {role.system ? (
                <p className="text-xs text-slate-500">Полный доступ ко всем разделам.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {state.catalog.map((g) => (
                    <div key={g.group}>
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {g.group}
                      </div>
                      {g.items.map(([key, label]) => (
                        <label key={key}
                          className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-sm row-hover">
                          <input type="checkbox" checked={role.permissions.includes(key)}
                            onChange={() => togglePerm(role, key)}
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-blue-800" />
                          <span className="leading-tight">{label}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          <AddRole api={api} onSaved={load} setErr={setErr} />
        </div>
      )}

      {userForm && (
        <UserModal ctx={ctx} user={userForm.id ? userForm : null} draft={userForm}
          roles={state.roles} onClose={() => setUserForm(null)} onSave={saveUser} />
      )}
    </div>
  );
}

function AddRole({ api, onSaved, setErr }) {
  const [name, setName] = useState("");
  return (
    <div className="flex gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Новая роль: например, приёмщики" className={inputCls} />
      <Btn onClick={async () => {
        if (!name.trim()) return;
        setErr("");
        try { await api.saveRole({ name: name.trim(), permissions: [] }); setName(""); await onSaved(); }
        catch (e) { setErr(e.message); }
      }}><Plus size={15} />Добавить</Btn>
    </div>
  );
}

function UserModal({ ctx, user, draft, roles, onClose, onSave }) {
  const { data } = ctx;
  const [f, setF] = useState(user || draft || { active: true });
  const [password, setPassword] = useState("");
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  return (
    <Modal open onClose={onClose} title={user ? f.login : "Новый пользователь"}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Логин">
            <input value={f.login || ""} onChange={(e) => set("login", e.target.value)}
              className={inputCls} placeholder="latinicej" />
          </Field>
          <Field label="Имя">
            <input value={f.name || ""} onChange={(e) => set("name", e.target.value)}
              className={inputCls} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Роль">
            <select value={f.roleId || ""} onChange={(e) => set("roleId", e.target.value)}
              className={inputCls}>
              <option value="">без роли</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Сотрудник">
            <select value={f.staffId || ""} onChange={(e) => set("staffId", e.target.value)}
              className={inputCls}>
              <option value="">не связан</option>
              {(data.staff || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              Связь только для удобства: на права и выработку не влияет.
            </span>
          </Field>
        </div>

        <Field label={user ? "Новый пароль (пусто — не менять)" : "Пароль"}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className={inputCls} />
        </Field>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active !== false}
            onChange={(e) => set("active", e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-blue-800" />
          Доступ разрешён
        </label>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" onClick={() => onSave({ ...f, password: password || undefined })}>
            Сохранить
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Очистка базы: вопрос, затем пароль суперадмина                     */
/* ------------------------------------------------------------------ */

function WipeModal({ ctx, onClose }) {
  const { api, reload } = ctx;
  const [step, setStep] = useState(1);
  const [scope, setScope] = useState("orders");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await api.wipe({ password, scope });
      await reload();
      setStep(3);
      setErr("");
      setPassword("");
      setBusy(false);
      setTimeout(onClose, 1500);
    } catch (e) {
      setErr(e.message || "Не удалось очистить");
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Очистка базы">
      {step === 3 ? (
        <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">Готово, база очищена.</p>
      ) : step === 1 ? (
        <div className="space-y-4">
          <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
            Действие необратимое. Резервной копии не создаётся — если она нужна,
            закройте окно и сначала скачайте её кнопкой рядом.
          </p>

          <Field label="Что удалить">
            <select value={scope} onChange={(e) => setScope(e.target.value)} className={inputCls}>
              <option value="orders">Только заказы</option>
              <option value="all">Заказы, клиентов, машины и заявки</option>
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              Прайс, сотрудники, отделы, боксы и склад остаются в любом случае.
            </span>
          </Field>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <Btn onClick={onClose}>Отмена</Btn>
            <Btn kind="danger" onClick={() => setStep(2)}>Да, продолжить</Btn>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Подтвердите паролем суперадмина <b>admin</b>.
          </p>
          <Field label="Пароль суперадмина">
            <input type="password" value={password} autoFocus
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()} className={inputCls} />
          </Field>

          {err && <p className="text-sm font-medium text-rose-600">{err}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <Btn onClick={() => setStep(1)}>Назад</Btn>
            <Btn kind="danger" onClick={run} className={busy ? "opacity-60" : ""}>
              <Trash2 size={15} />{busy ? "Удаляю…" : "Удалить безвозвратно"}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* Смена собственного пароля — доступна любому, кто вошёл. */
function PasswordCard({ ctx }) {
  const { me, weakAdmin, api } = ctx;
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const save = async () => {
    setErr(""); setMsg("");
    try {
      await api.changePassword({ current, password: next });
      setMsg("Пароль изменён. На других устройствах придётся войти заново.");
      setCurrent(""); setNext(""); setOpen(false);
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold">Мой доступ</h3>
      <p className="text-sm text-slate-500">
        Вы вошли как <b>{me.name || me.login}</b> · {me.roleName || "без роли"}
      </p>

      {weakAdmin && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          У суперадмина стоит пароль по умолчанию. Смените его — сейчас в CRM
          может зайти любой, кто знает адрес.
        </p>
      )}

      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{msg}</p>}
      {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}

      {open ? (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Текущий пароль">
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
                className={inputCls} />
            </Field>
            <Field label="Новый пароль">
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()} className={inputCls} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setOpen(false)}>Отмена</Btn>
            <Btn kind="primary" onClick={save}>Сменить</Btn>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Btn onClick={() => setOpen(true)}>Сменить пароль</Btn>
          <Btn onClick={async () => {
            try { await api.logout(); } catch (e) { /* всё равно выходим */ }
            setToken("");
            window.dispatchEvent(new Event("crm-logout"));
          }}>Выйти</Btn>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Прогноз: деньги, которые ещё не стали выручкой                     */
/* ------------------------------------------------------------------ */

function ForecastPanel({ ctx, forecast, byStage, count }) {
  const { money, setView } = ctx;
  if (!count) return null;

  const LABELS = { booked: "Записаны", accepted: "Приняты", work: "В работе",
                   done: "Готовы к выдаче" };
  const rows = ["booked", "accepted", "work", "done"].filter((k) => byStage[k]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">
          Ожидается <span className="font-normal text-slate-400">не выдано {count} машин(ы)</span>
        </h3>
        <span className="font-mono text-lg font-bold text-amber-700">{money(forecast)}</span>
      </div>

      <div className="space-y-2">
        {rows.map((k) => (
          <div key={k}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>{LABELS[k]} <span className="text-xs text-slate-400">{byStage[k].n}</span></span>
              <span className="font-mono">{money(byStage[k].sum)}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-100">
              <div className="h-1.5 rounded-full bg-amber-500"
                style={{ width: Math.min(100, (byStage[k].sum / Math.max(1, forecast)) * 100) + "%" }} />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-slate-500">
        В выручку и выработку эти суммы попадут, когда машину выдадут.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Воронка: где сделка стоит дольше всего                             */
/* ------------------------------------------------------------------ */

function FunnelPanel({ ctx, orders }) {
  const { money } = ctx;
  const [mode, setMode] = useState("work");   // work — рабочие часы, real — фактические

  const issued = orders.filter((o) => o.status === "issued");
  const measure = mode === "work" ? workMinutes : spanMinutes;

  // Переходы считаем по отметкам времени: их ставит сервер на каждом шаге.
  const steps = [
    { key: "accept", label: "Записан → Принят",
      from: (o) => o.createdAt, to: (o) => o.acceptedAt },
    { key: "start", label: "Принят → В работе",
      from: (o) => o.acceptedAt, to: (o) => o.workStartedAt },
    { key: "doing", label: "В работе → Готов",
      from: (o) => o.workStartedAt, to: (o) => o.workFinishedAt },
    { key: "give", label: "Готов → Выдан",
      from: (o) => o.workFinishedAt, to: (o) => o.issuedAt },
  ];

  const rows = steps.map((s) => {
    const vals = orders
      .map((o) => measure(s.from(o), s.to(o)))
      .filter((v) => v != null);
    return { ...s, avg: avgOf(vals), max: vals.length ? Math.max(...vals) : null, n: vals.length };
  });

  // Полный цикл: от начала работ до выдачи машины
  const totalReal = avgOf(issued.map((o) => spanMinutes(o.workStartedAt, o.issuedAt))
    .filter((v) => v != null));
  const totalWork = avgOf(issued.map((o) => workMinutes(o.workStartedAt, o.issuedAt))
    .filter((v) => v != null));

  const worst = rows.filter((r) => r.avg != null).sort((a, b) => b.avg - a.avg)[0];
  const scale = Math.max(1, ...rows.map((r) => r.avg || 0));

  if (!rows.some((r) => r.n)) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-bold">Движение по воронке</h3>
        <p className="text-sm text-slate-400">
          Данных пока нет — отметки времени копятся с каждым переходом заказа по стадиям.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold">Движение по воронке</h3>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {[["work", "Рабочее время"], ["real", "Фактическое"]].map(([id, label]) => (
            <button key={id} onClick={() => setMode(id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                mode === id ? "bg-white shadow-sm" : "text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <Stat label="Машина у нас" value={humanMinutes(totalReal)}
          sub="фактически, от начала работ до выдачи" />
        <Stat label="Чистое время работы" value={humanMinutes(totalWork)}
          sub="только смена, 10:00–19:00" />
      </div>

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.key}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>
                {r.label}
                <span className="ml-1 text-xs text-slate-400">{r.n} заказ(ов)</span>
              </span>
              <span className="font-mono">
                {humanMinutes(r.avg)}
                {r.max != null && r.max > (r.avg || 0) && (
                  <span className="ml-1 text-xs text-slate-400">макс {humanMinutes(r.max)}</span>
                )}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-100">
              <div className={`h-1.5 rounded-full ${
                  worst && r.key === worst.key ? "bg-amber-500" : "bg-blue-800"}`}
                style={{ width: Math.min(100, ((r.avg || 0) / scale) * 100) + "%" }} />
            </div>
          </div>
        ))}
      </div>

      {worst && (
        <p className="mt-3 text-xs text-slate-500">
          Дольше всего сделка стоит на шаге «{worst.label}» — в среднем {humanMinutes(worst.avg)}.
          {mode === "work"
            ? " Считается только рабочее время, ночи и выходные исключены."
            : " Считается всё подряд, включая ночи и выходные."}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Клиенты только на мойке                                            */
/*  Кто годами ездит на «3 фазы» и ни разу не взял детейлинг — это     */
/*  и есть запас роста: им можно предлагать полировку и защиту.        */
/* ------------------------------------------------------------------ */

function WashOnlyPanel({ ctx }) {
  const { data, money, orderTotal, payrollRate, setClientCard } = ctx;

  // По умолчанию считаем мойкой услуги, в названии которых есть «мойка»
  // или «фаз». Набор правится галочками — прайс у всех свой.
  const guess = (data.services || [])
    .filter((s) => /мойк|фаз/i.test(s.name || ""))
    .map((s) => s.id);
  const [washIds, setWashIds] = useState(guess);
  const [pick, setPick] = useState(false);

  const issued = (data.orders || []).filter((o) => o.status === "issued");
  const gross = (o) => o.items.reduce((s, i) => s + num(i.price) * num(i.qty || 1), 0);

  // группируем по клиенту и смотрим, выходил ли он за пределы мойки
  const isOwner = (sid) => !!(data.staff || []).find((s) => s.id === sid)?.isOwner;

  const acc = {};
  issued.forEach((o) => {
    const a = acc[o.clientId] || (acc[o.clientId] = {
      visits: 0, revenue: 0, discount: 0, other: 0, first: null, last: null,
      washSum: 0, fund: 0,
    });
    a.visits += 1;
    a.revenue += orderTotal(o);
    // фонд считаем по факту: за работу собственника зарплата не платится
    a.fund += orderEarnings(o, orderTotal, isOwner, payrollRate).fund;
    a.discount += gross(o) - orderTotal(o);
    const d = dayKey(o.date);
    if (!a.first || d < a.first) a.first = d;
    if (!a.last || d > a.last) a.last = d;
    o.items.forEach((i) => {
      const sum = num(i.price) * num(i.qty || 1);
      if (i.serviceId && washIds.includes(i.serviceId)) a.washSum += sum;
      else a.other += sum;
    });
  });

  const rows = Object.entries(acc)
    .filter(([, a]) => a.other === 0 && a.washSum > 0)
    .map(([id, a]) => {
      const c = (data.clients || []).find((x) => String(x.id) === String(id));
      return {
        id, name: c?.name || "Клиент удалён", phone: c?.phone, tgId: c?.tg_id,
        isParking: !!c?.isParking,
        ...a,
        profit: a.revenue - a.fund,
        days: a.first ? Math.max(1, daysBetween(a.first, new Date())) : 1,
      };
    })
    .sort((x, y) => y.revenue - x.revenue);

  const total = rows.reduce((s, r) => s + r.revenue, 0);
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);
  const totalDiscount = rows.reduce((s, r) => s + r.discount, 0);
  const totalVisits = rows.reduce((s, r) => s + r.visits, 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold">
          Только мойка
          <span className="ml-2 font-normal text-slate-400">
            {rows.length} клиент(ов) за всё время
          </span>
        </h3>
        <button onClick={() => setPick(!pick)}
          className="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-500 hover:border-blue-700 hover:text-blue-700">
          {pick ? "свернуть" : `какие услуги считать мойкой · ${washIds.length}`}
        </button>
      </div>

      {pick && (
        <div className="mb-3 flex flex-wrap gap-1.5 rounded-lg bg-slate-50 p-2">
          {(data.services || []).map((s) => {
            const on = washIds.includes(s.id);
            return (
              <button key={s.id}
                onClick={() => setWashIds(on ? washIds.filter((x) => x !== s.id) : [...washIds, s.id])}
                className={`rounded-full border px-2 py-0.5 text-xs transition ${
                  on ? "border-blue-700 bg-blue-50 text-blue-900"
                     : "border-slate-200 text-slate-500 hover:border-slate-400"}`}>
                {on ? "✓ " : ""}{s.name}
              </button>
            );
          })}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">
          Таких клиентов нет — либо все берут что-то кроме мойки, либо не отмечены услуги мойки.
        </p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Визитов" value={totalVisits} />
            <Stat label="Выручка" value={money(total)} />
            <Stat label="Прибыль" value={money(totalProfit)}
              sub="выручка минус фонд наёмных" />
            <Stat label="Отдали скидками" value={money(totalDiscount)} />
          </div>

          <div className="max-h-80 scroll-slim space-y-2 overflow-y-auto pr-1">
            {rows.map((r) => (
              <div key={r.id} onClick={() => setClientCard(Number(r.id))} role="button" tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setClientCard(Number(r.id))}
                className="row-hover cursor-pointer rounded-lg px-2 py-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    {r.name}
                    {r.phone && <span className="ml-2 font-mono text-xs text-slate-500">{r.phone}</span>}
                    {r.isParking && (
                      <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                        парковка
                      </span>
                    )}
                  </span>
                  <span className="font-mono font-semibold">{money(r.revenue)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-cyan-500"
                    style={{ width: Math.min(100, (r.revenue / Math.max(1, rows[0].revenue)) * 100) + "%" }} />
                </div>
                <div className="mt-0.5 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                  <span>{r.visits} визит(ов) · с нами {ageLabel(r.days)}</span>
                  <span>
                    прибыль {money(r.profit)}
                    {r.discount > 0 && (
                      <span className="ml-2 text-rose-600">скидки −{money(r.discount)}</span>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs text-slate-500">
            Эти клиенты ни разу не брали ничего, кроме отмеченных услуг. Им есть что предложить:
            полировку, защиту, химчистку.
          </p>
        </>
      )}
    </div>
  );
}

/* Строка позиции склада: используется в раскрытой категории. */
function StockRow({ ctx, item: i, onMove, onEdit }) {
  const { data, money } = ctx;
  const isLow = i.minQty > 0 && i.qty <= i.minQty;

  return (
    <div className={`flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0
      ${i.active ? "" : "opacity-50"}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{i.name}</span>
          {isLow && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              заканчивается
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500">
          {i.price ? `${money(i.price)} за ${i.unit}` : "цена не задана"}
          {i.minQty > 0 && ` · минимум ${i.minQty} ${i.unit}`}
          {i.spent30 > 0 && ` · за 30 дней ушло ${i.spent30} ${i.unit}`}
        </div>
        {/* где лежит: на складе или разнесено по боксам */}
        <div className="mt-1 flex flex-wrap gap-1">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            склад {Math.round((i.atStore ?? i.qty) * 100) / 100} {i.unit}
          </span>
          {(i.locations || []).map((l) => (
            <span key={l.box}
              className={`rounded-full px-2 py-0.5 text-xs ${
                l.qty < 0 ? "bg-rose-100 text-rose-700" : "bg-blue-50 text-blue-800"}`}>
              {boxName(data, l.box) || l.box} {Math.round(l.qty * 100) / 100} {i.unit}
            </span>
          ))}
        </div>
      </div>

      <div className="text-right">
        <div className={`font-mono text-lg font-bold ${isLow ? "text-amber-700" : ""}`}>
          {i.qty} <span className="text-xs font-normal text-slate-400">{i.unit}</span>
        </div>
      </div>

      <div className="flex gap-1">
        <button onClick={() => onMove({ item: i, kind: "in" })}
          title="Приход" className="rounded p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-700">
          <TrendingUp size={16} />
        </button>
        <button onClick={() => onMove({ item: i, kind: "out" })}
          title="Списать" className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
          <TrendingDown size={16} />
        </button>
        <button onClick={() => onEdit(i)}
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900">
          <Pencil size={15} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Парковка                                                           */
/*  Карта мест, аренды и своя аналитика. Место занято, пока у него      */
/*  есть активная аренда — отдельного флага «занято» нет намеренно,     */
/*  иначе он рано или поздно разойдётся с реальностью.                 */
/* ------------------------------------------------------------------ */

const SOON_DAYS = 7;   // за сколько дней подсвечивать окончание аренды

function ParkingView(ctx) {
  const { data, money, api, reload, setClientCard, can } = ctx;
  const [tab, setTab] = useState("map");          // map | money | spots
  const [rentModal, setRentModal] = useState(null);
  const [zone, setZone] = useState("all");
  const [note, setNote] = useState("");

  const spots = data.parkingSpots || [];
  const clientById = {};
  (data.clients || []).forEach((c) => (clientById[c.id] = c));
  const carById = {};
  (data.clients || []).forEach((c) => (c.cars || []).forEach((x) => (carById[x.id] = x)));

  const today = toLocal(new Date()).slice(0, 10);
  const daysLeft = (s) => (s.endsAt ? daysBetween(today, s.endsAt) : null);
  const state = (s) => {
    if (!s.active) return "off";
    if (!s.rentalId) return "free";
    const d = daysLeft(s);
    if (d != null && d < 0) return "overdue";
    if (d != null && d <= SOON_DAYS) return "soon";
    return "busy";
  };

  const zones = [...new Set(spots.map((s) => s.zone).filter(Boolean))];
  const shown = zone === "all" ? spots : spots.filter((s) => (s.zone || "") === zone);

  const busy = spots.filter((s) => s.rentalId);
  const free = spots.filter((s) => s.active && !s.rentalId);
  const overdue = spots.filter((s) => state(s) === "overdue");
  const soon = spots.filter((s) => state(s) === "soon");

  // Деньги: месячную аренду считаем как есть, дневную приводим к месяцу,
  // чтобы «в месяц» означало одно и то же для всех мест.
  const monthly = busy.reduce(
    (s, x) => s + (x.period === "day" ? num(x.price) * 30 : num(x.price)), 0);
  const occupancy = spots.filter((s) => s.active).length
    ? Math.round((busy.length / spots.filter((s) => s.active).length) * 100) : 0;

  const COLORS = {
    free: "border-emerald-300 bg-emerald-50 text-emerald-900",
    busy: "border-blue-300 bg-blue-50 text-blue-900",
    soon: "border-amber-300 bg-amber-50 text-amber-900",
    overdue: "border-rose-300 bg-rose-50 text-rose-900",
    off: "border-slate-200 bg-slate-50 text-slate-400",
  };
  const LABELS = {
    free: "свободно", busy: "занято", soon: "скоро конец",
    overdue: "просрочено", off: "не в обороте",
  };

  const openSpot = (s) => {
    if (s.rentalId) { setClientCard(Number(s.clientId)); return; }
    if (can("parking.edit")) setRentModal({ spot: s });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Парковка</h1>
          <p className="text-sm text-slate-500">Карта мест, аренды и деньги</p>
        </div>
        {can("parking.edit") && (
          <Btn kind="primary" onClick={() => setTab("spots")}>
            <Plus size={15} />Места
          </Btn>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Мест всего" value={spots.length}
          sub={spots.length - spots.filter((s) => s.active).length
            ? `${spots.length - spots.filter((s) => s.active).length} не в обороте` : null} />
        <Stat label="Занято" value={busy.length} sub={`${occupancy}% загрузки`} />
        <Stat label="Свободно" value={free.length} />
        <Stat label="В месяц" value={money(monthly)} sub="по действующим арендам" />
        <Stat label="Требуют внимания" value={overdue.length + soon.length}
          sub={overdue.length ? `${overdue.length} просрочено` : "сроки в порядке"} />
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-white p-1">
        {[["map", "Карта"], ["money", "Аналитика"], ["spots", "Места"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === id ? "bg-blue-800 text-white" : "text-slate-600"}`}>
            {label}
          </button>
        ))}
      </div>

      {note && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}

      {tab === "map" && (
        <>
          {zones.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setZone("all")}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  zone === "all" ? "border-blue-700 bg-blue-50 text-blue-900" : "chip-pick"}`}>
                Все · {spots.length}
              </button>
              {zones.map((z) => (
                <button key={z} onClick={() => setZone(z)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    zone === z ? "border-blue-700 bg-blue-50 text-blue-900" : "chip-pick"}`}>
                  {z} · {spots.filter((s) => s.zone === z).length}
                </button>
              ))}
            </div>
          )}

          {spots.length === 0 ? (
            <Empty text="Мест пока нет. Заведите их во вкладке «Места» — можно сразу пачкой, например A1–A20."
              action={can("parking.edit")
                ? <Btn kind="primary" onClick={() => setTab("spots")}><Plus size={15} />Добавить места</Btn>
                : null} />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8 xl:grid-cols-10">
                {shown.map((s) => {
                  const st = state(s);
                  const c = clientById[s.clientId];
                  const left = daysLeft(s);
                  return (
                    <button key={s.id} onClick={() => openSpot(s)}
                      title={s.rentalId
                        ? `${c?.name || "клиент"} · до ${s.endsAt ? humanDate(s.endsAt) : "без срока"}`
                        : LABELS[st]}
                      className={`flex min-h-20 flex-col rounded-xl border p-2 text-left transition
                        hover:shadow-sm ${COLORS[st]}`}>
                      <span className="font-mono text-sm font-bold">{s.code}</span>
                      {s.rentalId ? (
                        <>
                          <span className="mt-0.5 truncate text-xs">{c?.name || "клиент"}</span>
                          <span className="mt-auto truncate font-mono text-xs opacity-80">
                            {carById[s.carId]?.plate || "номер не указан"}
                          </span>
                          <span className="truncate text-xs opacity-60">
                            {s.endsAt ? `до ${humanDate(s.endsAt)}` : "без срока"}
                          </span>
                          {left != null && left <= SOON_DAYS && (
                            <span className="text-xs font-semibold">
                              {left < 0 ? `просрочено ${-left} дн` : `${left} дн`}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="mt-auto text-xs opacity-70">{LABELS[st]}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                {Object.entries(LABELS).map(([k, label]) => (
                  <span key={k} className="flex items-center gap-1.5">
                    <span className={`h-3 w-3 rounded border ${COLORS[k]}`} />{label}
                  </span>
                ))}
                <span className="text-slate-400">
                  клик по занятому месту открывает карточку клиента
                </span>
              </div>
            </>
          )}
        </>
      )}

      {tab === "money" && <ParkingStats ctx={ctx} spots={spots} clientById={clientById} />}

      {tab === "spots" && (
        <SpotsEditor ctx={ctx} spots={spots} state={state} setNote={setNote}
          onRent={(s) => setRentModal({ spot: s })} />
      )}

      {rentModal && (
        <RentModal ctx={ctx} spot={rentModal.spot} onClose={() => setRentModal(null)} />
      )}
    </div>
  );
}

/* ── Заселение места ───────────────────────────────────────── */

function RentModal({ ctx, spot, onClose }) {
  const { data, money, api, reload } = ctx;
  const existing = spot.rentalId ? {
    id: spot.rentalId, clientId: spot.clientId, carId: spot.carId,
    startedAt: spot.startedAt, endsAt: spot.endsAt, price: spot.price,
    period: spot.period, note: spot.rentalNote,
  } : null;

  const [f, setF] = useState(existing || {
    spotId: spot.id, clientId: "", carId: "",
    startedAt: toLocal(new Date()).slice(0, 10),
    endsAt: toLocal(shiftDays(30)).slice(0, 10),
    price: "", period: "month", note: "",
  });
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [newClient, setNewClient] = useState(null);  // заводим клиента на месте
  const [newCar, setNewCar] = useState(null);     // добавляем машину на месте
  const [plateFix, setPlateFix] = useState("");   // дописываем номер существующей
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const client = (data.clients || []).find((c) => String(c.id) === String(f.clientId));
  const matches = (data.clients || []).filter((c) => {
    const s = q.trim().toLowerCase();
    if (!s) return false;
    return ((c.name || "") + (c.phone || "") +
      (c.cars || []).map((x) => x.plate || "").join(" ")).toLowerCase().includes(s);
  }).slice(0, 6);

  // Создаём клиента вместе с машиной: для парковки машина обязательна,
  // так что заполняем всё одним шагом.
  const createClient = async () => {
    setErr("");
    if (!newClient.name.trim()) return setErr("Впишите имя клиента.");
    if (!newClient.plate.trim()) return setErr("Впишите госномер — без него место занять нельзя.");
    try {
      const res = await api.saveClient({
        name: newClient.name.trim(),
        phone: newClient.phone.trim() || null,
        source: "парковка",
        // make, а не title: в карточке клиента модель хранится так
        cars: [{ id: uid("car"), plate: newClient.plate.trim(), make: newClient.car.trim() }],
      });
      await reload();
      setF((s) => ({ ...s, clientId: res.id, carId: (res.cars || [])[0] || "" }));
      setNewClient(null);
      setQ("");
    } catch (e) { setErr("Не удалось создать клиента: " + e.message); }
  };

  const save = async () => {
    if (!f.clientId) return setErr("Выберите клиента.");
    if (!f.carId && !newCar) return setErr("Выберите машину — место занимает конкретный автомобиль.");

    try {
      let carId = f.carId;

      // Новая машина или недостающий номер: сперва правим карточку клиента,
      // потом занимаем место — иначе аренда повиснет на машине без номера.
      if (newCar) {
        if (!newCar.plate.trim()) return setErr("Впишите госномер новой машины.");
        const cars = [...(client.cars || []),
          { id: uid("car"), plate: newCar.plate.trim(), make: newCar.title.trim() }];
        await api.saveClient({ ...client, cars });
        const fresh = await api.state();
        const c2 = (fresh.clients || []).find((c) => String(c.id) === String(client.id));
        carId = (c2?.cars || []).find(
          (c) => (c.plate || "").toUpperCase() === newCar.plate.trim().toUpperCase())?.id;
        if (!carId) return setErr("Машина сохранилась, но не нашлась — обновите страницу.");
      } else {
        const car = (client.cars || []).find((c) => String(c.id) === String(f.carId));
        if (!(car?.plate || "").trim()) {
          if (!plateFix.trim()) return setErr("Впишите госномер — без него место занимать нельзя.");
          const cars = (client.cars || []).map((c) =>
            String(c.id) === String(f.carId) ? { ...c, plate: plateFix.trim() } : c);
          await api.saveClient({ ...client, cars });
        }
      }

      await api.saveRental({ ...f, carId, spotId: spot.id });
      await reload();
      onClose();
    } catch (e) { setErr(e.message); }
  };

  const release = async () => {
    try {
      await api.closeRental(spot.rentalId);
      await reload();
      onClose();
    } catch (e) { setErr(e.message); }
  };

  return (
    <Modal open onClose={onClose} title={`Место ${spot.code}${spot.zone ? ` · ${spot.zone}` : ""}`}>
      <div className="space-y-4">
        {client ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3">
            <span className="font-semibold">{client.name || "без имени"}</span>
            {client.phone && <span className="font-mono text-xs text-slate-500">{client.phone}</span>}
            <button onClick={() => { set("clientId", ""); set("carId", ""); }}
              className="text-xs text-blue-800 hover:underline">сменить</button>
          </div>
        ) : (
          <Field label="Клиент">
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Имя, телефон или госномер" className={inputCls} />
            <div className="mt-1 space-y-1">
              {matches.map((c) => (
                <button key={c.id} onClick={() => { set("clientId", c.id); setQ(""); }}
                  className="row-hover flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm">
                  <span className="font-medium">{c.name || "без имени"}</span>
                  <span className="font-mono text-xs text-slate-500">{c.phone}</span>
                  {(data.orders || []).some((o) => o.clientId === c.id) && (
                    <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs text-cyan-900"
                      title="Уже обслуживается на мойке">
                      клиент мойки
                    </span>
                  )}
                  {c.cars?.[0]?.plate && <span className="ml-auto"><Plate value={c.cars[0].plate} /></span>}
                </button>
              ))}

              {/* Арендатора часто видят впервые — заводим прямо здесь,
                  не отправляя мастера в раздел «Клиенты». */}
              {newClient ? (
                <div className="space-y-2 rounded-lg border border-slate-300 p-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input value={newClient.name} autoFocus
                      onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
                      placeholder="Как обращаться" className={inputCls} />
                    <input value={newClient.phone}
                      onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })}
                      placeholder="Телефон" className={inputCls} />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input value={newClient.plate}
                      onChange={(e) => setNewClient({ ...newClient, plate: e.target.value.toUpperCase() })}
                      placeholder="Госномер" className={`${inputCls} font-mono uppercase`} />
                    <input value={newClient.car}
                      onChange={(e) => setNewClient({ ...newClient, car: e.target.value })}
                      placeholder="Марка и модель" className={inputCls} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Btn onClick={() => setNewClient(null)}>Отмена</Btn>
                    <Btn kind="primary" onClick={createClient}>Создать</Btn>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {q.trim() && matches.length === 0 && (
                    <span className="text-xs text-slate-500">Никого не нашли.</span>
                  )}
                  <Btn kind="quiet"
                    onClick={() => setNewClient({ name: q.trim(), phone: "", plate: "", car: "" })}>
                    <Plus size={14} />Новый клиент
                  </Btn>
                </div>
              )}
            </div>
          </Field>
        )}

        {client && (
          <Field label="Машина">
            <select value={newCar ? "new" : (f.carId || "")}
              onChange={(e) => {
                if (e.target.value === "new") { setNewCar({ plate: "", title: "" }); set("carId", ""); }
                else { setNewCar(null); set("carId", e.target.value); }
              }}
              className={inputCls}>
              <option value="">выберите машину</option>
              {(client.cars || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.plate || "БЕЗ НОМЕРА"} · {carLabel(c)}
                </option>
              ))}
              <option value="new">➕ другая машина</option>
            </select>

            {/* Машина без номера в базе — просим вписать прямо здесь,
                иначе место займёт «неизвестный автомобиль». */}
            {!newCar && f.carId && !((client.cars || []).find(
              (c) => String(c.id) === String(f.carId))?.plate || "").trim() && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
                <span className="text-xs text-amber-900">
                  У этой машины не заполнен госномер — впишите, он сохранится в карточке клиента.
                </span>
                <input value={plateFix} onChange={(e) => setPlateFix(e.target.value.toUpperCase())}
                  placeholder="BG 123 AB" className={`${inputCls} mt-1 font-mono uppercase`} />
              </div>
            )}

            {newCar && (
              <div className="mt-2 grid gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
                <input value={newCar.plate}
                  onChange={(e) => setNewCar({ ...newCar, plate: e.target.value.toUpperCase() })}
                  placeholder="Госномер" className={`${inputCls} font-mono uppercase`} />
                <input value={newCar.title}
                  onChange={(e) => setNewCar({ ...newCar, title: e.target.value })}
                  placeholder="Марка и модель" className={inputCls} />
              </div>
            )}
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="С какого числа">
            <input type="date" value={f.startedAt || ""} onChange={(e) => set("startedAt", e.target.value)}
              className={inputCls} />
          </Field>
          <Field label="По какое (пусто — без срока)">
            <input type="date" value={f.endsAt || ""} onChange={(e) => set("endsAt", e.target.value)}
              className={inputCls} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Плата">
            <NumField value={f.price ?? ""} onChange={(v) => set("price", v)} step={100} min={0}
              wrapClass="w-full" className={`${inputCls} font-mono`} />
          </Field>
          <Field label="Период">
            <select value={f.period} onChange={(e) => set("period", e.target.value)} className={inputCls}>
              <option value="month">за месяц</option>
              <option value="day">за сутки</option>
            </select>
          </Field>
        </div>

        <Field label="Заметка">
          <input value={f.note || ""} onChange={(e) => set("note", e.target.value)}
            className={inputCls} placeholder="Условия, договорённости" />
        </Field>

        {err && <p className="text-sm font-medium text-rose-600">{err}</p>}

        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
          {existing && (
            <Btn kind="danger" onClick={release}>Освободить место</Btn>
          )}
          <div className="ml-auto flex gap-2">
            <Btn onClick={onClose}>Отмена</Btn>
            <Btn kind="primary" onClick={save}>
              {existing ? "Сохранить" : "Заселить"}
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ── Управление местами ────────────────────────────────────── */

function SpotsEditor({ ctx, spots, state, setNote, onRent }) {
  const { api, reload, can } = ctx;
  const [code, setCode] = useState("");
  const [zone, setZone] = useState("");
  const [bulk, setBulk] = useState("");

  const add = async () => {
    if (!code.trim()) return;
    await api.saveSpot({ code: code.trim(), zone: zone.trim() || null });
    await reload();
    setCode("");
  };

  // «A1-A10» или «1-25»: разворачиваем в список, чтобы не заводить руками
  const addBulk = async () => {
    const m = bulk.trim().match(/^([A-Za-zА-Яа-я]*)(\d+)\s*[-–]\s*([A-Za-zА-Яа-я]*)(\d+)$/);
    if (!m) { setNote("Формат: A1-A10 или 1-25"); return; }
    const [, p1, from, , to] = m;
    const a = Number(from), b = Number(to);
    if (b < a || b - a > 200) { setNote("Диапазон слишком большой или задом наперёд"); return; }
    const list = [];
    for (let i = a; i <= b; i++) list.push(`${p1}${i}`);
    await api.saveSpot({ bulk: list, zone: zone.trim() || null });
    await reload();
    setBulk("");
    setNote("");
  };

  const remove = async (s) => {
    try {
      await api.deleteSpot(s.id);
      await reload();
      setNote("");
    } catch (e) { setNote(e.message); }
  };

  return (
    <div className="space-y-3">
      {can("parking.edit") && (
        <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-4">
          <input value={code} onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Номер места: A1" className={inputCls} />
          <input value={zone} onChange={(e) => setZone(e.target.value)}
            placeholder="Зона или ряд (необязательно)" className={inputCls} />
          <Btn onClick={add}><Plus size={15} />Добавить</Btn>
          <div className="sm:col-span-4 flex flex-wrap gap-2 border-t border-slate-100 pt-2">
            <input value={bulk} onChange={(e) => setBulk(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addBulk()}
              placeholder="Сразу диапазон: A1-A20" className={`${inputCls} sm:max-w-xs`} />
            <Btn onClick={addBulk}>Добавить диапазон</Btn>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {spots.length === 0 && <p className="px-4 py-3 text-sm text-slate-400">Мест пока нет.</p>}
        {spots.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0">
            <span className="w-16 shrink-0 font-mono font-bold">{s.code}</span>
            <span className="text-xs text-slate-500">{s.zone || "без зоны"}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${
              s.rentalId ? "bg-blue-100 text-blue-800"
                : s.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
              {s.rentalId ? "занято" : s.active ? "свободно" : "не в обороте"}
            </span>

            {can("parking.edit") && (
              <div className="ml-auto flex gap-1">
                <Btn kind="quiet" onClick={() => onRent(s)}>
                  {s.rentalId ? "Аренда" : "Заселить"}
                </Btn>
                <Btn kind="quiet" onClick={async () => {
                  await api.saveSpot({ ...s, active: !s.active });
                  await reload();
                }}>
                  {s.active ? "Вывести" : "Вернуть"}
                </Btn>
                <Btn kind="quiet" onClick={() => remove(s)}><Trash2 size={15} /></Btn>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Аналитика парковки ────────────────────────────────────── */

function ParkingStats({ ctx, spots, clientById }) {
  const { data, money } = ctx;
  const history = data.parkingHistory || [];

  const active = spots.filter((s) => s.rentalId);
  const perMonth = (r) => (r.period === "day" ? num(r.price) * 30 : num(r.price));

  // кто сколько платит и как давно стоит
  const byClient = {};
  active.forEach((s) => {
    const a = byClient[s.clientId] || (byClient[s.clientId] = { spots: [], monthly: 0, since: null });
    a.spots.push(s.code);
    a.monthly += perMonth(s);
    if (!a.since || s.startedAt < a.since) a.since = s.startedAt;
  });
  const clients = Object.entries(byClient).sort((a, b) => b[1].monthly - a[1].monthly);

  const monthly = clients.reduce((s, [, v]) => s + v.monthly, 0);
  const closed = history.filter((r) => r.status === "closed");
  const avgStay = closed.length
    ? Math.round(closed.reduce((s, r) => s + Math.max(1, daysBetween(r.startedAt,
        r.closedAt || r.endsAt || toLocal(new Date()).slice(0, 10))), 0) / closed.length)
    : null;

  // сколько мест освобождалось по месяцам — видно текучку
  const byMonth = {};
  history.forEach((r) => {
    const k = (r.startedAt || "").slice(0, 7);
    if (!k) return;
    const a = byMonth[k] || (byMonth[k] = { started: 0, closed: 0 });
    a.started += 1;
    if (r.status === "closed") a.closed += 1;
  });
  const months = Object.entries(byMonth).sort().slice(-6);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Доход в месяц" value={money(monthly)} />
        <Stat label="Арендаторов" value={clients.length}
          sub={(() => {
            // сколько из них ещё и моется: это повод предлагать услуги
            const both = clients.filter(([id]) =>
              (data.orders || []).some((o) => String(o.clientId) === String(id))).length;
            return both ? `${both} из них моются у нас` : "никто пока не моется";
          })()} />
        <Stat label="Средний чек" value={clients.length ? money(monthly / clients.length) : "—"}
          sub="на арендатора" />
        <Stat label="Средний срок" value={avgStay ? `${avgStay} дн` : "—"}
          sub="по завершённым арендам" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-bold">Кто сколько платит</h3>
          {clients.length === 0 ? (
            <p className="text-sm text-slate-400">Активных аренд нет.</p>
          ) : (
            <div className="max-h-72 scroll-slim space-y-2 overflow-y-auto pr-1">
              {clients.map(([id, v]) => (
                <div key={id} onClick={() => ctx.setClientCard(Number(id))} role="button" tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && ctx.setClientCard(Number(id))}
                  className="row-hover cursor-pointer rounded-lg px-2 py-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">{clientById[id]?.name || "Клиент удалён"}</span>
                    <span className="font-mono font-semibold">{money(v.monthly)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full bg-blue-800"
                      style={{ width: Math.min(100, (v.monthly / Math.max(1, clients[0][1].monthly)) * 100) + "%" }} />
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    места {v.spots.join(", ")} · с {humanDate(v.since)}
                  </div>
                </div>
              ))}
              <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-semibold">
                <span>Итого · {clients.length} арендатор(ов)</span>
                <span className="font-mono">{money(monthly)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-bold">Движение по месяцам</h3>
          {months.length === 0 ? (
            <p className="text-sm text-slate-400">Истории пока нет.</p>
          ) : (
            <div className="space-y-2">
              {months.map(([k, v]) => {
                const max = Math.max(...months.map(([, x]) => x.started), 1);
                return (
                  <div key={k}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span>{barLabel({ label: k, k: k + "-01" })}</span>
                      <span className="font-mono text-xs">
                        заселений {v.started}
                        {v.closed > 0 && <span className="ml-2 text-rose-600">съехало {v.closed}</span>}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                      <div className="h-1.5 rounded-full bg-cyan-500"
                        style={{ width: (v.started / max) * 100 + "%" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Деньги парковки пока живут отдельно от отчётов по мойке — свяжем, когда
            определимся, как их учитывать в общей выручке.
          </p>
        </div>
      </div>
    </div>
  );
}
