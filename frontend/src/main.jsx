// main.jsx — точка входа: подключает стили, проверяет вход через Keycloak и рисует в <div id="root"> из index.html
// либо App (вошли), либо экран входа LoginScreen (не вошли или Keycloak не ответил).
//
// Из чего состоит страница (все файлы — в src/):
//   config.js  — постоянные значения: названия, цвета и границы степеней, названия месяцев
//   calc.js    — расчёты: степени, статистика сервисов, колонки и итоги для таблиц
//   bounds.js  — логика окна сервиса: включение и отключение степеней, границы между ними
//   period.js  — период: месяц, год или диапазон дат → две даты «с … по …» для сервера
//   theme.js   — светлая и тёмная тема: переключение, запоминание выбора, цвета степеней для обеих тем
//   auth.js    — вход через Keycloak (OIDC, PKCE): токен для API, имя того, кто вошёл, и есть ли у него роль editor
//   api.js     — запросы к серверу с токеном (GET /api/data, импорт CSV — POST /api/cases/import)
//   excel.js   — выгрузка в Excel по кнопке «Экспорт»: два листа — без своих границ сервисов и с ними
//   helpers.js — формат чисел, склонения, классы CSS, группировка строк
//   App.jsx    — вся страница: её состояние и загрузка данных
//   styles/    — общие стили: global.scss (шрифты, цвета, базовые теги), dialog.scss (оболочка окон)
//                и _mixins.scss (повторяющиеся куски стилей)
//   components/ — части страницы, у каждой своя папка: компонент .jsx и его стили .scss рядом
//     LoginScreen/   — экран до входа: «Войти»
//     UserBar/       — шапка: переключатель темы и кнопка выхода с именем того, кто вошёл
//     ThemeToggle/   — переключатель светлой и тёмной темы
//     Filters/       — фильтры «Период» и «Продукт», кнопки «Импорт» и «Экспорт»
//     MetricBlock/   — раскрывающийся блок метрики: кольцо, полосы сервисов и таблица
//     Donut/         — кольцевая диаграмма с легендой
//     ServiceBars/   — полосы по сервисам
//     DetailTable/   — таблица «как в Excel»
//     ServiceDialog/ — окно сервиса: свои границы степеней
//     ImportDialog/  — окно импорта случаев из CSV: файл → проверка → «Принять изменения» (только editor)
//     Tooltip/       — всплывающая подсказка
//
// Как это работает (React):
//   компонент — функция, которая по данным возвращает разметку (JSX). Состояние страницы (useState в App.jsx)
//   меняется — React сам вызывает компоненты заново и обновляет на странице только то, что изменилось.
//   Поэтому функции render() больше нет: достаточно поменять состояние.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { TooltipProvider } from './components/Tooltip/Tooltip.jsx';
import LoginScreen from './components/LoginScreen/LoginScreen.jsx';
import { initAuth } from './auth.js';
import { installStepenColors } from './theme.js';
import './styles/global.scss';   // общие стили страницы; стили частей — рядом с компонентами

// цвета ячеек степеней для светлой и тёмной темы — CSS-переменными (сама тема уже выбрана в index.html)
installStepenColors();

//1 .document.getElementById('root') вернет <div>...</div> из index.html
//2 createRoot((...).render(...) — React сам нарисует App в этом <div> и будет обновлять его при изменении состояния
const root = createRoot(document.getElementById('root'));

// Сначала спрашиваем Keycloak, вошёл ли пользователь (пока ждём — страница пустая, это доли секунды)
initAuth().then(function (authenticated) {
    root.render(
        <StrictMode>
            {authenticated
                ? <TooltipProvider><App /></TooltipProvider>
                : <LoginScreen error="" />}
        </StrictMode>,
    );
}).catch(function (error) {
    // Keycloak не ответил (не запущен, сеть) — показываем ошибку и «Повторить»
    const reason = error && error.message ? error.message : 'нет ответа';
    root.render(
        <StrictMode>
            <LoginScreen error={`Не удалось связаться с сервером авторизации: ${reason}`} />
        </StrictMode>,
    );
});
