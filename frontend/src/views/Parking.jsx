import React, { useState } from "react";
import {
  Plus, Trash2
} from "lucide-react";
import { api } from "../lib/api";
import { SOON_DAYS, barLabel } from "../lib/domain";
import { carLabel, daysBetween, humanDate, num, shiftDays, toLocal, uid } from "../lib/format";
import { Btn, Empty, Field, Modal, NumField, Plate, Stat } from "../ui/base";
import { inputCls } from "../ui/theme";

export function ParkingView(ctx) {
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

export function RentModal({ ctx, spot, onClose }) {
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

export function SpotsEditor({ ctx, spots, state, setNote, onRent }) {
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

export function ParkingStats({ ctx, spots, clientById }) {
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
