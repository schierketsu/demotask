// auth.js — вход через Keycloak (OpenID Connect): Authorization Code Flow с PKCE, библиотека keycloak-js.
//
// Как это работает:
//   страница открылась → initAuth() тихо спрашивает Keycloak в невидимом iframe (silent-check-sso.html),
//     есть ли уже вход; нет — main.jsx показывает экран «Войти»
//   «Войти» → login(): переход на страницу входа Keycloak → после входа Keycloak возвращает на дашборд с кодом,
//     keycloak-js меняет код на токены (PKCE: код без секрета, который знает только эта вкладка, бесполезен)
//   запрос к API → accessToken() — токен, при необходимости обновлённый, уходит в заголовке Authorization (api.js)
//   «Выйти» → logout(): Keycloak закрывает сессию и возвращает на дашборд
//
// Роль editor страница использует только для удобства: у остальных кнопка «Импорт» неактивна. Права на работу
// с данными по-настоящему проверяет сервер (backend/app/auth.py).
//
// Keycloak — на том же адресе, что и страница (nginx передаёт /auth/* в Keycloak), поэтому адрес по умолчанию —
// текущий сайт + /auth. Realm и клиент задаются при сборке (VITE_KEYCLOAK_*, см. compose.yaml и Dockerfile).

import Keycloak from 'keycloak-js';

const keycloak = new Keycloak({
    url: import.meta.env.VITE_KEYCLOAK_URL || `${window.location.origin}/auth`,
    realm: import.meta.env.VITE_KEYCLOAK_REALM || 'degradations',
    clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'dashboard',
});

/** Узнать у Keycloak, вошёл ли пользователь (без перехода на страницу входа). Возвращает true или false */
export function initAuth() {
    return keycloak.init({
        onLoad: 'check-sso',
        pkceMethod: 'S256',
        silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
        checkLoginIframe: false,   // не опрашивать Keycloak каждые 5 секунд: истёкшую сессию заметим при обновлении токена
    });
}

/** Перейти на страницу входа Keycloak */
export function login() {
    keycloak.login();
}

/** Выйти: Keycloak закроет сессию и вернёт на главную страницу дашборда */
export function logout() {
    keycloak.logout({ redirectUri: `${window.location.origin}/` });
}

/**
 * Access token для запроса к API. Если он истекает в ближайшие 30 секунд — сначала обновить.
 * Не обновился (сессия в Keycloak закончилась) — на страницу входа
 */
export async function accessToken() {
    try {
        await keycloak.updateToken(30);
    } catch (error) {
        login();
        throw new Error('Сессия закончилась, нужно войти заново');
    }
    return keycloak.token;
}

/**
 * Кто вошёл — из токена: { firstName: 'Редактор', canWrite: true }.
 *   firstName — имя пользователя в Keycloak (в токене — given_name); если его не задали — логин
 *   canWrite — есть роль editor (realm-роль в realm_access.roles): можно записывать данные, например импортом
 */
export function currentUser() {
    const token = keycloak.tokenParsed;
    const roles = token.realm_access ? token.realm_access.roles : [];
    return { firstName: token.given_name || token.preferred_username, canWrite: roles.includes('editor') };
}
