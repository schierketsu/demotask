// ThemeToggle.jsx — переключатель светлой и тёмной темы: солнце | луна, выбранная — на «таблетке», как в переключателе
// «Месяц | Год | Диапазон». Стоит слева вверху: в шапке дашборда (UserBar) и на экране входа (LoginScreen).
// Сама смена темы — в theme.js; такой же переключатель на странице входа Keycloak рисует её тема
// (keycloak/themes/degradations/login/resources/js/theme.js).

import { useState } from 'react';
import { currentTheme, setTheme } from '../../theme.js';
import './ThemeToggle.scss';   // стили этого компонента

// Иконки 16×16 линиями цвета текста — в стиле иконок кнопок панели
const SUN_ICON = 'M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06';
const MOON_ICON = 'M14 8.53A6 6 0 1 1 7.47 2 4.67 4.67 0 0 0 14 8.53z';

export default function ThemeToggle() {
    const [theme, setThemeState] = useState(currentTheme);   // тему при открытии уже выбрал index.html
    const isDark = theme === 'dark';

    function toggle() {
        const next = isDark ? 'light' : 'dark';
        setTheme(next);        // атрибут у <html> и выбор в localStorage — страница перекрашивается сама
        setThemeState(next);   // а это — чтобы перерисовать сам переключатель
    }

    // role="switch" — для экранного диктора это тумблер «Тёмная тема»: включён или выключен
    return (
        <button
            type="button" role="switch" aria-checked={isDark} aria-label="Тёмная тема"
            title={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
            className="theme-toggle" onClick={toggle}
        >
            <span className="theme-toggle-icon">
                <svg
                    width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"
                    fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
                >
                    <circle cx="8" cy="8" r="2.8" />
                    <path d={SUN_ICON} />
                </svg>
            </span>
            <span className="theme-toggle-icon">
                <svg
                    width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"
                    fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
                >
                    <path d={MOON_ICON} />
                </svg>
            </span>
        </button>
    );
}
