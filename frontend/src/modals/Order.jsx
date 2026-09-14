import React, { useState } from "react";
import {
  Clock, Plus, Trash2, Users, X
} from "lucide-react";
import { api } from "../lib/api";
import { STATUSES, groupItemsByDepartment, isRollback, itemStaffIds, splitAmountFor, splitStaffIds, statusOf } from "../lib/domain";
import { carLabel, fmt, humanDate, num, toLocal, uid } from "../lib/format";
import { Btn, Field, Modal, NumField, Plate } from "../ui/base";
import { GroupAssign, ItemSplit, PerformerPicker } from "../ui/pickers";
import { inputBase, inputCls } from "../ui/theme";

/* ------------------------------------------------------------------ */
/*  Откат стадии назад                                                  */
/* ------------------------------------------------------------------ */
export function RollbackModal({ order, to, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const label = { booked: "Записан", work: "В работе", done: "Готов", issued: "Выдан" };

  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      await api.rollbackOrder(order.id, to, reason.trim());
      await onDone();
    } catch (e) {
      setErr("Не удалось: " + e.message);
      setBusy(false);
    }
  };

  const willNotify = reason.trim().length > 0;

  return (
    <Modal open onClose={onClose} title={`Вернуть заказ №${order.n} на «${label[to] || to}»`}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Заказ уходит со стадии «{label[order.status] || order.status}» назад
          на «{label[to] || to}». Опишите причину, если о ней стоит знать клиенту.
        </p>

        <Field label="Причина отката">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            className={inputCls} autoFocus
            placeholder="Например: обнаружены сколы под плёнкой, работы продлятся ещё день" />
        </Field>

        <p className={`text-sm ${willNotify ? "text-amber-600" : "text-slate-500"}`}>
          {willNotify
            ? "Клиент получит это сообщение в Telegram."
            : "Поле пустое — клиенту ничего не отправим, стадия просто вернётся назад. "
              + "Так задумано: случайное нажатие не должно тревожить владельца машины."}
        </p>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind={willNotify ? "primary" : "ghost"} onClick={go}
            className={busy ? "opacity-60 pointer-events-none" : ""}>
            {busy ? "Возвращаю…" : willNotify ? "Вернуть и сообщить клиенту" : "Вернуть молча"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Этапы работы: «В работе» и «Готов»                                  */
/*  Оба перехода требуют данных от мастера, поэтому идут через форму,   */
/*  а не простым нажатием на доске.                                     */
/* ------------------------------------------------------------------ */
export function StageModal({ ctx, order, stage, onClose, onDone }) {
  const { data, money, carById, clientById } = ctx;
  const isStart = stage === "work";

  const [items, setItems] = useState(
    (order.items || []).map((i) => ({ ...i, qty: i.qty || 1 })));
  const [box, setBox] = useState(order.box || data.boxes?.[0]?.id || "");
  const [readyAt, setReadyAt] = useState(order.readyAt || plusHours(4));
  const [plate, setPlate] = useState(carById[order.carId]?.plate || "");
  const [hours, setHours] = useState(suggestHours());
  const [byItemDeps, setByItemDeps] = useState({});
  const toggleByItem = (key) => setByItemDeps((s) => ({ ...s, [key]: !s[key] }));
  const [dups, setDups] = useState(null);       // найденные похожие карточки
  const [dupChecked, setDupChecked] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const car = carById[order.carId];
  const client = clientById[order.clientId];
  const catalog = (data.services || []).filter((s) => s.active);
  const total = items.reduce((a, i) => a + (Number(i.price) || 0) * (i.qty || 1), 0)
    - (order.discount || 0);

  function plusHours(h) {
    const d = new Date();
    d.setHours(d.getHours() + h);
    return toLocal(d);
  }

  // Только «Комплекс (3 фазы)» и ничего больше. От этого зависят две вещи:
  // автоматический подсчёт часов и то, требовать ли госномер.
  // Объявлено функцией, а не стрелкой: suggestHours() зовёт её ещё при
  // создании состояния, до этой строки. С const это давало ошибку
  // и белый экран при переводе заказа в «Готов».
  function isWashOnly(list) {
    return list.length > 0 && list.every((i) => {
      const svc = (data.services || []).find((x) => x.id === i.serviceId);
      return svc && svc.service_key === "ext1";
    });
  }

  // Точное время считаем только для мойки: там работа идёт подряд
  // и укладывается в один день. Во всех остальных случаях цифру
  // ставит мастер — календарное время ничего не сказало бы о труде.
  function suggestHours() {
    if (!order.workStartedAt) return "";
    if (!isWashOnly(order.items || [])) return "";
    const start = new Date(order.workStartedAt.replace(" ", "T"));
    const diff = (Date.now() - start.getTime()) / 3600000;
    return diff > 0 && diff < 24 ? diff.toFixed(1) : "";
  }

  const setItem = (idx, patchObj) =>
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patchObj } : it)));
  const dropItem = (idx) => setItems(items.filter((_, i) => i !== idx));
  // назначение мастеров и часов сразу на всю группу услуг
  const patchItems = (idxs, make) =>
    setItems(items.map((it, i) => (idxs.includes(i) ? { ...it, ...make(it) } : it)));
  const addFromCatalog = (svc) => {
    const size = car?.classId || car?.size || "";
    const prices = svc.prices || {};
    setItems([...items, {
      serviceId: svc.id, name: svc.name,
      price: prices[size] ?? 0, qty: 1,
    }]);
  };
  const addCustom = () => setItems([...items, { serviceId: null, name: "", price: 0, qty: 1 }]);

  const submit = async () => {
    setErr("");
    if (isStart) {
      if (items.length === 0) return setErr("Добавьте хотя бы одну услугу.");
      if (items.some((i) => !String(i.name || "").trim()))
        return setErr("У каждой позиции должно быть название.");
      if (!readyAt) return setErr("Укажите срок готовности.");
      if (new Date(readyAt.replace(" ", "T")) <= new Date())
        return setErr("Срок готовности должен быть позже текущего времени.");
      if (!box) return setErr("Выберите бокс.");
      // Госномер обязателен: по нему машина ищется в базе и по нему же
      // проверяется, не заводим ли мы того же клиента второй раз.
      if (!plate.trim()) return setErr("Укажите госномер — без него нельзя начать работу.");

      // Похожие карточки показываем один раз: мастер либо объединяет,
      // либо подтверждает, что это разные люди.
      if (!dupChecked) {
        try {
          const q = `?plate=${encodeURIComponent(plate.trim())}` +
            `&phone=${encodeURIComponent(client?.phone || "")}` +
            `&name=${encodeURIComponent(client?.name || "")}` +
            `&exclude=${order.clientId || 0}`;
          const found = await ctx.api.similarClients(q);
          setDupChecked(true);
          if (found.length) { setDups(found); return; }
        } catch (e) {
          setDupChecked(true);   // проверка не удалась — не держим мастера
        }
      }
    } else {
      // Без исполнителя заказ закрывать нельзя: иначе выработку опять
      // придётся делить поровну и правда о том, кто что делал, теряется.
      const empty = groupItemsByDepartment(data, items)
        .filter((g) => g.idxs.every((i) => itemStaffIds(items[i]).length === 0));
      if (empty.length) {
        return setErr("Укажите исполнителей: " + empty.map((g) => g.name).join(", ") + ".");
      }
      if (hours !== "" && !(Number(hours) >= 0)) {
        return setErr("Часы указаны неверно.");
      }
    }
    setBusy(true);
    try {
      if (isStart) {
        await api.startOrder(order.id, { items, box, readyAt, plate: plate.trim() });
      } else {
        await api.finishOrder(order.id, { items, hoursSpent: hours === "" ? null : Number(hours) });
      }
      await onDone();
    } catch (e) {
      setErr("Не удалось сохранить: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose}
      title={isStart ? `Начало работ — заказ №${order.n}` : `Работа завершена — заказ №${order.n}`}>
      {dups && (
        <div className="mb-4 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="text-sm text-amber-900">
            Похоже, этот клиент уже есть в базе. Совпадение по номеру, телефону или имени —
            проверьте, прежде чем заводить второго.
          </div>

          <div className="space-y-2">
            {dups.map((c) => (
              <div key={c.id} className="rounded-lg border border-amber-200 bg-white p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name || "без имени"}</span>
                  {c.phone && <span className="font-mono text-xs text-slate-500">{c.phone}</span>}
                  {c.tgId ? (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                      Telegram
                    </span>
                  ) : null}
                  <span className="ml-auto text-xs text-slate-500">{c.orders} заказ(ов)</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {c.cars.map((car, x) => (
                    <span key={x} className="text-xs text-slate-600">
                      {car.plate ? <Plate value={car.plate} /> : null} {car.title}
                    </span>
                  ))}
                </div>
                <div className="mt-1 text-xs text-amber-800">{c.reasons.join(", ")}</div>
                <div className="mt-2">
                  <Btn onClick={async () => {
                    try {
                      await ctx.api.mergeClients({ keepId: c.id, dropId: order.clientId });
                      await ctx.reload();
                      setDups(null);
                    } catch (e) { setErr(e.message); }
                  }}>
                    <Users size={15} />Это он — объединить карточки
                  </Btn>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Btn kind="quiet" onClick={() => setDups(null)}>Это разные люди, продолжить</Btn>
          </div>
        </div>
      )}
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          {/* Имя ведёт в карточку клиента: с этапа часто нужно посмотреть
              историю визитов или позвонить. */}
          {client ? (
            <button type="button"
              onClick={() => { onClose(); ctx.setClientCard(order.clientId); }}
              className="font-semibold text-blue-800 hover:underline">
              {client.name || "без имени"}
            </button>
          ) : (
            <div className="font-semibold">Клиент удалён</div>
          )}
          <div className="text-slate-600">{carLabel(car) || "марка не указана"}</div>
        </div>

        {isStart && (
          <Field label="Госномер">
            <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="BG 123 AB" className={`${inputCls} font-mono uppercase`} />
            <p className={`mt-1 text-xs ${plate.trim() ? "text-slate-400" : "text-amber-600"}`}>
              {plate.trim()
                ? "Номер сохранится в карточке машины и проверится по базе."
                : "Без номера начать работу нельзя: по нему машина ищется в базе."}
            </p>
          </Field>
        )}

        {isStart && (
          <p className="text-xs text-slate-500">
            Клиент получит перечень работ с ценой по каждой позиции и срок готовности.
          </p>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Услуги и цены</span>
            <button onClick={addCustom} className="text-xs font-medium text-blue-800">+ Своя строка</button>
          </div>
          <div className="space-y-2">
            {groupItemsByDepartment(data, items).map((g) => (
              <div key={g.depId || "none"} className="mb-2 rounded-lg border border-slate-200 p-2">
                <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {g.name}
                </div>
                {g.idxs.map((idx) => {
                  const it = items[idx];
                  return (
                    <div key={idx} className="mb-1 flex flex-wrap items-center gap-2">
                      <input value={it.name} onChange={(e) => setItem(idx, { name: e.target.value })}
                        placeholder="Название услуги" className={`${inputBase} min-w-0 flex-1`} />
                      <NumField value={it.qty} min={1}
                        onChange={(v) => setItem(idx, { qty: Math.max(1, +v || 1) })}
                        wrapClass="w-16 shrink-0"
                        className={`${inputBase} w-full text-center`} />
                      <input type="number" value={it.price}
                        onChange={(e) => setItem(idx, { price: +e.target.value || 0 })}
                        className={`${inputBase} w-24 shrink-0 text-right`} />
                      <button onClick={() => dropItem(idx)} className="text-slate-400 hover:text-red-600">
                        <X size={16} />
                      </button>
                      {byItemDeps[g.depId || "none"] && (
                        <div className="w-full pl-1">
                          <PerformerPicker data={data} depId={g.depId}
                            chosen={itemStaffIds(it)}
                            onChange={(ids) => setItem(idx, { staffIds: ids })} />
                        </div>
                      )}
                      <div className="w-full">
                        <ItemSplit data={data} item={it} items={items} index={idx} money={money}
                          onChange={(patch) => patchItems([idx], () => patch)} />
                      </div>
                    </div>
                  );
                })}
                {/* На старте назначаем людей, часы вносим при сдаче работы */}
                <GroupAssign data={data} items={items} idxs={g.idxs} depId={g.depId}
                  money={money} onPatchItems={patchItems} withHours={!isStart}
                  byItem={!!byItemDeps[g.depId || "none"]}
                  onToggleByItem={() => toggleByItem(g.depId || "none")} />
              </div>
            ))}
            {items.length === 0 && (
              <p className="py-2 text-center text-xs text-slate-400">услуг пока нет</p>
            )}
          </div>

          <div className="mt-2 max-h-32 scroll-slim overflow-y-auto rounded-lg bg-slate-50 p-2">
            <div className="flex flex-wrap gap-1">
              {catalog.map((svc) => (
                <button key={svc.id} onClick={() => addFromCatalog(svc)}
                  className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs hover:border-blue-800">
                  {svc.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isStart ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Field label="Бокс">
              <select value={box} onChange={(e) => setBox(e.target.value)} className={inputCls}>
                <option value="">не выбран</option>
                {(data.boxes || []).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              </Field>
              <p className="mt-1 text-xs text-slate-400">Бокс будет занят в календаре до срока готовности.</p>
            </div>
            <div>
              <Field label="Готово к">
                <input type="datetime-local" value={readyAt}
                  onChange={(e) => setReadyAt(e.target.value)} className={inputCls} />
              </Field>
              <div className="mt-1 flex flex-wrap gap-1">
                {[["+2 ч", 2], ["+4 ч", 4], ["+8 ч", 8], ["завтра", 24]].map(([lbl, h]) => (
                  <button key={lbl} onClick={() => setReadyAt(plusHours(h))}
                    className="rounded-md border border-slate-200 px-2 py-0.5 text-xs hover:border-blue-800">
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <Field label="Затрачено часов">
              <input type="number" step="0.5" min="0" value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="например 5.5" className={`${inputCls} w-40`} />
            </Field>
            <p className="mt-1 text-xs text-slate-400">
              Для мойки подставляется автоматически, в остальных случаях впишите сами.
              Можно оставить пустым и заполнить позже.
            </p>
          </div>
        )}

        {err && <p className="text-sm text-red-600">{err}</p>}

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <div>
            <div className="text-xs text-slate-500">К оплате</div>
            <div className="font-mono text-lg font-bold">{money(Math.max(total, 0))}</div>
          </div>
          <div className="flex gap-2">
            <Btn onClick={onClose}>Отмена</Btn>
            <Btn kind="primary" onClick={submit}
              className={busy ? "opacity-60 pointer-events-none" : ""}>
              {busy ? "Сохраняю…" : isStart ? "Начать работу" : "Работа готова"}
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function OrderModal({ ctx, order, presetClientId, onClose, onSave, onSaveClient, onDelete }) {
  const { data, money, carById } = ctx;
  const presetClient = data.clients.find((c) => c.id === presetClientId);
  const [mode, setMode] = useState("exist");
  const [err, setErr] = useState("");
  const [clientId, setClientId] = useState(order ? order.clientId : presetClient ? presetClient.id : "");
  const [carId, setCarId] = useState(order ? order.carId : presetClient?.cars[0]?.id || "");
  const [newC, setNewC] = useState({ name: "", phone: "", plate: "", make: "", model: "", classId: data.classes[0]?.id });
  const [f, setF] = useState(
    // staffIds у заказа не держим: состав собирается из исполнителей услуг
    order
      ? { ...order, staffIds: undefined }
      : {
          id: uid("o"), clientId: "", carId: "",
          // Заявку завёл администратор — значит, студия её уже взяла.
          // «Записан» остаётся для того, что приходит из бота само.
          date: toLocal(new Date()), status: "accepted", items: [], discount: 0,
          comment: "", createdAt: toLocal(new Date()),
        }
  );
  const [q, setQ] = useState("");
  // Группы, где исполнителей назначают по каждой услуге отдельно:
  // мастер может числиться сразу в нескольких отделах.
  const [byItemDeps, setByItemDeps] = useState({});
  const toggleByItem = (key) => setByItemDeps((s) => ({ ...s, [key]: !s[key] }));

  const client = data.clients.find((c) => c.id === clientId);
  const car = carById[carId];
  const classId = car ? car.classId : newC.classId;

  const priceOf = (s) => s.prices[classId] ?? Object.values(s.prices)[0] ?? 0;
  const addItem = (s) => setF((o) => {
    const item = { serviceId: s.id, name: s.name, price: priceOf(s), qty: 1 };
    // правило доли переносим в заказ: цена услуги потом может измениться
    const rule = (s.splits || [])[0];
    if (rule?.depId) {
      item.splitDep = rule.depId;
      item.splitAmount = splitAmountFor(item, s);
      item.splitStaffIds = [];
    }
    let items = [...o.items, item];

    // Добавили полноценную услугу отдела — подготовка внутри других услуг
    // становится лишней: отдел не должен получить за одну работу дважды.
    if (s.departmentId) {
      items = items.map((it, i) =>
        i !== items.length - 1 && it.splitDep === s.departmentId && num(it.splitAmount) > 0
          ? { ...it, splitAmount: 0 }
          : it);
    }
    return { ...o, items };
  });
  const addCustom = () => setF((o) => ({ ...o, items: [...o.items, { serviceId: null, name: "", price: 0, qty: 1 }] }));
  const setItem = (i, k, v) => setF((o) => { const items = [...o.items]; items[i] = { ...items[i], [k]: v }; return { ...o, items }; });
  const dropItem = (i) => setF((o) => ({ ...o, items: o.items.filter((_, x) => x !== i) }));
  // правка сразу нескольких позиций: назначение мастеров на группу услуг
  const patchItems = (idxs, make) => setF((o) => ({
    ...o,
    items: o.items.map((it, x) => (idxs.includes(x) ? { ...it, ...make(it) } : it)),
  }));

  // Скидка — процент. Старые заказы хранят её суммой, поэтому значение
  // больше 100 считаем наследием и в расчёт не берём, пока мастер не поправит.
  const subtotal = f.items.reduce((s, i) => s + num(i.price) * num(i.qty || 1), 0);
  const discountPct = Math.min(Math.max(num(f.discount), 0), 100);
  const total = Math.round(subtotal * (1 - discountPct / 100));
  const dur = f.items.reduce((s, i) => {
    const sv = data.services.find((x) => x.id === i.serviceId);
    return s + (sv ? sv.duration * num(i.qty || 1) : 0);
  }, 0);

  const matches = data.clients.filter((c) => {
    const s = q.trim().toLowerCase();
    if (!s) return false;
    return ((c.name || "") + (c.phone || "") + c.cars.map((x) => x.plate || "").join(" ")).toLowerCase().includes(s);
  }).slice(0, 5);

  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setErr("");
    if (f.items.length === 0) { setErr("Добавьте хотя бы одну услугу — нажмите на неё в прайсе ниже."); return; }
    if (mode === "new" && !order && !newC.name.trim() && !newC.plate.trim()) {
      setErr("Для нового клиента нужно имя или госномер."); return;
    }
    if (mode === "exist" && !clientId) { setErr("Выберите клиента или переключитесь на «Новый»."); return; }
    // Откат стадии делается только на «Смене»: там спрашивают причину,
    // а отсюда он ушёл бы молча, и клиент ничего не узнал бы.
    if (order && isRollback(order.status, f.status)) {
      setErr(`Вернуть заказ на «${statusOf(f.status).label}» можно на «Смене» — там спросят причину.`);
      return;
    }

    setSaving(true);
    try {
      if (mode === "new" && !order) {
        const newCar = { plate: newC.plate.toUpperCase(), make: newC.make, model: newC.model, color: "", classId: newC.classId };
        const c = { name: newC.name.trim() || newC.plate.toUpperCase(), phone: newC.phone, source: "", note: "", cars: [newCar] };
        // Клиента и машину сначала сохраняем, и только потом создаём заказ:
        // заказу нужны НАСТОЯЩИЕ id из базы, иначе внешний ключ не сойдётся.
        const res = await onSaveClient(c);
        if (!res || !res.id) throw new Error("сервер не вернул id клиента");
        await onSave({ ...f, clientId: res.id, carId: (res.cars && res.cars[0]) || null });
        return;
      }
      await onSave({ ...f, clientId, carId: carId || client?.cars[0]?.id || null });
    } catch (e) {
      setErr("Не удалось сохранить: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={order ? `Заказ №${order.n}` : "Новый заказ"} wide>
      <div className="space-y-5">
        {/* клиент */}
        {!order && (
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="mb-3 flex gap-2">
              <button onClick={() => setMode("exist")}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "exist" ? "bg-blue-800 text-white" : "bg-slate-100 text-slate-600"}`}>Постоянный</button>
              <button onClick={() => setMode("new")}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "new" ? "bg-blue-800 text-white" : "bg-slate-100 text-slate-600"}`}>Новый</button>
            </div>

            {mode === "exist" ? (
              <div className="space-y-2">
                {client ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold">{client.name}</span>
                    <span className="font-mono text-xs text-slate-500">{client.phone}</span>
                    <button onClick={() => { setClientId(""); setCarId(""); }} className="text-xs text-blue-800 hover:underline">сменить</button>
                    <div className="w-full">
                      <Field label="Авто">
                        <select value={carId} onChange={(e) => setCarId(e.target.value)} className={inputCls}>
                          {client.cars.map((c) => <option key={c.id} value={c.id}>{c.plate} · {c.make} {c.model}</option>)}
                        </select>
                      </Field>
                    </div>
                  </div>
                ) : (
                  <div>
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Начните вводить имя, телефон или номер" className={inputCls} />
                    <div className="mt-1 space-y-1">
                      {matches.map((c) => (
                        <button key={c.id} onClick={() => { setClientId(c.id); setCarId(c.cars[0]?.id || ""); setQ(""); }}
                          className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-blue-700">
                          <span className="font-medium">{c.name}</span>
                          <span className="font-mono text-xs text-slate-500">{c.phone}</span>
                          {c.cars[0] && <span className="ml-auto"><Plate value={c.cars[0].plate} /></span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                <input value={newC.name} onChange={(e) => setNewC({ ...newC, name: e.target.value })} placeholder="Имя" className={inputCls} />
                <input value={newC.phone} onChange={(e) => setNewC({ ...newC, phone: e.target.value })} placeholder="Телефон" className={inputCls} />
                <input value={newC.plate} onChange={(e) => setNewC({ ...newC, plate: e.target.value.toUpperCase() })} placeholder="Госномер" className={`${inputCls} font-mono`} />
                <input value={newC.make} onChange={(e) => setNewC({ ...newC, make: e.target.value })} placeholder="Марка" className={inputCls} />
                <input value={newC.model} onChange={(e) => setNewC({ ...newC, model: e.target.value })} placeholder="Модель" className={inputCls} />
                <select value={newC.classId} onChange={(e) => setNewC({ ...newC, classId: e.target.value })} className={inputCls}>
                  {data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {order && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3">
            {/* Имя ведёт в карточку клиента: из заказа часто нужно
                посмотреть историю или позвонить. */}
            <button type="button"
              onClick={() => { onClose(); ctx.setClientCard(order.clientId); }}
              className="font-semibold text-blue-800 hover:underline">
              {ctx.clientById[order.clientId]?.name || "—"}
            </button>
            {ctx.clientById[order.clientId]?.phone && (
              <a href={`tel:${ctx.clientById[order.clientId].phone.replace(/\s/g, "")}`}
                className="font-mono text-xs text-slate-500 hover:text-blue-800">
                {ctx.clientById[order.clientId].phone}
              </a>
            )}
            {carById[order.carId] && <Plate value={carById[order.carId].plate} size="lg" />}
            <span className="ml-auto text-xs text-slate-500">создан {humanDate(order.createdAt)}</span>
          </div>
        )}

        {/* услуги */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Услуги</span>
            <Btn kind="quiet" onClick={addCustom}><Plus size={14} />Своя строка</Btn>
          </div>
          <div className="space-y-2">
            {groupItemsByDepartment(data, f.items).map((g) => (
              <div key={g.depId || "none"} className="rounded-lg border border-slate-200 p-2">
                <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {g.name}
                </div>
                {g.idxs.map((i) => {
                  const it = f.items[i];
                  return (
                    <div key={i} className="mb-1 flex flex-wrap items-center gap-2">
                      <input value={it.name} onChange={(e) => setItem(i, "name", e.target.value)} className={`${inputBase} min-w-0 flex-1`} placeholder="Название" />
                      <NumField value={it.qty} onChange={(v) => setItem(i, "qty", num(v))} min={1}
                        wrapClass="w-16 shrink-0"
                        className={`${inputBase} w-full text-center font-mono`} />
                      <input type="number" value={it.price} onChange={(e) => setItem(i, "price", num(e.target.value))} className={`${inputBase} w-24 shrink-0 text-right font-mono`} />
                      <button onClick={() => dropItem(i)} className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><X size={16} /></button>
                      {byItemDeps[g.depId || "none"] && (
                        <div className="w-full pl-1">
                          <PerformerPicker data={data} depId={g.depId}
                            chosen={itemStaffIds(it)}
                            onChange={(ids) => setItem(i, "staffIds", ids)} />
                        </div>
                      )}
                      <div className="w-full">
                        <ItemSplit data={data} item={it} items={f.items} index={i} money={money}
                          onChange={(patch) => patchItems([i], () => patch)} />
                      </div>
                    </div>
                  );
                })}
                <GroupAssign data={data} items={f.items} idxs={g.idxs} depId={g.depId}
                  money={money} onPatchItems={patchItems}
                  byItem={!!byItemDeps[g.depId || "none"]}
                  onToggleByItem={() => toggleByItem(g.depId || "none")} />
              </div>
            ))}
          </div>

          <div className="mt-3 max-h-44 scroll-slim overflow-y-auto rounded-lg border border-slate-200 p-2">
            {data.categories.map((cat) => {
              const items = data.services.filter((s) => s.categoryId === cat.id && s.active);
              if (!items.length) return null;
              return (
                <div key={cat.id} className="mb-2">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{cat.name}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((s) => (
                      <button key={s.id} onClick={() => addItem(s)}
                        className="chip-pick rounded-full border px-2.5 py-1 text-xs">
                        {s.name} <span className="font-mono text-slate-500">{fmt(priceOf(s))}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* параметры */}
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Дата и время">
            <input type="datetime-local" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={inputCls} />
          </Field>
          {/* Общего списка мастеров больше нет: исполнителей выбирают
              в группах услуг выше, а состав заказа собирается из них. */}
          <Field label="Статус">
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className={inputCls}>
              {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Скидка, %">
            <input type="number" min="0" max="100" value={f.discount}
              onChange={(e) => setF({ ...f, discount: Math.min(100, Math.max(0, num(e.target.value))) })}
              className={`${inputCls} font-mono`} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Бокс">
            <select value={f.box || ""} onChange={(e) => setF({ ...f, box: e.target.value })} className={inputCls}>
              <option value="">не выбран</option>
              {(data.boxes || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Комментарий">
          <textarea value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} rows={2} className={inputCls}
            placeholder="Что просил клиент, повреждения при приёмке…" />
        </Field>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">К оплате</div>
            <div className="font-mono text-2xl font-bold">{money(total)}</div>
            {discountPct > 0 && (
              <div className="text-xs text-slate-500">
                скидка {discountPct}% — минус {money(subtotal - total)}
              </div>
            )}
            {num(f.discount) > 100 && (
              <div className="text-xs text-amber-600">
                В поле скидки {num(f.discount)} — похоже, старое значение суммой. Впишите процент.
              </div>
            )}
            {dur > 0 && (
              <div className="flex items-center gap-1 text-xs text-slate-500"><Clock size={12} />≈ {Math.floor(dur / 60)} ч {dur % 60} мин работы</div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3">
            {err && <span className="max-w-xs text-xs font-medium text-rose-600">{err}</span>}
            {/* Удаление только у существующего заказа: новый удалять нечего */}
            {order && onDelete && (
              <button
                onClick={() => {
                  if (window.confirm(`Удалить заказ №${order.n}? Отменить это будет нельзя.`)) {
                    onDelete(order.id);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium
                  text-rose-600 transition hover:bg-rose-50">
                <Trash2 size={15} />Удалить
              </button>
            )}
            <Btn onClick={onClose}>Отмена</Btn>
            <Btn kind="primary" onClick={submit} className={saving ? "opacity-60 pointer-events-none" : ""}>
              {saving ? "Сохраняю…" : "Сохранить заказ"}
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Отчёты                                                             */
/* ------------------------------------------------------------------ */
