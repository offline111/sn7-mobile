import React, { useState } from "react";
import {
  Download, Plus, Trash2
} from "lucide-react";
import { STATUSES, orderStaffIds, statusOf } from "../lib/domain";
import { boxColor, boxName, carLabel, dayKey, humanDate, shiftDays, toLocal } from "../lib/format";
import { Btn, Empty, Field, Plate, StatusChip } from "../ui/base";
import { inputCls } from "../ui/theme";

export function OrdersView(ctx) {
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
