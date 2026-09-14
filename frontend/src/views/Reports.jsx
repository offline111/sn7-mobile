import React, { useState } from "react";
import { PERIOD_OPTIONS, barLabel, buildBars, itemStaffIds, orderEarnings, orderStaffIds } from "../lib/domain";
import { ageLabel, avgOf, dayKey, daysBetween, humanDate, humanMinutes, num, pad, shiftDays, spanMinutes, toLocal, workMinutes } from "../lib/format";
import { Stat } from "../ui/base";

export function ReportsView(ctx) {
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
export function CalendarPanel({ ctx, month, onMonth }) {
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

export function TopClientsPanel({ ctx, rows, total, allSpent = 0 }) {
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

export function DiscountPanel({ ctx, days }) {
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

export function WorkloadPanel({ ctx, byStaff, list }) {
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

export function ForecastPanel({ ctx, forecast, byStage, count }) {
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

export function FunnelPanel({ ctx, orders }) {
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

export function WashOnlyPanel({ ctx }) {
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
