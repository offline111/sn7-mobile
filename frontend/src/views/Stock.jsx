import React, { useState, useEffect } from "react";
import {
  ChevronRight, Download, Pencil, Plus, ShoppingCart, Trash2, TrendingDown, TrendingUp, X
} from "lucide-react";
import { api } from "../lib/api";
import { PERIOD_OPTIONS, STOCK_CATEGORIES, STOCK_UNITS } from "../lib/domain";
import { boxName, num, shiftDays, toLocal } from "../lib/format";
import { Btn, Empty, Field, Modal, Stat } from "../ui/base";
import { inputBase, inputCls } from "../ui/theme";

export function StockView(ctx) {
  const { data, money, api, reload } = ctx;
  const [tab, setTab] = useState("stock");        // stock | buy | log
  const [itemModal, setItemModal] = useState(null);
  const [moveModal, setMoveModal] = useState(null);
  const [q, setQ] = useState("");
  const [openCat, setOpenCat] = useState(null);   // раскрытая категория
  const [catEdit, setCatEdit] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [catNote, setCatNote] = useState("");

  const items = data.stockItems || [];
  const low = items.filter((i) => i.active && i.minQty > 0 && i.qty <= i.minQty);
  const stockValue = items.reduce((s, i) => s + (i.qty || 0) * (i.price || 0), 0);
  const spent30 = items.reduce((s, i) => s + (i.spent30 || 0) * (i.price || 0), 0);

  const shown = items.filter((i) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return ((i.name || "") + (i.category || "")).toLowerCase().includes(s);
  });

  // Категории приходят из настроек, плюс те, что уже стоят у позиций:
  // так ничего не потеряется, даже если категорию убрали из списка.
  const cats = [...new Set([
    ...(data.stockCategories || []),
    ...items.map((i) => i.category || "Прочее"),
  ])];

  const byCat = {};
  const byCatAll = {};
  cats.forEach((c) => { byCat[c] = []; byCatAll[c] = []; });
  shown.forEach((i) => (byCat[i.category || "Прочее"] ||= []).push(i));
  items.forEach((i) => (byCatAll[i.category || "Прочее"] ||= []).push(i));

  const catSum = (c) => (byCat[c] || []).reduce((s, i) => s + (i.qty || 0) * (i.price || 0), 0);

  const saveCats = async (list) => {
    setCatNote("");
    try {
      await api.saveStockCategories(list);
      await reload();
    } catch (e) {
      setCatNote("Не удалось сохранить: " + e.message);
    }
  };

  const addCat = () => {
    const name = newCat.trim();
    if (!name || cats.includes(name)) { setNewCat(""); return; }
    saveCats([...(data.stockCategories || cats), name]);
    setNewCat("");
  };

  const removeCat = (c, used) => {
    if (used > 0) {
      setCatNote(`В «${c}» ${used} позиц. — сначала перенесите их в другую категорию.`);
      return;
    }
    saveCats((data.stockCategories || cats).filter((x) => x !== c));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Склад</h1>
        <div className="flex gap-2">
          <Btn onClick={() => setItemModal({})}><Plus size={15} />Позиция</Btn>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Позиций" value={items.length} />
        <Stat label="Склад на сумму" value={money(stockValue)} />
        <Stat label="Израсходовано за 30 дней" value={money(spent30)} />
        <Stat label="Пора купить" value={low.length}
          sub={low.length ? "ниже точки заказа" : "всё в норме"} />
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-white p-1">
        {[["stock", "Остатки"], ["buy", `Закупить${low.length ? " · " + low.length : ""}`],
          ["boxes", "Боксы"], ["log", "Движения"]]
          .map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === id ? "bg-blue-800 text-white" : "text-slate-600"}`}>
              {label}
            </button>
          ))}
      </div>

      {tab === "stock" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по названию или категории"
              className={`${inputBase} min-w-0 flex-1`} />
            {openCat && (
              <Btn onClick={() => setOpenCat(null)}>← Все категории</Btn>
            )}
          </div>

          {/* Кнопки категорий: быстрый переход, не листая страницу */}
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setOpenCat(null)}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                !openCat ? "border-blue-700 bg-blue-50 text-blue-900"
                         : "chip-pick"}`}>
              Все · {shown.length}
            </button>
            {cats.map((c) => {
              const list = byCat[c] || [];
              const lowN = list.filter((i) => i.minQty > 0 && i.qty <= i.minQty).length;
              return (
                <button key={c} onClick={() => setOpenCat(c)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    openCat === c ? "border-blue-700 bg-blue-50 text-blue-900" : "chip-pick"}`}>
                  {c} · {list.length}
                  {lowN > 0 && <span className="ml-1 text-amber-600">▲{lowN}</span>}
                </button>
              );
            })}
            <button onClick={() => setCatEdit(!catEdit)}
              className="rounded-full border border-dashed px-2.5 py-1 text-xs chip-pick">
              {catEdit ? "готово" : "+ категория"}
            </button>
          </div>

          {catEdit && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex gap-2">
                <input value={newCat} onChange={(e) => setNewCat(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCat()}
                  placeholder="Например: полироли" className={inputCls} />
                <Btn onClick={addCat}><Plus size={15} />Добавить</Btn>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cats.map((c) => {
                  const used = (byCatAll[c] || []).length;
                  return (
                    <span key={c}
                      className="flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-xs">
                      {c} <span className="text-slate-400">{used}</span>
                      <button onClick={() => removeCat(c, used)}
                        className="text-slate-400 hover:text-rose-600"><X size={12} /></button>
                    </span>
                  );
                })}
              </div>
              {catNote && <p className="text-xs text-amber-700">{catNote}</p>}
            </div>
          )}

          {items.length === 0 ? (
            <Empty text="Склад пуст. Заведите первую позицию — например, шампунь или полироль."
              action={<Btn kind="primary" onClick={() => setItemModal({})}><Plus size={15} />Позиция</Btn>} />
          ) : openCat ? (
            /* Раскрытая категория: подробный список на всю ширину */
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">{openCat}</h2>
                <span className="text-xs text-slate-500">
                  {(byCat[openCat] || []).length} позиц. на {money(catSum(openCat))}
                </span>
              </div>
              {(byCat[openCat] || []).map((i) => <StockRow key={i.id} ctx={ctx} item={i}
                onMove={setMoveModal} onEdit={setItemModal} />)}
              {(byCat[openCat] || []).length === 0 && (
                <p className="px-4 py-3 text-sm text-slate-400">В этой категории пока пусто.</p>
              )}
            </div>
          ) : (
            /* Плитка категорий: несколько в ряд, клик раскрывает целиком */
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {cats.filter((c) => (byCat[c] || []).length).map((c) => {
                const list = byCat[c];
                const lowList = list.filter((i) => i.minQty > 0 && i.qty <= i.minQty);
                return (
                  <div key={c} onClick={() => setOpenCat(c)} role="button" tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && setOpenCat(c)}
                    className="row-hover cursor-pointer rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">{c}</h2>
                      <span className="font-mono text-sm font-bold">{money(catSum(c))}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {list.length} позиц.
                      {lowList.length > 0 && (
                        <span className="text-amber-600"> · {lowList.length} заканчивается</span>
                      )}
                    </div>

                    <div className="mt-2 space-y-1">
                      {list.slice(0, 4).map((i) => {
                        const isLow = i.minQty > 0 && i.qty <= i.minQty;
                        return (
                          <div key={i.id} className="flex items-baseline justify-between gap-2 text-sm">
                            <span className="min-w-0 truncate">{i.name}</span>
                            <span className={`shrink-0 font-mono text-xs ${isLow ? "text-amber-700" : "text-slate-500"}`}>
                              {i.qty} {i.unit}
                            </span>
                          </div>
                        );
                      })}
                      {list.length > 4 && (
                        <div className="text-xs text-slate-400">и ещё {list.length - 4}…</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "buy" && <BuyList ctx={ctx} low={low} onMove={(m) => setMoveModal(m)} />}
      {tab === "boxes" && <BoxStock ctx={ctx} onMove={(m) => setMoveModal(m)} />}
      {tab === "log" && <StockLog ctx={ctx} />}

      {itemModal && (
        <StockItemModal ctx={ctx} item={itemModal.id ? itemModal : null}
          onClose={() => setItemModal(null)} />
      )}
      {moveModal && (
        <StockMoveModal ctx={ctx} item={moveModal.item} kind={moveModal.kind}
          preset={moveModal} onClose={() => setMoveModal(null)} />
      )}
    </div>
  );
}

/* ── Список закупки ────────────────────────────────────────── */

export function BuyList({ ctx, low, onMove }) {
  const { data, money } = ctx;
  const suppliers = data.suppliers || [];

  if (low.length === 0) {
    return <Empty text="Всё в наличии. Позиции появятся здесь, когда остаток опустится до точки заказа." />;
  }

  // сколько взять: до двойного минимума — запас на смену вперёд
  const need = (i) => Math.max(i.minQty * 2 - i.qty, i.minQty || 1);
  const total = low.reduce((s, i) => s + need(i) * (i.price || 0), 0);

  const bySupplier = {};
  low.forEach((i) => {
    const key = i.supplierId || "—";
    (bySupplier[key] = bySupplier[key] || []).push(i);
  });

  const copyList = () => {
    const lines = low.map((i) => `${i.name} — ${need(i)} ${i.unit}`).join("\n");
    navigator.clipboard?.writeText(lines);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="text-sm text-amber-900">
          К закупке <b>{low.length}</b> позиц. примерно на <b>{money(total)}</b>
        </div>
        <Btn onClick={copyList}><Download size={15} />Скопировать список</Btn>
      </div>

      {Object.entries(bySupplier).map(([sid, list]) => {
        const sup = suppliers.find((s) => s.id === sid);
        return (
          <div key={sid} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
              <ShoppingCart size={15} className="text-slate-500" />
              <h2 className="text-sm font-bold">{sup ? sup.name : "Поставщик не указан"}</h2>
              {sup?.phone && <span className="font-mono text-xs text-slate-500">{sup.phone}</span>}
              {sup?.link && (
                <a href={sup.link} target="_blank" rel="noreferrer"
                  className="text-xs text-blue-700 hover:underline">сайт</a>
              )}
            </div>
            {list.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{i.name}</div>
                  <div className="text-xs text-slate-500">
                    осталось {i.qty} {i.unit} при минимуме {i.minQty}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-bold">{need(i)} {i.unit}</div>
                  {i.price > 0 && (
                    <div className="text-xs text-slate-500">≈ {money(need(i) * i.price)}</div>
                  )}
                </div>
                <Btn onClick={() => onMove({ item: i, kind: "in" })}>
                  <TrendingUp size={15} />Оприходовать
                </Btn>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ── Журнал движений ───────────────────────────────────────── */

export function StockLog({ ctx }) {
  const { api, money } = ctx;
  const [rows, setRows] = useState(null);

  const [limit, setLimit] = useState(80);

  useEffect(() => {
    api.stockMoves("?limit=" + limit).then(setRows).catch(() => setRows([]));
  }, [limit]);

  if (rows === null) return <p className="text-sm text-slate-400">Загружаю журнал…</p>;
  if (rows.length === 0) return <Empty text="Движений пока не было." />;

  const KIND = {
    in: { label: "приход", cls: "bg-emerald-100 text-emerald-800", sign: "+" },
    out: { label: "списание", cls: "bg-rose-100 text-rose-700", sign: "−" },
    adjust: { label: "пересчёт", cls: "bg-slate-100 text-slate-600", sign: "=" },
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {rows.map((m) => {
        const k = KIND[m.kind] || KIND.adjust;
        return (
          <div key={m.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0">
            <span className="w-24 shrink-0 font-mono text-xs text-slate-500">
              {(m.created_at || "").slice(0, 16).replace("T", " ")}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${k.cls}`}>{k.label}</span>
            <span className="min-w-0 flex-1 truncate text-sm">
              {m.itemName}
              {m.orderN ? <span className="text-slate-500"> · заказ №{m.orderN}</span> : null}
              {m.staffName ? <span className="text-slate-500"> · {m.staffName}</span> : null}
              {m.note ? <span className="text-slate-400"> · {m.note}</span> : null}
            </span>
            <span className="font-mono text-sm font-bold">
              {k.sign}{m.qty} {m.unit}
            </span>
            {m.price ? <span className="font-mono text-xs text-slate-500">{money(m.price * m.qty)}</span> : null}
          </div>
        );
      })}

      {rows.length >= limit && (
        <button onClick={() => setLimit(limit + 120)}
          className="w-full border-t border-slate-100 px-4 py-2.5 text-sm text-blue-800 row-hover">
          Показаны последние {rows.length} — загрузить ещё
        </button>
      )}
    </div>
  );
}

