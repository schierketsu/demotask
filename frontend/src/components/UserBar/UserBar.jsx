// UserBar.jsx — шапка страницы: слева переключатель темы, справа кнопка выхода с именем того, кто вошёл.
// Кнопка — как кнопки панели фильтров (белая «таблетка» с иконкой).

import { logout } from '../../auth.js';
import ThemeToggle from '../ThemeToggle/ThemeToggle.jsx';
import './UserBar.scss';   // стили этого компонента

// Иконка выхода 16×16 в стиле иконки кнопки «Экспорт»: линии цвета текста
const LOGOUT_ICON = 'M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6M10.5 5 13.5 8l-3 3M13.5 8H6';

/** user — из currentUser() (auth.js): { firstName } */
export default function UserBar({ user }) {
    return (
        <header className="user-bar">
            <ThemeToggle />

            {/* на кнопке только имя; что она делает — в подсказке и для экранного диктора */}
            <button
                type="button" className="logout-button" onClick={logout}
                title="Выйти" aria-label={`Выйти (${user.firstName})`}
            >
                <svg
                    width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"
                    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                >
                    <path d={LOGOUT_ICON} />
                </svg>
                <span className="logout-name">{user.firstName}</span>
            </button>
        </header>
    );
}
