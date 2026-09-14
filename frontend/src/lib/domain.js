import { API } from "./api";
import { dayKey, humanDate, num, pad, shiftDays, toLocal, todayKey, uid } from "./format";

export const STATUSES = [
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

export const statusOf = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0];

export const BOARD = ["booked", "accepted", "work", "done", "issued"];

/* ------------------------------------------------------------------ */
/*  Время: календарное и рабочее                                       */
/*  Студия работает каждый день с 10:00 до 19:00 по Белграду. Ночной   */
/*  простоя — не работа, поэтому длительность считаем двумя способами. */
/* ------------------------------------------------------------------ */

// Откат — любой переход к более ранней стадии доски.
export const stageIndex = (st) => BOARD.indexOf(st);

export const isRollback = (from, to) =>
  stageIndex(to) >= 0 && stageIndex(from) >= 0 && stageIndex(to) < stageIndex(from);

/* ------------------------------------------------------------------ */
/*  API — точечные запросы к единой БД                                */
/* ------------------------------------------------------------------ */

export function seed() {
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

// Кого предлагать исполнителем услуги: сперва мастера её отдела,
// а если отдел не задан или в нём никого — всех активных.
export function staffForService(data, serviceId) {
  const active = (data.staff || []).filter((s) => s.active);
  const svc = (data.services || []).find((s) => s.id === serviceId);
  if (!svc || !svc.departmentId) return { list: active, exact: false };
  const inDep = active.filter((s) => (s.departmentIds || []).includes(svc.departmentId));
  return inDep.length ? { list: inDep, exact: true } : { list: active, exact: false };
}

// Сколько из цены услуги принадлежит другому отделу. Проценты считаем
// от цены строки, фиксированную сумму берём как есть, но не больше цены.
export function splitAmountFor(item, service) {
  if (item.splitAmount != null && item.splitAmount !== "") return num(item.splitAmount);
  const rule = (service?.splits || [])[0];
  if (!rule) return 0;
  const line = num(item.price) * num(item.qty || 1);
  const raw = rule.kind === "percent" ? (line * num(rule.value)) / 100 : num(rule.value) * num(item.qty || 1);
  return Math.min(Math.round(raw), line);
}

export const splitStaffIds = (i) => (i?.splitStaffIds || []).filter(Boolean);

// Исполнители одной позиции. Их может быть несколько: вдвоём моют
// большую машину или полируют в четыре руки.
export const itemStaffIds = (i) =>
  (i?.staffIds && i.staffIds.length ? i.staffIds : (i?.staffId ? [i.staffId] : []));

// Услуги заказа делятся на группы по отделам: озонирование и химчистка
// уходят детейлерам одной строкой, полировка — полировщикам. Мастера
// назначаются на группу, а не на каждую позицию отдельно.
export function groupItemsByDepartment(data, items) {
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

export function staffForDepartment(data, depId) {
  const active = (data.staff || []).filter((s) => s.active);
  if (!depId) return { list: active, exact: false };
  const inDep = active.filter((s) => (s.departmentIds || []).includes(depId));
  return inDep.length ? { list: inDep, exact: true } : { list: active, exact: false };
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
export function departmentCovered(data, items, depId, selfIdx) {
  if (!depId) return null;
  return items.findIndex((it, i) => {
    if (i === selfIdx) return false;
    const svc = (data.services || []).find((s) => s.id === it.serviceId);
    return svc?.departmentId === depId;
  });
}

// Сколько работы каждого мастера в заказе (в деньгах, со скидкой,
// до применения ставки фонда) и сколько часов на него пришлось.
export function orderWorkShares(o, orderTotal) {
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
export function orderEarnings(o, orderTotal, isOwner, rate) {
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
export const orderStaffIds = (o) =>
  (o?.staffIds && o.staffIds.length ? o.staffIds : (o?.staffId ? [o.staffId] : []));

// Периоды отчётов: одни и те же в самом отчёте и в блоке скидок.
// 0 — «всё время», 1 — «сегодня».
export const PERIOD_OPTIONS = [
  [1, "Сегодня"], [7, "7 дней"], [30, "30 дней"], [90, "90 дней"],
  [180, "180 дней"], [365, "Год"], [0, "Всё время"],
];

export const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн",
                      "июл", "авг", "сен", "окт", "ноя", "дек"];

// Подпись столбца: дата для дней и недель, «сен 2026» для месяцев.
export function barLabel(b) {
  if (!b) return "";
  if (b.label && b.label.length === 7) {
    const [y, m] = b.label.split("-");
    return `${MONTHS_SHORT[Number(m) - 1]} ${y}`;
  }
  return humanDate(b.k);
}

// Столбцы графика: день, неделя или месяц — смотря какой период выбран.
export function buildBars(days, byDay, orders = []) {
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

// Маппинг ключей услуг бота → человеческие названия (ru)
export const SERVICE_KEY_NAMES = {
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

export const svcName = (key) => SERVICE_KEY_NAMES[key] || key;

// Источник заявки / заказа
export const SOURCE_BADGE = {
  bot: { label: "Telegram-бот", cls: "bg-blue-100 text-blue-800" },
  crm: { label: "CRM (вручную)", cls: "bg-slate-100 text-slate-600" },
};

/* ------------------------------------------------------------------ */
/*  Входящие заявки из Telegram-бота                                   */
/* ------------------------------------------------------------------ */

export const STOCK_CATEGORIES = ["Химия", "Расходники", "Абразивы", "Защитные составы", "Инструмент", "Прочее"];

export const STOCK_UNITS = ["шт", "л", "мл", "кг", "г", "м", "упак"];

export const SOON_DAYS = 7;   // за сколько дней подсвечивать окончание аренды
