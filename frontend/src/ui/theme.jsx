import React, { useEffect } from "react";
import { num } from "../lib/format";
import { NumField } from "./base";

/* ------------------------------------------------------------------ */
/*  Темы оформления                                                    */
/*  Палитра взята с сайта студии. Разметка написана классами Tailwind,  */
/*  поэтому вместо правки двухсот мест переопределяем сами классы:      */
/*  так тема покрывает интерфейс целиком, включая то, что добавим позже.*/
/* ------------------------------------------------------------------ */
export const THEME_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap');

:root {
  --c-page:      #f2f1ec;
  --c-surface:   #ffffff;
  --c-surface-2: #f7f6f2;
  --c-line:      #e3e0d8;
  --c-line-2:    #d6d2c8;
  --c-text:      #2f2f2f;
  --c-text-2:    #55585e;
  --c-muted:     #86898f;
  --c-accent:    #5468e6;
  --c-accent-dk: #333f9e;
  --c-gold:      #b08d57;
  --c-danger:    #b4453f;
  --c-ok:        #4f7a6a;
  --c-warn:      #a9853f;
  --c-tint:      rgba(84,104,230,0.10);
}

[data-theme="dark"] {
  --c-page:      #2f2f2f;
  --c-surface:   #3d4046;
  --c-surface-2: #484b52;
  --c-line:      #53565e;
  --c-line-2:    #63666e;
  --c-text:      #f1f0ec;
  --c-text-2:    #d6d5d0;
  --c-muted:     #aeb1b8;
  --c-accent:    #5468e6;
  --c-accent-dk: #6d80f0;
  --c-gold:      #d4af6a;
  --c-danger:    #e0736c;
  --c-ok:        #7fb39f;
  --c-warn:      #d4af6a;
  --c-tint:      rgba(84,104,230,0.18);
}

body, .crm-root { font-family: 'Montserrat', system-ui, sans-serif; }
.crm-page { background: var(--c-page); color: var(--c-text); }

/* поверхности */
.crm-root .bg-white      { background-color: var(--c-surface); }
.crm-root .bg-slate-50   { background-color: var(--c-surface-2); }
.crm-root .bg-slate-100  { background-color: var(--c-surface-2); }
.crm-root .hover\:bg-slate-50:hover  { background-color: var(--c-surface-2); }
.crm-root .hover\:bg-slate-100:hover { background-color: var(--c-line); }

/* Подсветка кликабельных строк. Отдельный класс, а не row-hover:
   имя не пересекается с базовыми утилитами, поэтому фон всегда берётся
   из темы и текст остаётся читаемым. Полупрозрачный акцент работает
   и на светлом, и на тёмном фоне. */
.crm-root .row-hover { transition: background-color .15s ease; }
.crm-root .row-hover:hover { background-color: var(--c-tint); }

/* текст */
.crm-root .text-slate-900, .crm-root .text-slate-800 { color: var(--c-text); }
.crm-root .text-slate-700, .crm-root .text-slate-600 { color: var(--c-text-2); }
.crm-root .text-slate-500, .crm-root .text-slate-400 { color: var(--c-muted); }
.crm-root .hover\:text-slate-900:hover { color: var(--c-text); }

/* границы */
.crm-root .border-slate-100 { border-color: var(--c-line); }
.crm-root .border-slate-200 { border-color: var(--c-line); }
.crm-root .border-slate-300 { border-color: var(--c-line-2); }

/* акцент */
.crm-root .bg-blue-800   { background-color: var(--c-accent); }
.crm-root .text-blue-800, .crm-root .text-blue-700,
.crm-root .text-blue-900 { color: var(--c-accent-dk); }
.crm-root .border-blue-700, .crm-root .border-blue-800 { border-color: var(--c-accent); }
.crm-root .hover\:border-blue-700:hover,
.crm-root .hover\:border-blue-800:hover { border-color: var(--c-accent); }
.crm-root .bg-blue-50, .crm-root .bg-blue-100 { background-color: var(--c-tint); }
.crm-root .hover\:bg-blue-50:hover { background-color: var(--c-tint); }
.crm-root .ring-blue-100 { --tw-ring-color: var(--c-tint); }
.crm-root .focus\:border-blue-700:focus { border-color: var(--c-accent); }

/* Кнопки-услуги и подобные «таблетки»: при наведении подсвечиваем фон
   и обязательно задаём цвет текста. Раньше менялся только фон, и в
   тёмной теме надпись сливалась с подсветкой. */
