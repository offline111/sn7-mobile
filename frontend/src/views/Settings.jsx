import React, { useState, useEffect } from "react";
import {
  Check, Download, Pencil, Plus, Trash2
} from "lucide-react";
import { api, setToken } from "../lib/api";
import { BOX_PALETTE, boxColor, humanDate, uid } from "../lib/format";
import { Btn, Field, Modal, NumField } from "../ui/base";
import { inputBase, inputCls } from "../ui/theme";
import { SuppliersEditor } from "./Stock";

/* ------------------------------------------------------------------ */
/*  Боксы: названия и цвета                                            */
/*  Список приходит из прайса бота, но названия и цвета живут здесь.    */
/*  Синхронизация только добавляет недостающие боксы и правки не трёт.  */
/* ------------------------------------------------------------------ */
export function BoxesEditor({ data, patch }) {
  const boxes = data.boxes || [];
  const [newName, setNewName] = useState("");
  const [openFor, setOpenFor] = useState(null);

  const save = (list) => {
    patch((d) => ({ ...d, boxes: list, settings: { ...d.settings, boxes: JSON.stringify(list) } }));
    api.saveSettings({ boxes: JSON.stringify(list) }).catch(console.warn);
  };

  const update = (id, changes) => save(boxes.map((b) => (b.id === id ? { ...b, ...changes } : b)));

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const add = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    // ключ бокса — латиницей: он уходит в календарь и в прайс бота
    const base = "box_" + Math.random().toString(36).slice(2, 7);
    const used = boxes.map((b) => b.color).filter(Boolean);
    const free = BOX_PALETTE.find((p) => !used.includes(p.hex)) || BOX_PALETTE[0];

    setBusy(true);
    setNote("");
    try {
      // сервер попросит бота завести календарь: сама CRM в Google не ходит
      const res = await api.saveBox({ id: base, name, withCalendar: true });
      save([...boxes, { id: base, name, color: free.hex,
                        calendar_id: res?.calendar?.calendar_id || "" }]);
      setNote(res?.calendar?.ok
        ? `Календарь «${name}» создан и открыт для ${res.calendar.shared_with}. ` +
          `Добавьте его у себя: Google Calendar → «Другие календари» → «Подписаться по ID».`
        : "Бокс добавлен, но календарь создать не удалось — проверьте, что бот запущен.");
      setNewName("");
    } catch (e) {
      setNote("Не удалось сохранить бокс.");
    } finally {
      setBusy(false);
    }
  };

  const makeCalendar = async (b) => {
    setBusy(true); setNote("");
    try {
      const res = await api.saveBox({ id: b.id, name: b.name, withCalendar: true });
      if (res?.calendar?.ok) {
        update(b.id, { calendar_id: res.calendar.calendar_id });
        setNote(`Календарь создан и открыт для ${res.calendar.shared_with}.`);
      } else {
        setNote("Календарь создать не удалось — проверьте, что бот запущен.");
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b) => {
    if (!window.confirm(`Удалить бокс «${b.name}»? Календарь в Google останется — ` +
      `в нём история записей.`)) return;
    try {
      await api.deleteBox(b.id);
      save(boxes.filter((x) => x.id !== b.id));
    } catch (e) {
      setNote("Бокс не удалён: в нём есть незакрытые заказы.");
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold">Боксы</h3>
      <p className="text-sm text-slate-500">
        По цвету бокса подсвечиваются карточки на «Смене» и строки в «Заказах».
        Список приходит из прайса бота — названия и цвета правятся здесь и не затираются.
      </p>

      <div className="space-y-2">
        {boxes.map((b) => (
          <div key={b.id} className="rounded-lg border border-slate-200 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setOpenFor(openFor === b.id ? null : b.id)}
                className="h-8 w-8 shrink-0 rounded-lg border border-slate-300"
                style={{ background: boxColor(b.id, data) }} title="Выбрать цвет" />
              <input value={b.name} onChange={(e) => update(b.id, { name: e.target.value })}
                className={`${inputBase} min-w-0 flex-1`} placeholder="Название бокса" />
              <span className="font-mono text-xs text-slate-400">{b.id}</span>
              {b.calendar_id
                ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800"
                        title={b.calendar_id}>календарь есть</span>
                : <button onClick={() => makeCalendar(b)} disabled={busy}
                    className="chip-pick rounded-full border px-2 py-0.5 text-xs">
                    завести календарь
                  </button>}
              <button onClick={() => remove(b)} title="Удалить бокс"
                className="px-2 text-rose-500 transition hover:text-rose-700">
                <Trash2 size={15} />
              </button>
            </div>

            {openFor === b.id && (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
                {BOX_PALETTE.map((c) => (
                  <button key={c.id} title={c.name}
                    onClick={() => { update(b.id, { color: c.hex }); setOpenFor(null); }}
                    className={`h-7 w-7 rounded-md border-2 transition
                      ${boxColor(b.id, data) === c.hex ? "border-slate-900" : "border-transparent"}`}
                    style={{ background: c.hex }} />
                ))}
              </div>
            )}
          </div>
        ))}

        {boxes.length === 0 && (
          <p className="text-sm text-slate-400">
            Боксов пока нет. Добавьте вручную или запустите sync_catalog.py — он подтянет их из прайса бота.
          </p>
        )}
      </div>

      {note && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}

      <div className="flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Название нового бокса" className={inputCls} />
        <Btn onClick={add} className={busy ? "opacity-60" : ""}>
          <Plus size={15} />{busy ? "Создаю…" : "Добавить"}
        </Btn>
      </div>
    </div>
  );
}

export function SettingsView(ctx) {
  const { data, patch, setData, setView, theme, setTheme, reload, api } = ctx;
  const [className, setClassName] = useState("");
  const [wipe, setWipe] = useState(false);

  const setS = (k, v) => {
    patch((d) => ({ ...d, settings: { ...d.settings, [k]: v } }));
    api.saveSettings({ [k]: v }).catch(console.warn);
  };

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-xl font-bold">Настройки</h1>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold">Заведение</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Название"><input value={data.settings.company} onChange={(e) => setS("company", e.target.value)} className={inputCls} /></Field>
          <Field label="Фонд мастеров, %">
            <NumField value={data.settings.payroll_percent ?? 25}
              onChange={(v) => setS("payroll_percent", v)} step={1} min={0} max={100}
              wrapClass="w-full" className={`${inputCls} font-mono`} />
            <span className="mt-1 block text-xs text-slate-500">
              Эту долю от суммы заказа делят между собой мастера. Остальное — прибыль студии.
            </span>
          </Field>
          <Field label="Валюта"><input value={data.settings.currency} onChange={(e) => setS("currency", e.target.value)} className={inputCls} /></Field>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold">Оформление</h3>
        <p className="text-sm text-slate-500">
          Тема сохраняется в настройках студии — значит одинакова на всех устройствах,
          где открыта CRM.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { id: "light", label: "Светлая", hint: "для дневного света в боксе",
              swatch: ["#f2f1ec", "#ffffff", "#5468e6", "#2f2f2f"] },
            { id: "dark", label: "Тёмная", hint: "как на сайте студии",
              swatch: ["#2f2f2f", "#3d4046", "#5468e6", "#f1f0ec"] },
          ].map((opt) => (
            <button key={opt.id} onClick={() => setTheme(opt.id)}
              className={`rounded-xl border p-3 text-left transition
                ${theme === opt.id ? "border-blue-700 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{opt.label}</span>
                {theme === opt.id && <Check size={14} className="text-blue-800" />}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{opt.hint}</div>
              <div className="mt-2 flex gap-1">
                {opt.swatch.map((c, i) => (
                  <span key={i} className="h-5 w-8 rounded"
                    style={{ background: c, border: "1px solid rgba(0,0,0,0.12)" }} />
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>

      <BoxesEditor data={data} patch={patch} />

      <DepartmentsEditor data={data} api={api} reload={reload} />

      <SuppliersEditor data={data} api={api} reload={reload} />

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold">Классы автомобилей</h3>
        <p className="text-xs text-slate-500">По ним считается цена в прайсе. Добавите класс — в услугах появится новая колонка.</p>
        <div className="space-y-2">
          {data.classes.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <input value={c.name}
                onChange={(e) => patch((d) => ({ ...d, classes: d.classes.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)) }))}
                className={inputCls} />
              <button onClick={() => patch((d) => ({ ...d, classes: d.classes.filter((x) => x.id !== c.id) }))}
                className="rounded p-2 text-slate-400 hover:text-rose-600"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={className} onChange={(e) => setClassName(e.target.value)} placeholder="Например: пикап, микроавтобус" className={inputCls} />
          <Btn onClick={() => { if (className.trim()) { patch((d) => ({ ...d, classes: [...d.classes, { id: uid("cl"), name: className.trim() }] })); setClassName(""); } }}>
            <Plus size={15} />Добавить
          </Btn>
        </div>
      </div>

      {ctx.can("settings.users") && <UsersEditor ctx={ctx} />}

      <PasswordCard ctx={ctx} />

      <div className="space-y-3 rounded-xl border border-rose-200 bg-white p-4">
        <h3 className="text-sm font-bold">Данные</h3>
        <p className="text-xs text-slate-500">База хранится в этом приложении и остаётся между сессиями.</p>
        <div className="flex flex-wrap gap-2">
          <Btn onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
            const a = document.createElement("a"); a.href = url; a.download = "crm-backup.json"; a.click(); URL.revokeObjectURL(url);
          }}><Download size={15} />Скачать резервную копию</Btn>
          {ctx.can("settings.wipe") && (
            <Btn kind="danger" onClick={() => setWipe(true)}>
              <Trash2 size={15} />Очистить базу
            </Btn>
          )}
        </div>
      </div>

      {wipe && <WipeModal ctx={ctx} onClose={() => setWipe(false)} />}
    </div>
  );
}

export function DepartmentsEditor({ data, api, reload }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const list = data.departments || [];
  const staff = (data.staff || []).filter((s) => s.active);

  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setNote("");
    try {
      await api.saveDepartment({ name: name.trim() });
      await reload();
      setName("");
    } finally { setBusy(false); }
  };

  const rename = async (d, value) => {
    await api.saveDepartment({ id: d.id, name: value });
    await reload();
  };

  const toggleStaff = async (d, sid) => {
    const next = d.staffIds.includes(sid)
      ? d.staffIds.filter((x) => x !== sid)
      : [...d.staffIds, sid];
    await api.saveDepartment({ id: d.id, name: d.name, staffIds: next });
    await reload();
  };

  const remove = async (d) => {
    setNote("");
    try {
      await api.deleteDepartment(d.id);
      await reload();
    } catch (e) {
      setNote(`Отдел «${d.name}» не удалён: к нему привязаны услуги. Переназначьте их в прайсе.`);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold">Отделы</h3>
      <p className="text-sm text-slate-500">
        Мойщики, полировщики, детейлеры. Услуга привязывается к отделу в прайсе, и при
        закрытии заказа CRM предлагает исполнителей именно из него.
      </p>

      {note && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{note}</p>}

      <div className="space-y-3">
        {list.map((d) => {
          const services = (data.services || []).filter((s) => s.departmentId === d.id);
          return (
            <div key={d.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-2">
                <input value={d.name} onChange={(e) => rename(d, e.target.value)}
                  className={`${inputCls} font-medium`} />
                <button onClick={() => remove(d)}
                  className="rounded p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                  <Trash2 size={15} />
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {staff.length === 0 && <span className="text-xs text-slate-400">сотрудников нет</span>}
                {staff.map((s) => {
                  const on = d.staffIds.includes(s.id);
                  return (
                    <button key={s.id} onClick={() => toggleStaff(d, s.id)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition ${
                        on ? "border-blue-700 bg-blue-50 text-blue-900"
                           : "border-slate-200 text-slate-500 hover:border-slate-400"}`}>
                      {on ? "✓ " : ""}{s.name}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 text-xs text-slate-500">
                {services.length
                  ? `Услуг в отделе: ${services.length}`
                  : "Услуги пока не привязаны — сделайте это в разделе «Услуги»."}
              </div>
            </div>
          );
        })}
        {list.length === 0 && <p className="text-sm text-slate-400">Отделов пока нет.</p>}
      </div>

      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Например: полировщики" className={inputCls} />
        <Btn onClick={add} className={busy ? "opacity-60" : ""}>
          <Plus size={15} />Добавить
        </Btn>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Загруженность: часы по мастерам и отделам                          */
