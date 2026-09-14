import React, { useState, useEffect, useMemo } from "react";
import {
  BarChart3, Car, ClipboardList, Settings as Cog, Inbox, LayoutGrid, Package, Plus, Search, Sparkles, UserCog, Users
} from "lucide-react";
import { api, loadData, setToken } from "./lib/api";
import { isRollback, seed } from "./lib/domain";
import { carLabel, fmt, num } from "./lib/format";
import { OrderModal, RollbackModal, StageModal } from "./modals/Order";
import { Btn, Field, Plate } from "./ui/base";
import { ThemeStyles, inputCls } from "./ui/theme";
import { ClientCard, ClientModal, ClientsView, MessageModal } from "./views/Clients";
import { InboxView } from "./views/Inbox";
import { OrdersView } from "./views/Orders";
import { ParkingView } from "./views/Parking";
import { ReportsView } from "./views/Reports";
import { ServiceModal, ServicesView } from "./views/Services";
import { SettingsView } from "./views/Settings";
import { ShiftView } from "./views/Shift";
import { StaffCard, StaffModal, StaffView } from "./views/Staff";
import { StockView } from "./views/Stock";

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

export function LoginScreen({ onDone }) {
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
