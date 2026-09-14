import React, { useState } from "react";
import {
  Check, Pencil, Plus, Trash2, X
} from "lucide-react";
import { api } from "../lib/api";
import { fmt, num, uid } from "../lib/format";
import { Btn, Field, Modal } from "../ui/base";
import { inputBase, inputCls } from "../ui/theme";

export function ServicesView(ctx) {
  const { data, patch, cur, setServiceModal } = ctx;
  const [newCat, setNewCat] = useState("");
  const [note, setNote] = useState("");

  const addCategory = () => {
    if (!newCat.trim()) return;
    const c = { id: uid("cat"), name: newCat.trim() };
    api.saveCategory(c).then(() => patch((d) => ({ ...d, categories: [...d.categories, c] }))).catch(console.warn);
    setNewCat("");
  };
  const removeCategory = (id) => {
    if (data.services.some((s) => s.categoryId === id)) {
      setNote("Сначала уберите услуги из этого направления — тогда его можно удалить.");
      return;
    }
    setNote("");
    api.deleteCategory(id).then(() => patch((d) => ({ ...d, categories: d.categories.filter((c) => c.id !== id) }))).catch(console.warn);
  };
  const toggle = (id) => {
    const svc = data.services.find((s) => s.id === id);
    if (!svc) return;
    const updated = { ...svc, active: !svc.active };
    api.saveService(updated).catch(console.warn);
    patch((d) => ({ ...d, services: d.services.map((s) => (s.id === id ? updated : s)) }));
  };
  const removeService = (id) => {
    api.deleteService(id).catch(console.warn);
    patch((d) => ({ ...d, services: d.services.filter((s) => s.id !== id) }));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Прайс</h1>
          <p className="text-sm text-slate-500">Цены задаются отдельно для каждого класса авто</p>
        </div>
        <Btn kind="primary" onClick={() => setServiceModal({})}><Plus size={16} />Услуга</Btn>
      </div>

      {data.categories.map((cat) => {
        const items = data.services.filter((s) => s.categoryId === cat.id);
        return (
          <div key={cat.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">{cat.name}</h2>
              <button onClick={() => removeCategory(cat.id)} className="ml-auto text-slate-400 hover:text-rose-600"><X size={15} /></button>
            </div>
            <div className="scroll-slim overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 font-semibold">Услуга</th>
                    {data.classes.map((c) => <th key={c.id} className="px-3 py-2 text-right font-semibold">{c.name}</th>)}
                    <th className="px-3 py-2 text-right font-semibold">Время</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr><td colSpan={data.classes.length + 3} className="px-4 py-3 text-xs text-slate-400">Здесь пока пусто</td></tr>
                  )}
                  {items.map((s) => (
                    <tr key={s.id} className={`border-t border-slate-100 ${s.active ? "" : "opacity-40"}`}>
                      <td className="px-4 py-2 font-medium">
                        {s.name}
                        {(s.splits || []).length > 0 && (
                          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                            title="Часть цены уходит другому отделу">
                            + {(data.departments || []).find(
                                 (d) => d.id === s.splits[0].depId)?.name || "отдел"}
                          </span>
                        )}
                      </td>
                      {data.classes.map((c) => (
                        <td key={c.id} className="px-3 py-2 text-right font-mono">
                          {s.priceKind === "on_request"
                            ? <span className="text-xs text-slate-400">после осмотра</span>
                            : s.prices[c.id]
                              ? `${s.priceKind === "from" ? "от " : ""}${fmt(s.prices[c.id])}`
                              : "—"}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-mono text-xs text-slate-500">{s.duration} мин</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <button onClick={() => toggle(s.id)} title={s.active ? "Скрыть из заказа" : "Вернуть в прайс"}
                          className="mr-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><Check size={15} /></button>
                        <button onClick={() => setServiceModal(s)} className="mr-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><Pencil size={15} /></button>
                        <button onClick={() => removeService(s.id)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div className="flex gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-3">
        <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Новое направление: тонировка, шиномонтаж…" className={inputCls} />
        <Btn onClick={addCategory}><Plus size={15} />Добавить</Btn>
      </div>
      {note && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}
      <p className="text-xs text-slate-500">Валюта прайса: {cur}. Изменить можно в настройках.</p>
    </div>
  );
}

export function ServiceModal({ ctx, service, onClose, onSave }) {
  const { data } = ctx;
  const [f, setF] = useState(
    service || { id: uid("s"), categoryId: data.categories[0]?.id || "", name: "",
                 duration: 60, prices: {}, active: true, priceKind: "fixed" }
  );
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setPrice = (clId, v) => setF((s) => ({ ...s, prices: { ...s.prices, [clId]: num(v) } }));
  const setSplit = (i, patch) => setF((s) => {
    const splits = [...(s.splits || [])];
    splits[i] = { ...splits[i], ...patch };
    return { ...s, splits };
  });

  return (
    <Modal open onClose={onClose} title={service ? "Услуга" : "Новая услуга"}>
      <div className="space-y-4">
        <Field label="Название">
          <input value={f.name} onChange={(e) => set("name", e.target.value)} className={inputCls} placeholder="Например: керамика 2 слоя" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Отдел">
            <select value={f.departmentId || ""} onChange={(e) => set("departmentId", e.target.value)}
              className={inputCls}>
              <option value="">не задан</option>
              {(data.departments || []).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              По нему подставляются исполнители при закрытии заказа.
            </span>
          </Field>
          <Field label="Направление">
            <select value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)} className={inputCls}>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Время, мин">
            <input type="number" value={f.duration} onChange={(e) => set("duration", num(e.target.value))} className={inputCls} />
          </Field>
        </div>
        <Field label="Как показывать цену клиенту">
          <select value={f.priceKind || "fixed"} onChange={(e) => set("priceKind", e.target.value)} className={inputCls}>
            <option value="fixed">Точная цена — «4.400 RSD»</option>
            <option value="from">Ориентир — «от 20.000 RSD»</option>
            <option value="on_request">Только после осмотра</option>
          </select>
        </Field>

        {(f.priceKind || "fixed") !== "on_request" && (
          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Цена по классам
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.classes.map((c) => (
                <label key={c.id} className="block">
                  <span className="mb-1 block text-xs text-slate-500">{c.name}</span>
                  <input type="number" value={f.prices[c.id] ?? ""} onChange={(e) => setPrice(c.id, e.target.value)} className={inputCls} placeholder="0" />
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Эти цены видит клиент в Telegram — бот перечитывает прайс раз в минуту.
            </p>
          </div>
        )}

        {/* Часть цены может принадлежать другому отделу: полировка включает
            подготовительную мойку, её делают мойщики. */}
        <div>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Входит работа другого отдела
          </span>
          {(f.splits || []).map((sp, i) => (
            <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
              <select value={sp.depId || ""} onChange={(e) => setSplit(i, { depId: e.target.value })}
                className={`${inputBase} min-w-0 flex-1`}>
                <option value="">выберите отдел</option>
                {(data.departments || []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <select value={sp.kind || "fixed"} onChange={(e) => setSplit(i, { kind: e.target.value })}
                className={`${inputBase} w-28 shrink-0`}>
                <option value="fixed">сумма</option>
                <option value="percent">процент</option>
              </select>
              <input type="number" value={sp.value ?? ""}
                onChange={(e) => setSplit(i, { value: e.target.value })}
                className={`${inputBase} w-24 shrink-0 text-right font-mono`} />
              <button onClick={() => set("splits", (f.splits || []).filter((_, x) => x !== i))}
                className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                <X size={16} />
              </button>
            </div>
          ))}
          <Btn kind="quiet"
            onClick={() => set("splits", [...(f.splits || []), { kind: "fixed", value: "" }])}>
            <Plus size={14} />Добавить долю отдела
          </Btn>
          <span className="mt-1 block text-xs text-slate-500">
            Эта часть цены уйдёт в выработку выбранного отдела, а не тому, кто делал саму
            услугу. Для клиента цена не меняется.
          </span>
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
/*  Клиент — форма                                                     */
/* ------------------------------------------------------------------ */
