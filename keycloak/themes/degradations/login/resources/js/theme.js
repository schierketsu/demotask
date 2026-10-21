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

    // иконки — те же, что в ThemeToggle.jsx, только цвет не зашит, а берётся у текста (currentColor):
    // солнце — своё (frontend/src/icons/sun.svg), луна — DarkModeOutline из @admiral-ds/icons 2.0.0 (MIT)
    var SVG = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none">';
    var SUN = SVG + '<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.3"/>'
        + '<path d="M12 3.65v1.7M12 18.65v1.7M3.65 12h1.7M18.65 12h1.7M6.1 6.1l1.2 1.2M16.7 16.7l1.2 1.2'
        + 'M6.1 17.9l1.2-1.2M16.7 7.3l1.2-1.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
    var MOON = SVG + '<path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" d="M9.978 5.083c.13-.238-.074-.532'
        + '-.333-.453a7.76 7.76 0 109.688 9.757c.081-.258-.212-.463-.45-.336a6.6 6.6 0 01-8.904-8.967zm10.853 6.537a.648.648'
        + ' 0 00-1.01.038.549.549 0 01-.059.068 5.3 5.3 0 11-7.487-7.477.742.742 0 00.146-.176l.03-.045a.647.647 0 00-.07'
        + '-.86.482.482 0 00-.297-.162.652.652 0 00-.153-.018 9.06 9.06 0 108.944 10.519c.082-.49.125-.994.125-1.507a.486'
        + '.486 0 00-.17-.38z"/></svg>';

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
