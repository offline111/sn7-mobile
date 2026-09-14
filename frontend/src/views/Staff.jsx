import React, { useState } from "react";
import {
  CalendarDays, ClipboardList, Pencil, Phone, Plus, Send, Trash2
} from "lucide-react";
import { api } from "../lib/api";
import { orderEarnings, orderStaffIds } from "../lib/domain";
import { dayKey, humanDate, num, shiftDays, toLocal, uid } from "../lib/format";
import { Btn, Empty, Field, Modal, Stat, StatusChip } from "../ui/base";
import { inputCls } from "../ui/theme";

/* ------------------------------------------------------------------ */
/*  Сотрудники                                                         */
/* ------------------------------------------------------------------ */
export function StaffView(ctx) {
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

export function StaffModal({ ctx, member, onClose, onSaved }) {
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

export function StaffCard({ ctx, id, onClose }) {
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
