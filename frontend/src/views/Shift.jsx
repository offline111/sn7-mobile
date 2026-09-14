import React, { useState, useEffect } from "react";
import {
  ChevronLeft, ChevronRight, Plus
} from "lucide-react";
import { BOARD, orderStaffIds, statusOf } from "../lib/domain";
import { boxColor, boxName, carLabel, dayKey, daysBetween, humanDate, humanTime, shiftDays, toLocal } from "../lib/format";
import { Btn, Plate, Stat } from "../ui/base";

export function ShiftView(ctx) {
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