/* ── Карточка позиции ──────────────────────────────────────── */

export function StockItemModal({ ctx, item, onClose }) {
  const { data, api, reload } = ctx;
  const [f, setF] = useState(item || {
    name: "", category: (data.stockCategories || STOCK_CATEGORIES)[0], unit: "шт",
    qty: 0, minQty: 0, price: 0, supplierId: "", note: "", active: true,
  });
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!(f.name || "").trim()) { setErr("Без названия позицию не найти."); return; }
    await api.saveStockItem({ ...f, name: f.name.trim() });
    await reload();
    onClose();
  };

  const remove = async () => {
    if (!confirmDel) { setConfirmDel(true); return; }
    await api.deleteStockItem(f.id);
    await reload();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={item ? "Позиция склада" : "Новая позиция"}>
      <div className="space-y-4">
        <Field label="Название">
          <input value={f.name} onChange={(e) => set("name", e.target.value)} className={inputCls}
            placeholder="Например: шампунь для бесконтактной мойки" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Категория">
            <select value={f.category || ""} onChange={(e) => set("category", e.target.value)} className={inputCls}>
              {[...new Set([...(data.stockCategories || STOCK_CATEGORIES),
                            ...(f.category ? [f.category] : [])])]
                .map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Единица">
            <select value={f.unit} onChange={(e) => set("unit", e.target.value)} className={inputCls}>
              {STOCK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
          <Field label="Цена за единицу">
            <input type="number" value={f.price} onChange={(e) => set("price", num(e.target.value))}
              className={`${inputCls} font-mono`} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={item ? "Остаток (меняется движениями)" : "Начальный остаток"}>
            <input type="number" value={f.qty} disabled={!!item}
              onChange={(e) => set("qty", num(e.target.value))}
              className={`${inputCls} font-mono ${item ? "opacity-60" : ""}`} />
          </Field>
          <Field label="Точка заказа">
            <input type="number" value={f.minQty} onChange={(e) => set("minQty", num(e.target.value))}
              className={`${inputCls} font-mono`} />
            <span className="mt-1 block text-xs text-slate-500">
              Опустится до этого значения — позиция попадёт в «Закупить».
            </span>
          </Field>
        </div>

        <Field label="Поставщик">
          <select value={f.supplierId || ""} onChange={(e) => set("supplierId", e.target.value)} className={inputCls}>
            <option value="">не указан</option>
            {(data.suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>

        <Field label="Заметка">
          <input value={f.note || ""} onChange={(e) => set("note", e.target.value)} className={inputCls}
            placeholder="Разведение, артикул, что угодно" />
        </Field>

        {err && <p className="text-sm font-medium text-rose-600">{err}</p>}

        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
          {item && (
            <Btn kind="danger" onClick={remove}>
              <Trash2 size={15} />{confirmDel ? "Удалить вместе с историей" : "Удалить"}
            </Btn>
          )}
          <div className="ml-auto flex gap-2">
            <Btn onClick={onClose}>Отмена</Btn>
            <Btn kind="primary" onClick={save}>Сохранить</Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ── Приход и списание ─────────────────────────────────────── */

export function StockMoveModal({ ctx, item, kind: initialKind, preset, onClose }) {
  const { data, api, reload, money } = ctx;
  const [kind, setKind] = useState(initialKind || "out");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState(item.price || "");
  const [orderId, setOrderId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [note, setNote] = useState("");
  const [box, setBox] = useState(preset?.box || "");
  const [err, setErr] = useState("");

  // списываем обычно на сегодняшнюю машину — показываем свежие заказы
  const recent = (data.orders || []).slice(0, 20);
  const boxes = data.boxes || [];

  const submit = async () => {
    const n = num(qty);
    if (!n && kind !== "adjust") { setErr("Укажите количество."); return; }
    if (kind === "out" && n > item.qty) {
      setErr(`На складе только ${item.qty} ${item.unit}. Сначала оприходуйте приход.`);
      return;
    }
    try {
      await api.stockMove({
        itemId: item.id, kind, qty: n,
        price: kind === "in" ? num(price) : null,
        orderId: kind === "out" && orderId ? Number(orderId) : null,
        staffId: staffId || null, note: note.trim() || null,
        box: kind === "adjust" ? null : (box || null),
      });
      await reload();
      onClose();
    } catch (e) {
      setErr("Не удалось записать движение.");
    }
  };

  const TABS = [["in", "Приход"], ["out", "Списание"], ["adjust", "Пересчёт"]];

  return (
    <Modal open onClose={onClose} title={item.name}>
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          Сейчас на складе: <b className="font-mono">{item.qty} {item.unit}</b>
          {item.minQty > 0 && <span className="text-slate-500"> · минимум {item.minQty}</span>}
        </div>

        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => { setKind(id); setErr(""); }}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${
                kind === id ? "bg-white shadow-sm" : "text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={kind === "adjust" ? `Фактически на складе, ${item.unit}` : `Сколько, ${item.unit}`}>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus
              className={`${inputCls} font-mono`} placeholder="0" />
          </Field>
          {kind === "in" && (
            <Field label="Цена за единицу">
              <input type="number" value={price} onChange={(e) => setPrice(e.target.value)}
                className={`${inputCls} font-mono`} />
              <span className="mt-1 block text-xs text-slate-500">Обновит цену позиции.</span>
            </Field>
          )}
          {kind === "out" && (
            <Field label="На заказ">
              <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className={inputCls}>
                <option value="">без привязки</option>
                {recent.map((o) => (
                  <option key={o.id} value={o.id}>
                    №{o.n} · {(o.date || "").slice(0, 10)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        {kind !== "adjust" && (
          <Field label={kind === "in" ? "В какой бокс" : "Из какого бокса"}>
            <select value={box} onChange={(e) => setBox(e.target.value)} className={inputCls}>
              <option value="">общий склад</option>
              {boxes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              По боксам считается расход химии и остаток на посту.
            </span>
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Кто">
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={inputCls}>
              <option value="">не указан</option>
              {(data.staff || []).filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Комментарий">
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls}
              placeholder="Необязательно" />
          </Field>
        </div>

        {kind === "in" && num(qty) > 0 && num(price) > 0 && (
          <p className="text-sm text-slate-600">
            Сумма прихода: <b className="font-mono">{money(num(qty) * num(price))}</b>
          </p>
        )}
        {err && <p className="text-sm font-medium text-rose-600">{err}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" onClick={submit}>Записать</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ── Поставщики (в настройках) ─────────────────────────────── */

export function SuppliersEditor({ data, api, reload }) {
  const [form, setForm] = useState(null);
  const list = data.suppliers || [];

  const save = async () => {
    if (!(form.name || "").trim()) return;
    await api.saveSupplier(form);
    await reload();
    setForm(null);
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold">Поставщики</h3>
      <p className="text-sm text-slate-500">
        Привязываются к позициям склада: в разделе «Закупить» список сам разложится по поставщикам.
      </p>

      <div className="space-y-2">
        {list.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
            <span className="font-medium">{s.name}</span>
            {s.phone && <span className="font-mono text-xs text-slate-500">{s.phone}</span>}
            {s.contact && <span className="text-xs text-slate-500">{s.contact}</span>}
            <div className="ml-auto flex gap-1">
              <button onClick={() => setForm(s)}
                className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900">
                <Pencil size={15} />
              </button>
              <button onClick={async () => { await api.deleteSupplier(s.id); await reload(); }}
                className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
        {list.length === 0 && <p className="text-sm text-slate-400">Пока никого.</p>}
      </div>

      {form ? (
        <div className="space-y-2 rounded-lg border border-slate-300 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Название" className={inputCls} />
            <input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="Телефон" className={inputCls} />
            <input value={form.contact || ""} onChange={(e) => setForm({ ...form, contact: e.target.value })}
              placeholder="Контактное лицо" className={inputCls} />
            <input value={form.link || ""} onChange={(e) => setForm({ ...form, link: e.target.value })}
              placeholder="Сайт или чат" className={inputCls} />
          </div>
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setForm(null)}>Отмена</Btn>
            <Btn kind="primary" onClick={save}>Сохранить</Btn>
          </div>
        </div>
      ) : (
        <Btn onClick={() => setForm({ name: "" })}><Plus size={15} />Добавить поставщика</Btn>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Топ клиентов: сколько принёс и за какой срок                       */
/* ------------------------------------------------------------------ */

export function BoxStock({ ctx, onMove }) {
  const { data, money, api } = ctx;
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [pickItem, setPickItem] = useState({});

  // приход или списание прямо из карточки бокса
  const moveFor = (b, kind) => {
    const item = (data.stockItems || []).find((i) => i.id === pickItem[b.id]);
    if (!item) return;
    onMove({ item, kind, box: b.id });
  };

  const from = days === 0 ? "0000-01-01" : toLocal(shiftDays(-(days - 1))).slice(0, 10);
  const to = toLocal(new Date()).slice(0, 10);

  // data меняется после каждого движения — пересчитываем и раскладку
  useEffect(() => {
    api.stockByBox(`?from=${from}&to=${to}`).then(setRows).catch(() => setRows([]));
  }, [days, data.stockItems]);

  if (rows === null) return <p className="text-sm text-slate-400">Считаю по боксам…</p>;

  const spendOf = (b) => b.spent.reduce((s, r) => s + (r.sum || 0), 0);
  const qtyOf = (b) => b.spent.reduce((s, r) => s + (r.qty || 0), 0);
  const totalSpend = rows.reduce((s, b) => s + spendOf(b), 0);
  const sorted = [...rows].sort((a, b) => spendOf(b) - spendOf(a));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-slate-500">
          Израсходовано химии за период: <b className="font-mono text-slate-700">{money(totalSpend)}</b>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {PERIOD_OPTIONS.map(([d, label]) => (
            <button key={d} onClick={() => setDays(d)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                days === d ? "bg-white shadow-sm" : "text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 && <Empty text="Движений по боксам пока не было." />}

      {sorted.map((b) => {
        const spend = spendOf(b);
        const isOpen = open === b.id;
        return (
          <div key={b.id || "none"} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <button onClick={() => setOpen(isOpen ? null : b.id)}
              className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left row-hover">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{b.name}</div>
                <div className="text-xs text-slate-500">
                  {b.orders} заказ(ов) · {b.spent.length} позиц. химии
                  {qtyOf(b) > 0 && ` · израсходовано ${Math.round(qtyOf(b) * 100) / 100} ед.`}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-lg font-bold text-emerald-700">
                  {money(b.revenue || 0)}
                </div>
                <div className="font-mono text-xs text-rose-600">− {money(spend)} химия</div>
              </div>
              <ChevronRight size={16}
                className={`text-slate-400 transition ${isOpen ? "rotate-90" : ""}`} />
            </button>

            {totalSpend > 0 && (
              <div className="h-1 bg-slate-100">
                <div className="h-1 bg-blue-800" style={{ width: (spend / totalSpend) * 100 + "%" }} />
              </div>
            )}

            {isOpen && (
              <div className="border-t border-slate-100 p-4">
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Принёс" value={money(b.revenue || 0)}
                    sub={`${b.orders} заказ(ов)`} />
                  <Stat label="Химия" value={money(spend)}
                    sub={qtyOf(b) > 0 ? `${Math.round(qtyOf(b) * 100) / 100} ед.` : null} />
                  <Stat label="Разница" value={money((b.revenue || 0) - spend)} />
                  <Stat label="Доля химии"
                    value={b.revenue > 0 ? Math.round((spend / b.revenue) * 100) + "%" : "—"}
                    sub="от выручки бокса" />
                </div>

                <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
                  <select value={pickItem[b.id] || ""}
                    onChange={(e) => setPickItem({ ...pickItem, [b.id]: e.target.value })}
                    className={`${inputBase} min-w-0 flex-1`}>
                    <option value="">выберите химию…</option>
                    {(data.stockItems || []).filter((i) => i.active).map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                  <Btn onClick={() => moveFor(b, "in")}><TrendingUp size={15} />Завести в бокс</Btn>
                  <Btn onClick={() => moveFor(b, "out")}><TrendingDown size={15} />Списать</Btn>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Израсходовано
                  </h4>
                  {b.spent.length === 0 ? (
                    <p className="text-sm text-slate-400">Ничего не списывали.</p>
                  ) : (
                    <div className="max-h-52 scroll-slim space-y-1.5 overflow-y-auto pr-1">
                      {b.spent.map((r) => (
                        <div key={r.itemId} className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate">
                            {r.name}
                            <span className="ml-1 text-xs text-slate-400">
                              {Math.round(r.qty * 100) / 100} {r.unit}
                            </span>
                          </span>
                          <span className="font-mono">{money(r.sum)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between border-t border-slate-200 pt-1.5 text-sm font-semibold">
                        <span>Итого</span>
                        <span className="font-mono">{money(spend)}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Остаток в боксе
                  </h4>
                  {b.balance.length === 0 ? (
                    <p className="text-sm text-slate-400">Пусто — химию сюда не приходовали.</p>
                  ) : (
                    <div className="max-h-52 scroll-slim space-y-1.5 overflow-y-auto pr-1">
                      {b.balance.map((r) => (
                        <div key={r.itemId} className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate">{r.name}</span>
                          <span className={`font-mono ${r.qty < 0 ? "text-rose-600" : ""}`}>
                            {Math.round(r.qty * 100) / 100} {r.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    Минус значит, что списали больше, чем приходовали в этот бокс.
                  </p>
                </div>

                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Что делали
                  </h4>
                  {b.services.length === 0 ? (
                    <p className="text-sm text-slate-400">Закрытых заказов нет.</p>
                  ) : (
                    <div className="max-h-52 scroll-slim space-y-1.5 overflow-y-auto pr-1">
                      {b.services.map((r) => (
                        <div key={r.name} className="flex items-baseline gap-3 text-sm">
                          <span className="min-w-0 flex-1 truncate">{r.name}</span>
                          <span className="w-10 shrink-0 text-right font-mono">{r.count}</span>
                          <span className="w-24 shrink-0 text-right font-mono text-xs text-slate-500">
                            {money(r.sum)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <p className="text-xs text-slate-500">
        Чтобы завести химию на пост, нажмите «приход» у позиции в «Остатках» и выберите бокс.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Вход                                                               */
/* ------------------------------------------------------------------ */

/* Строка позиции склада: используется в раскрытой категории. */
export function StockRow({ ctx, item: i, onMove, onEdit }) {
  const { data, money } = ctx;
  const isLow = i.minQty > 0 && i.qty <= i.minQty;

  return (
    <div className={`flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0
      ${i.active ? "" : "opacity-50"}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{i.name}</span>
          {isLow && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              заканчивается
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500">
          {i.price ? `${money(i.price)} за ${i.unit}` : "цена не задана"}
          {i.minQty > 0 && ` · минимум ${i.minQty} ${i.unit}`}
          {i.spent30 > 0 && ` · за 30 дней ушло ${i.spent30} ${i.unit}`}
        </div>
        {/* где лежит: на складе или разнесено по боксам */}
        <div className="mt-1 flex flex-wrap gap-1">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            склад {Math.round((i.atStore ?? i.qty) * 100) / 100} {i.unit}
          </span>
          {(i.locations || []).map((l) => (
            <span key={l.box}
              className={`rounded-full px-2 py-0.5 text-xs ${
                l.qty < 0 ? "bg-rose-100 text-rose-700" : "bg-blue-50 text-blue-800"}`}>
              {boxName(data, l.box) || l.box} {Math.round(l.qty * 100) / 100} {i.unit}
            </span>
          ))}
        </div>
      </div>

      <div className="text-right">
        <div className={`font-mono text-lg font-bold ${isLow ? "text-amber-700" : ""}`}>
          {i.qty} <span className="text-xs font-normal text-slate-400">{i.unit}</span>
        </div>
      </div>

      <div className="flex gap-1">
        <button onClick={() => onMove({ item: i, kind: "in" })}
          title="Приход" className="rounded p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-700">
          <TrendingUp size={16} />
        </button>
        <button onClick={() => onMove({ item: i, kind: "out" })}
          title="Списать" className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
          <TrendingDown size={16} />
        </button>
        <button onClick={() => onEdit(i)}
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900">
          <Pencil size={15} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Парковка                                                           */
/*  Карта мест, аренды и своя аналитика. Место занято, пока у него      */
/*  есть активная аренда — отдельного флага «занято» нет намеренно,     */
/*  иначе он рано или поздно разойдётся с реальностью.                 */
/* ------------------------------------------------------------------ */
