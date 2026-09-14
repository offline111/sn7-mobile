import React, { useState } from "react";
import {
  X
} from "lucide-react";
import { departmentCovered, itemStaffIds, splitStaffIds, staffForDepartment } from "../lib/domain";
import { num } from "../lib/format";
import { NumField } from "./base";
import { inputBase } from "./theme";

// Выбор исполнителей группы: отмечаем нужных, чужой отдел — под «···».
export function PerformerPicker({ data, depId, chosen = [], onChange }) {
  const { list, exact } = staffForDepartment(data, depId);
  const [all, setAll] = useState(false);
  const shown = all ? (data.staff || []).filter((s) => s.active) : list;
  // выбранного из другого отдела всё равно показываем — иначе не снять
  const extra = (data.staff || []).filter(
    (s) => chosen.includes(s.id) && !shown.some((x) => x.id === s.id));

  const toggle = (id) => onChange(
    chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {chosen.length === 0 && (
        <span className="text-xs text-amber-600">кто делал?</span>
      )}
      {[...shown, ...extra].map((s) => {
        const on = chosen.includes(s.id);
        return (
          <button key={s.id} onClick={() => toggle(s.id)} type="button"
            className={`rounded-full border px-2 py-0.5 text-xs transition ${
              on ? "border-blue-700 bg-blue-50 text-blue-900"
                 : "border-slate-200 text-slate-500 hover:border-slate-400"}`}>
            {on ? "✓ " : ""}{s.name}
          </button>
        );
      })}
      {exact && !all && (
        <button type="button" onClick={() => setAll(true)} title="Показать всех сотрудников"
          className="rounded px-1 text-xs text-slate-400 hover:text-blue-700">···</button>
      )}
      {chosen.length > 1 && (
        <span className="text-xs text-slate-400">делят поровну</span>
      )}
    </div>
  );
}

export function ItemSplit({ data, item, items = [], index, money, onChange }) {
  const line = num(item.price) * num(item.qty || 1);
  const coveredIdx = departmentCovered(data, items, item.splitDep, index);
  const covered = coveredIdx != null && coveredIdx >= 0;

  if (!item.splitDep) {
    return (
      <button type="button"
        onClick={() => onChange({ splitDep: (data.departments || [])[0]?.id || "",
                                  splitAmount: "", splitStaffIds: [] })}
        className="ml-1 text-xs text-slate-400 hover:text-blue-700">
        + работа другого отдела
      </button>
    );
  }

  const amount = Math.min(num(item.splitAmount), line);
  const rest = line - amount;

  return (
    <div className="mt-1 space-y-1 rounded-lg border border-dashed border-slate-300 px-2 py-1.5">
      {covered && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-amber-700">
          <span>
            В заказе уже есть «{items[coveredIdx]?.name}» того же отдела — подготовка
            оплачена ею{amount > 0 ? ", иначе отдел получит дважды" : ""}.
          </span>
          {amount > 0 ? (
            <button type="button" onClick={() => onChange({ splitAmount: 0 })}
              className="rounded-full border border-amber-300 px-2 py-0.5 hover:bg-amber-100">
              убрать долю
            </button>
          ) : (
            <span className="text-slate-400">доля обнулена</span>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select value={item.splitDep} onChange={(e) => onChange({ splitDep: e.target.value })}
          className={`${inputBase} w-40 shrink-0`}>
          {(data.departments || []).map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <NumField value={item.splitAmount ?? ""} onChange={(v) => onChange({ splitAmount: v })}
          step={100} min={0} max={line} placeholder="сумма"
          wrapClass="w-28 shrink-0" className={`${inputBase} w-full text-right font-mono`} />
        {money && (
          <span className="text-xs text-slate-500">
            из {money(line)} · отделу {money(amount)}, исполнителю {money(rest)}
          </span>
        )}
        <button type="button"
          onClick={() => onChange({ splitDep: null, splitAmount: null, splitStaffIds: [] })}
          className="ml-auto rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
          <X size={14} />
        </button>
      </div>

      <PerformerPicker data={data} depId={item.splitDep}
        chosen={splitStaffIds(item)}
        onChange={(ids) => onChange({ splitStaffIds: ids })} />
    </div>
  );
}

export function GroupAssign({ data, items, idxs, depId, money, onPatchItems,
                      byItem, onToggleByItem, withHours = true }) {
  // Позиции группы могут быть на разных людях: один мастер работает
  // в двух отделах, и в одном заказе делает мойку, а в другом полировку.
  const mixed = new Set(idxs.map((i) => itemStaffIds(items[i]).slice().sort().join(","))).size > 1;

  const chosen = (() => {
    const first = itemStaffIds(items[idxs[0]]);
    // если у позиций внутри группы разный состав, показываем объединение
    const all = new Set();
    idxs.forEach((i) => itemStaffIds(items[i]).forEach((s) => all.add(s)));
    return all.size ? [...all] : first;
  })();

  const groupHours = idxs.reduce((s, i) => s + num(items[i].hours), 0);
  const groupSum = idxs.reduce(
    (s, i) => s + num(items[i].price) * num(items[i].qty || 1), 0);

  const setStaff = (ids) => onPatchItems(idxs, () => ({ staffIds: ids }));

  const setHours = (value) => {
    const total = value === "" ? null : Math.max(0, Number(value) || 0);
    onPatchItems(idxs, (it) => {
      if (total === null) return { hours: "" };
      const w = groupSum > 0 ? (num(it.price) * num(it.qty || 1)) / groupSum : 1 / idxs.length;
      return { hours: Math.round(total * w * 100) / 100 };
    });
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
      {byItem ? (
        <span className="text-xs text-slate-500">
          Исполнители указаны у каждой услуги отдельно
        </span>
      ) : (
        <PerformerPicker data={data} depId={depId} chosen={chosen} onChange={setStaff} />
      )}

      {idxs.length > 1 && (
        <button type="button" onClick={onToggleByItem}
          title={byItem ? "Вернуться к общему выбору на всю группу"
                        : "Назначить исполнителей отдельно для каждой услуги"}
          className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-500 hover:border-blue-700 hover:text-blue-700">
          {byItem ? "общий выбор" : "по услугам"}
        </button>
      )}
      {mixed && !byItem && (
        <span className="text-xs text-amber-600" title="У позиций разные исполнители">
          состав различается
        </span>
      )}

      {withHours && (
        <div className="ml-auto flex items-center gap-1">
          <NumField value={groupHours || ""} onChange={setHours} step={0.5} min={0}
            placeholder="часы" wrapClass="w-24 shrink-0"
            className={`${inputBase} w-full text-right font-mono`} />
          <span className="text-xs text-slate-400">ч</span>
        </div>
      )}
      {money && <span className="font-mono text-xs text-slate-500">{money(groupSum)}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Деньги заказа по людям                                             */
/*                                                                     */
/*  Наёмный мастер получает свою долю зарплатного фонда. Собственник    */
/*  забирает полную стоимость услуг, которые сделал сам. На прибыль    */
/*  компании его доход не влияет: она считается как выручка минус фонд  */
/*  наёмных мастеров.                                                  */
/* ------------------------------------------------------------------ */
