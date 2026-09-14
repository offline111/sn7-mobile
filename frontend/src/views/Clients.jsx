import React, { useState } from "react";
import {
  Pencil, Phone, Plus, Send, Trash2, Users
} from "lucide-react";
import { API, api } from "../lib/api";
import { carLabel, daysBetween, humanDate, toLocal, uid } from "../lib/format";
import { Btn, Empty, Field, Modal, Plate, Stat } from "../ui/base";
import { inputCls } from "../ui/theme";

export function ClientsView(ctx) {
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

export function ClientCard({ ctx, id, onClose }) {
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

export function ClientModal({ ctx, client, onClose, onSave }) {
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

export function MessageModal({ ctx, target, onClose }) {
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

export function DuplicateHint({ ctx }) {
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
