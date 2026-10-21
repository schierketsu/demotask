// UserBar.jsx — шапка страницы: слева переключатель темы, справа кнопка выхода с именем того, кто вошёл.
// Кнопка — как кнопки панели фильтров (белая «таблетка» с иконкой).

import exitIcon from '@admiral-ds/icons/build/system/ExitOutline.svg';
import { logout } from '../../auth.js';
import Icon from '../Icon/Icon.jsx';
import ThemeToggle from '../ThemeToggle/ThemeToggle.jsx';
import './UserBar.scss';   // стили этого компонента

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
                <Icon src={exitIcon} />
                <span className="logout-name">{user.firstName}</span>
            </button>
        </header>
    );
}
