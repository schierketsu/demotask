/* theme.js — светлая или тёмная тема страницы входа: та же, что выбрана на дашборде, и такой же переключатель
   слева вверху (frontend/src/theme.js, components/ThemeToggle).

   Keycloak открыт на том же адресе, что и дашборд (nginx передаёт /auth/* в Keycloak), поэтому у них общий
   localStorage: выбор, сделанный на одной странице, видит другая. Нет выбора — тема системы.

   Скрипт подключён в theme.properties (scripts) и выполняется в <head>, до того как браузер нарисует страницу, —
   тёмная тема не «моргает» белым. Кнопку переключателя добавляем, когда страница загрузилась. */
(function () {
    var STORAGE_KEY = 'theme';   // тот же ключ, что у дашборда
    var root = document.documentElement;

    var theme = null;
    try { theme = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (theme !== 'light' && theme !== 'dark') {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    root.dataset.theme = theme;

    // иконки — те же, что в ThemeToggle.jsx
    var SVG = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor"'
        + ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">';
    var SUN = SVG + '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06'
        + 'M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06"/></svg>';
    var MOON = SVG + '<path d="M14 8.53A6 6 0 1 1 7.47 2 4.67 4.67 0 0 0 14 8.53z"/></svg>';

    document.addEventListener('DOMContentLoaded', function () {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'theme-toggle';
        button.setAttribute('role', 'switch');
        button.setAttribute('aria-label', 'Тёмная тема');
        button.innerHTML = '<span class="theme-toggle-icon">' + SUN + '</span><span class="theme-toggle-icon">' + MOON + '</span>';

        function show() {
            var isDark = root.dataset.theme === 'dark';
            button.setAttribute('aria-checked', String(isDark));
            button.title = isDark ? 'Включить светлую тему' : 'Включить тёмную тему';
        }

        button.addEventListener('click', function () {
            root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
            try { localStorage.setItem(STORAGE_KEY, root.dataset.theme); } catch (e) {}
            show();
        });

        show();
        document.body.prepend(button);
    });
})();
