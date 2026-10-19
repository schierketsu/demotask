// theme.js — светлая и тёмная тема страницы.
//
// Как это работает:
//   тема — атрибут data-theme="light" или "dark" у <html>. Цвета страницы — CSS-переменные (global.scss):
//     в :root — светлые, в :root[data-theme="dark"] — тёмные. Сменили атрибут — браузер сам перекрасил всё,
//     React страницу не перерисовывает
//   какую тему показать при открытии, решает маленький скрипт в index.html — ещё до того, как браузер нарисует
//     страницу, чтобы тёмная тема не «моргала» белым: выбор из localStorage, а если его нет — тема системы
//   переключатель (components/ThemeToggle) вызывает setTheme: новый атрибут + запоминаем выбор в localStorage.
//     Страница входа Keycloak открыта на том же адресе, поэтому видит тот же выбор
//     (keycloak/themes/degradations/login/resources/js/theme.js)
//
// Цвета степеней задаются в config.js, а фоны ячеек таблицы для обеих тем превращаются в CSS-переменные здесь —
// installStepenColors(), один раз при запуске (main.jsx).

import { STEPEN_COLORS } from './config.js';

// ключ в localStorage — тот же читают index.html и тема страницы входа Keycloak
const STORAGE_KEY = 'theme';

/** Какая тема сейчас: 'light' или 'dark' */
export function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Включить тему ('light' или 'dark') и запомнить выбор */
export function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try {
        localStorage.setItem(STORAGE_KEY, theme);
    } catch {
        // localStorage недоступен (запрещён в браузере) — тема включена, но после перезагрузки не сохранится
    }
}

/**
 * Фоны ячеек для каждой степени — CSS-переменные для обеих тем:
 *   --stepen-0-cell  — ячейка с авариями (cellBackground)
 *   --stepen-0-empty — ячейка без аварий (emptyCellBackground)
 *   --stepen-0-total — итог степени в строке «Всего» (totalBackground)
 * Компоненты пишут в стиле background: var(--stepen-0-cell) — см. stepenVar
 */
export function installStepenColors() {
    function block(selector, pick) {
        const lines = STEPEN_COLORS.map(function (colors, k) {
            const c = pick(colors);
            return `--stepen-${k}-cell: ${c.cellBackground}; --stepen-${k}-empty: ${c.emptyCellBackground}; `
                + `--stepen-${k}-total: ${c.totalBackground};`;
        });
        return `${selector} { ${lines.join(' ')} }`;
    }

    const style = document.createElement('style');
    style.textContent = [
        block(':root', function (colors) { return colors; }),
        block(':root[data-theme="dark"]', function (colors) { return colors.dark; }),
    ].join('\n');
    document.head.append(style);
}

/** Фон степени для стиля: stepenVar(1, 'cell') → 'var(--stepen-1-cell)'. kind — 'cell', 'empty' или 'total' */
export function stepenVar(stepen, kind) {
    return `var(--stepen-${stepen}-${kind})`;
}