/*  Плюс заказы, где исполнители не проставлены — их надо закрыть.     */
/* ------------------------------------------------------------------ */

export function UsersEditor({ ctx }) {
  const { me, data, api } = ctx;
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("users");
  const [userForm, setUserForm] = useState(null);
  const [err, setErr] = useState("");

  const load = () => api.users().then(setState).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (!state) return <p className="text-sm text-slate-400">Загружаю пользователей…</p>;

  const saveUser = async (u) => {
    setErr("");
    try {
      await api.saveUser(u);
      await load();
      setUserForm(null);
    } catch (e) { setErr(e.message); }
  };

  const removeUser = async (u) => {
    setErr("");
    try { await api.deleteUser(u.id); await load(); }
    catch (e) { setErr(e.message); }
  };

  const togglePerm = async (role, perm) => {
    const next = role.permissions.includes(perm)
      ? role.permissions.filter((p) => p !== perm)
      : [...role.permissions, perm];
    setErr("");
    try { await api.saveRole({ ...role, permissions: next }); await load(); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold">Пользователи и роли</h3>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {[["users", `Люди · ${state.users.length}`], ["roles", `Роли · ${state.roles.length}`]]
            .map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  tab === id ? "bg-white shadow-sm" : "text-slate-600"}`}>
                {label}
              </button>
            ))}
        </div>
      </div>

      <p className="text-sm text-slate-500">
        Права управляют только доступом к разделам CRM. На отделы, выработку и деньги
        они не влияют — это разные вещи.
      </p>

      {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}

      {tab === "users" ? (
        <div className="space-y-2">
          {state.users.map((u) => (
            <div key={u.id}
              className={`flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2.5 ${
                u.active ? "" : "opacity-50"}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{u.name || u.login}</span>
                  <span className="font-mono text-xs text-slate-500">{u.login}</span>
                  {u.id === me.id && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">это вы</span>
                  )}
                  {!u.active && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">отключён</span>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  {u.roleName || "роль не назначена"}
                  {u.lastSeen ? ` · заходил ${humanDate(u.lastSeen)}` : " · ещё не заходил"}
                </div>
              </div>
              <Btn kind="quiet" onClick={() => setUserForm(u)}><Pencil size={15} /></Btn>
              <Btn kind="quiet" onClick={() => removeUser(u)}><Trash2 size={15} /></Btn>
            </div>
          ))}

          <Btn onClick={() => setUserForm({ active: true, roleId: "washers" })}>
            <Plus size={15} />Добавить пользователя
          </Btn>
        </div>
      ) : (
        <div className="space-y-3">
          {state.roles.map((role) => (
            <div key={role.id} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-medium">{role.name}</span>
                <span className="text-xs text-slate-500">
                  {role.users} человек(а)
                  {role.system && " · права менять нельзя"}
                </span>
                {!role.system && role.users === 0 && (
                  <button onClick={async () => {
                    setErr("");
                    try { await api.deleteRole(role.id); await load(); }
                    catch (e) { setErr(e.message); }
                  }} className="ml-auto rounded p-1 text-slate-400 hover:text-rose-600">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

              {role.system ? (
                <p className="text-xs text-slate-500">Полный доступ ко всем разделам.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {state.catalog.map((g) => (
                    <div key={g.group}>
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {g.group}
                      </div>
                      {g.items.map(([key, label]) => (
                        <label key={key}
                          className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-sm row-hover">
                          <input type="checkbox" checked={role.permissions.includes(key)}
                            onChange={() => togglePerm(role, key)}
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-blue-800" />
                          <span className="leading-tight">{label}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          <AddRole api={api} onSaved={load} setErr={setErr} />
        </div>
      )}

      {userForm && (
        <UserModal ctx={ctx} user={userForm.id ? userForm : null} draft={userForm}
          roles={state.roles} onClose={() => setUserForm(null)} onSave={saveUser} />
      )}
    </div>
  );
}

export function AddRole({ api, onSaved, setErr }) {
  const [name, setName] = useState("");
  return (
    <div className="flex gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Новая роль: например, приёмщики" className={inputCls} />
      <Btn onClick={async () => {
        if (!name.trim()) return;
        setErr("");
        try { await api.saveRole({ name: name.trim(), permissions: [] }); setName(""); await onSaved(); }
        catch (e) { setErr(e.message); }
      }}><Plus size={15} />Добавить</Btn>
    </div>
  );
}

export function UserModal({ ctx, user, draft, roles, onClose, onSave }) {
  const { data } = ctx;
  const [f, setF] = useState(user || draft || { active: true });
  const [password, setPassword] = useState("");
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  return (
    <Modal open onClose={onClose} title={user ? f.login : "Новый пользователь"}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Логин">
            <input value={f.login || ""} onChange={(e) => set("login", e.target.value)}
              className={inputCls} placeholder="latinicej" />
          </Field>
          <Field label="Имя">
            <input value={f.name || ""} onChange={(e) => set("name", e.target.value)}
              className={inputCls} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Роль">
            <select value={f.roleId || ""} onChange={(e) => set("roleId", e.target.value)}
              className={inputCls}>
              <option value="">без роли</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Сотрудник">
            <select value={f.staffId || ""} onChange={(e) => set("staffId", e.target.value)}
              className={inputCls}>
              <option value="">не связан</option>
              {(data.staff || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              Связь только для удобства: на права и выработку не влияет.
            </span>
          </Field>
        </div>

        <Field label={user ? "Новый пароль (пусто — не менять)" : "Пароль"}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className={inputCls} />
        </Field>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active !== false}
            onChange={(e) => set("active", e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-blue-800" />
          Доступ разрешён
        </label>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Btn onClick={onClose}>Отмена</Btn>
          <Btn kind="primary" onClick={() => onSave({ ...f, password: password || undefined })}>
            Сохранить
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Очистка базы: вопрос, затем пароль суперадмина                     */
/* ------------------------------------------------------------------ */

export function WipeModal({ ctx, onClose }) {
  const { api, reload } = ctx;
  const [step, setStep] = useState(1);
  const [scope, setScope] = useState("orders");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await api.wipe({ password, scope });
      await reload();
      setStep(3);
      setErr("");
      setPassword("");
      setBusy(false);
      setTimeout(onClose, 1500);
    } catch (e) {
      setErr(e.message || "Не удалось очистить");
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Очистка базы">
      {step === 3 ? (
        <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">Готово, база очищена.</p>
      ) : step === 1 ? (
        <div className="space-y-4">
          <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
            Действие необратимое. Резервной копии не создаётся — если она нужна,
            закройте окно и сначала скачайте её кнопкой рядом.
          </p>

          <Field label="Что удалить">
            <select value={scope} onChange={(e) => setScope(e.target.value)} className={inputCls}>
              <option value="orders">Только заказы</option>
              <option value="all">Заказы, клиентов, машины и заявки</option>
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              Прайс, сотрудники, отделы, боксы и склад остаются в любом случае.
            </span>
          </Field>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <Btn onClick={onClose}>Отмена</Btn>
            <Btn kind="danger" onClick={() => setStep(2)}>Да, продолжить</Btn>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Подтвердите паролем суперадмина <b>admin</b>.
          </p>
          <Field label="Пароль суперадмина">
            <input type="password" value={password} autoFocus
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()} className={inputCls} />
          </Field>

          {err && <p className="text-sm font-medium text-rose-600">{err}</p>}

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <Btn onClick={() => setStep(1)}>Назад</Btn>
            <Btn kind="danger" onClick={run} className={busy ? "opacity-60" : ""}>
              <Trash2 size={15} />{busy ? "Удаляю…" : "Удалить безвозвратно"}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* Смена собственного пароля — доступна любому, кто вошёл. */
export function PasswordCard({ ctx }) {
  const { me, weakAdmin, api } = ctx;
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const save = async () => {
    setErr(""); setMsg("");
    try {
      await api.changePassword({ current, password: next });
      setMsg("Пароль изменён. На других устройствах придётся войти заново.");
      setCurrent(""); setNext(""); setOpen(false);
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold">Мой доступ</h3>
      <p className="text-sm text-slate-500">
        Вы вошли как <b>{me.name || me.login}</b> · {me.roleName || "без роли"}
      </p>

      {weakAdmin && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          У суперадмина стоит пароль по умолчанию. Смените его — сейчас в CRM
          может зайти любой, кто знает адрес.
        </p>
      )}

      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{msg}</p>}
      {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}

      {open ? (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Текущий пароль">
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
                className={inputCls} />
            </Field>
            <Field label="Новый пароль">
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()} className={inputCls} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setOpen(false)}>Отмена</Btn>
            <Btn kind="primary" onClick={save}>Сменить</Btn>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Btn onClick={() => setOpen(true)}>Сменить пароль</Btn>
          <Btn onClick={async () => {
            try { await api.logout(); } catch (e) { /* всё равно выходим */ }
            setToken("");
            window.dispatchEvent(new Event("crm-logout"));
          }}>Выйти</Btn>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Прогноз: деньги, которые ещё не стали выручкой                     */
/* ------------------------------------------------------------------ */
