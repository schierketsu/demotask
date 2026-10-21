// ThemeToggle.jsx — переключатель светлой и тёмной темы: солнце | луна, выбранная — на «таблетке», как в переключателе
// «Месяц | Год | Диапазон». Стоит слева вверху: в шапке дашборда (UserBar) и на экране входа (LoginScreen).
// Сама смена темы — в theme.js; такой же переключатель на странице входа Keycloak рисует её тема
// (keycloak/themes/degradations/login/resources/js/theme.js).

import { useState } from 'react';
import moonIcon from '@admiral-ds/icons/build/system/DarkModeOutline.svg';
import { currentTheme, setTheme } from '../../theme.js';
// солнце своё: в @admiral-ds/icons 2.0.0 его нет. Нарисовано как иконки Admiral — сетка 24, линии 1.3
import sunIcon from '../../icons/sun.svg';
import Icon from '../Icon/Icon.jsx';
import './ThemeToggle.scss';   // стили этого компонента

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
            <span className="theme-toggle-icon"><Icon src={sunIcon} /></span>
            <span className="theme-toggle-icon"><Icon src={moonIcon} /></span>
        </button>
    );
}
