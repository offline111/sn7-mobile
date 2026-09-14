import React from "react";
import {
  X
} from "lucide-react";
import { statusOf } from "../lib/domain";
import { num } from "../lib/format";

export function Plate({ value, size = "sm" }) {
  const s = size === "lg" ? "text-sm px-2 py-1" : "text-xs px-1.5 py-0.5";
  return (
    <span className={`inline-flex items-stretch overflow-hidden rounded border-2 border-slate-800 bg-white font-mono font-bold tracking-wider text-slate-900 ${s}`}>
      <span className="-my-0.5 -ml-1.5 mr-1.5 w-1.5 bg-blue-800" />
      {value || "без номера"}
    </span>
  );
}

export function Btn({ children, onClick, kind = "ghost", className = "", type = "button", title }) {
  const kinds = {
    primary: "bg-blue-800 text-white hover:bg-blue-900",
    ghost: "bg-white text-slate-700 border border-slate-300 hover:border-slate-500",
    quiet: "text-slate-500 hover:text-slate-900 hover:bg-slate-100",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
  };
  return (
    <button type={type} title={title} onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${kinds[kind]} ${className}`}>
      {children}
    </button>
  );
}

export function Field({ label, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900 bg-opacity-40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className={`max-h-full w-full scroll-slim overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl ${wide ? "sm:max-w-3xl" : "sm:max-w-xl"}`}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// Числовое поле со своими стрелками: системные мелкие и не вписываются
// в оформление. Шаг и границы задаются как у обычного input.
export function NumField({ value, onChange, step = 1, min, max,
                   className = "", wrapClass = "", ...rest }) {
  const bump = (dir) => {
    const cur = Number(value);
    const base = isNaN(cur) ? 0 : cur;
    let next = Math.round((base + dir * step) * 100) / 100;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    onChange(String(next));
  };

  return (
    // обёртка держит ширину в строке, оформление остаётся на самом поле
    <span className={`num-field ${wrapClass}`}>
      <input type="number" value={value} step={step} min={min} max={max}
        className={className}
        onChange={(e) => onChange(e.target.value)} {...rest} />
      <span className="num-steps">
        <button type="button" tabIndex={-1} onClick={() => bump(1)} aria-label="больше">▲</button>
        <button type="button" tabIndex={-1} onClick={() => bump(-1)} aria-label="меньше">▼</button>
      </span>
    </span>
  );
}

export function StatusChip({ id }) {
  const s = statusOf(id);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />{s.label}
    </span>
  );
}

export function Stat({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Empty({ text, action }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-sm text-slate-500">{text}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Приложение                                                         */
/* ------------------------------------------------------------------ */
