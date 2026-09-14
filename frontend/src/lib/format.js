

export const uid = (p = "id") => p + "_" + Math.random().toString(36).slice(2, 9);

export const pad = (n) => String(n).padStart(2, "0");

export const toLocal = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const todayKey = () => toLocal(new Date()).slice(0, 10);

export const dayKey = (s) => (s || "").slice(0, 10);

export const shiftDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

export const num = (v) => (isNaN(parseFloat(v)) ? 0 : parseFloat(v));

export const fmt = (v) => new Intl.NumberFormat("ru-RU").format(Math.round(v || 0));

export const humanDate = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};

export const humanTime = (s) => (s ? s.slice(11, 16) : "");

export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

export const WORK_DAY = { start: 10, end: 19 };

// Отметки ставит SQLite через datetime('now'), то есть в UTC. Приводим
// к белградскому времени, иначе рабочие часы съедут на час-два.
export function belgrade(ts) {
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
export function spanMinutes(from, to) {
  const a = belgrade(from), b = belgrade(to);
  if (!a || !b || b < a) return null;
  return Math.round((b - a) / 60000);
}

// Рабочие минуты: только внутри смены и только в рабочие дни.
export function workMinutes(from, to) {
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
export function humanMinutes(min) {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)} мин`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h < 24) return m ? `${h} ч ${m} мин` : `${h} ч`;
  const d = Math.floor(h / 24);
  return `${d} дн ${h % 24} ч`;
}

export const avgOf = (list) => (list.length
  ? Math.round(list.reduce((s, x) => s + x, 0) / list.length) : null);

// Базовый вид поля БЕЗ ширины. Ширину задаём отдельно: если оставить
// w-full внутри, он побьёт w-16/w-28 в строках услуг — Tailwind описывает
// w-full позже по порядку, и поле названия схлопывается в пару пикселей.
// Цвета боксов. Приглушённая гамма в духе сайта: рядом с синим акцентом
// они не спорят и одинаково читаются на светлой и тёмной теме.
// Цвет — подсказка, а не единственный признак: подпись бокса всегда рядом.
export const BOX_COLORS = {
  wash_1:   "#4f7a6a",   // приглушённый изумруд
  wash_2:   "#5b7c99",   // серо-голубой
  semi_dry: "#b08d57",   // тёплая охра
  dry:      "#8c5a4a",   // пыльный терракот
  leather:  "#7a4a52",   // глубокий бордо
};

export const BOX_FALLBACK = "#6b7280";

// Палитра для выбора цвета бокса в настройках. Приглушённая, «old money»:
// такие цвета не спорят с синим акцентом и читаются на обеих темах.
export const BOX_PALETTE = [
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
export const boxColor = (id, data) => {
  const own = (data?.boxes || []).find((b) => b.id === id)?.color;
  return own || BOX_COLORS[id] || BOX_FALLBACK;
};

export const boxName = (data, id) => (data.boxes || []).find((b) => b.id === id)?.name || "";

// Бот записывает машину одной строкой в title («VW Golf 2018»), CRM —
// раздельно в make/model. Показываем то, что заполнено.
export const carLabel = (car) => {
  if (!car) return "";
  const mm = [car.make, car.model].filter(Boolean).join(" ").trim();
  return mm || car.title || "";
};

// «за 3 нед» / «за 8 мес» / «за 1 г 2 мес» — короткая подпись стажа
export function ageLabel(days) {
  if (days < 14) return `${Math.max(1, Math.round(days))} дн`;
  if (days < 61) return `${Math.round(days / 7)} нед`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} мес`;
  const y = Math.floor(months / 12), m = months % 12;
  return m ? `${y} г ${m} мес` : `${y} г`;
}
