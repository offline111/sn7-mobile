import React, { useState } from "react";
import {
  Check, Clock, Phone, Trash2, X
} from "lucide-react";
import { api } from "../lib/api";
import { svcName } from "../lib/domain";
import { boxColor, humanDate } from "../lib/format";
import { Btn, Empty, Plate } from "../ui/base";

export function InboxView(ctx) {
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