.crm-root .chip-pick {
  border-color: var(--c-line-2);
  color: var(--c-text);
  transition: background-color .15s ease, border-color .15s ease, color .15s ease;
}
.crm-root .chip-pick:hover {
  background-color: var(--c-tint);
  border-color: var(--c-accent);
  color: var(--c-text);
}
.crm-root .chip-pick:active { background-color: var(--c-accent); color: #fff; }

/* Обрезка длинного перечня услуг на карточке доски: без неё колонка
   растягивается и стадии перестают быть одинаковой высоты. */
.crm-root .line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
/* цена внутри таблетки приглушена, но при наведении не должна пропадать */
.crm-root .chip-pick .text-slate-500 { color: var(--c-muted); }
.crm-root .chip-pick:hover .text-slate-500 { color: var(--c-text); opacity: .75; }

/* поля ввода */
.crm-root input, .crm-root select, .crm-root textarea {
  background-color: var(--c-surface);
  color: var(--c-text);
  border-color: var(--c-line-2);
}
.crm-root input::placeholder, .crm-root textarea::placeholder { color: var(--c-muted); }
[data-theme="dark"] .crm-root input[type="date"],
[data-theme="dark"] .crm-root input[type="datetime-local"] { color-scheme: dark; }

/* смысловые цвета: в тёмной теме заливки делаем прозрачными,
   иначе светлые плашки выжигают глаза */
.crm-root .text-rose-500, .crm-root .text-rose-600,
.crm-root .text-rose-700 { color: var(--c-danger); }
.crm-root .text-amber-600, .crm-root .text-amber-800,
.crm-root .text-amber-900 { color: var(--c-warn); }
.crm-root .text-emerald-800 { color: var(--c-ok); }
[data-theme="dark"] .crm-root .bg-rose-50,
[data-theme="dark"] .crm-root .bg-rose-100    { background-color: rgba(224,115,108,0.16); }
[data-theme="dark"] .crm-root .bg-amber-50,
[data-theme="dark"] .crm-root .bg-amber-100   { background-color: rgba(212,175,106,0.16); }
[data-theme="dark"] .crm-root .bg-emerald-100 { background-color: rgba(127,179,159,0.18); }
[data-theme="dark"] .crm-root .bg-cyan-100    { background-color: rgba(91,124,153,0.22); }
[data-theme="dark"] .crm-root .bg-purple-100  { background-color: rgba(154,124,170,0.20); }
[data-theme="dark"] .crm-root .text-cyan-800  { color: #8fb4d0; }
[data-theme="dark"] .crm-root .text-purple-800{ color: #c0a6d4; }
[data-theme="dark"] .crm-root .text-orange-800{ color: #e0a173; }
[data-theme="dark"] .crm-root .hover\:text-rose-600:hover,
[data-theme="dark"] .crm-root .hover\:text-rose-700:hover { color: var(--c-danger); }
[data-theme="dark"] .crm-root .hover\:bg-rose-50:hover { background-color: rgba(224,115,108,0.16); }
/* Прокрутка внутри дашбордов: тонкая полоса в цветах интерфейса.
   Появляется при наведении на блок — системный серый ползунок
   выбивался из оформления. */
.scroll-slim {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  overscroll-behavior: contain;
  transition: scrollbar-color .25s ease;
}
.scroll-slim:hover, .scroll-slim:focus-within {
  scrollbar-color: var(--c-line-2) transparent;
}
.scroll-slim::-webkit-scrollbar { width: 8px; height: 8px; }
.scroll-slim::-webkit-scrollbar-track { background: transparent; }
.scroll-slim::-webkit-scrollbar-thumb {
  background-color: transparent;
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: content-box;
  transition: background-color .25s ease;
}
.scroll-slim:hover::-webkit-scrollbar-thumb,
.scroll-slim:focus-within::-webkit-scrollbar-thumb { background-color: var(--c-line-2); }
.scroll-slim::-webkit-scrollbar-thumb:hover { background-color: var(--c-muted); }

/* Полоса самой страницы — в том же оформлении, но видна всегда:
   на длинных списках заказов ею пользуются постоянно. */
.crm-root, html { scrollbar-width: thin; scrollbar-color: var(--c-line-2) transparent; }
body::-webkit-scrollbar, .crm-root::-webkit-scrollbar { width: 10px; height: 10px; }
body::-webkit-scrollbar-track, .crm-root::-webkit-scrollbar-track { background: transparent; }
body::-webkit-scrollbar-thumb, .crm-root::-webkit-scrollbar-thumb {
  background-color: var(--c-line-2);
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: content-box;
}
body::-webkit-scrollbar-thumb:hover, .crm-root::-webkit-scrollbar-thumb:hover {
  background-color: var(--c-muted);
}

/* Внутри модальных окон полоса не должна упираться в скруглённый угол */
.scroll-slim::-webkit-scrollbar-thumb { min-height: 32px; }

/* Числовые поля: системные стрелки выглядят чужеродно и мелкие для
   касания. Прячем их и подставляем свои кнопки — компонент NumField. */
.crm-root input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
.crm-root input[type="number"]::-webkit-outer-spin-button,
.crm-root input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.num-field { position: relative; display: inline-flex; align-items: center; }
.num-field > input { width: 100%; padding-right: 1.6rem; }
.num-field .num-steps {
  position: absolute;
  right: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  opacity: 0;
  transition: opacity .18s ease;
}
.num-field:hover .num-steps,
.num-field:focus-within .num-steps { opacity: 1; }
.num-field .num-steps button {
  display: flex;
  height: 12px;
  width: 16px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: var(--c-surface-2, rgba(127,127,127,.12));
  color: var(--c-muted);
  font-size: 9px;
  line-height: 1;
}
.num-field .num-steps button:hover { background: var(--c-accent); color: #fff; }

`;

export function ThemeStyles({ theme }) {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  return <style>{THEME_CSS}</style>;
}

export const inputBase =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100";

export const inputCls = `w-full ${inputBase}`;
