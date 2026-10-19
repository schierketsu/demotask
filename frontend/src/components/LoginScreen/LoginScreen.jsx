// LoginScreen.jsx — экран до входа: «Войдите, чтобы открыть дашборд» и «Войти» (сам вход — на странице Keycloak, auth.js).
// Если Keycloak не ответил — текст ошибки и «Повторить». Слева вверху — переключатель темы, как в шапке дашборда.

import { login } from '../../auth.js';
import ThemeToggle from '../ThemeToggle/ThemeToggle.jsx';
import './LoginScreen.scss';   // стили этого компонента

/** error — текст ошибки связи с Keycloak; пустой — пользователь просто ещё не вошёл */
export default function LoginScreen({ error }) {
    return (
        <div className="login-screen">
            <ThemeToggle />
            <section className="login-card">
                {error
                    ? <p className="error" role="alert">{error}</p>
                    : <p className="muted">Войдите, чтобы открыть дашборд</p>}
                <button
                    type="button" className="login-button"
                    onClick={error ? function () { window.location.reload(); } : login}
                >{error ? 'Повторить' : 'Войти'}</button>
            </section>
        </div>
    );
}
