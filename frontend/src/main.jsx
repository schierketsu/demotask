// main.jsx — точка входа: подключает стили и рисует App в <div id="root"> из index.html.
//
// Из чего состоит страница (все файлы — в src/):
//   config.js  — постоянные значения: названия, цвета и границы степеней, названия месяцев
//   calc.js    — расчёты: степени, статистика сервисов, колонки и итоги для таблиц
//   bounds.js  — логика окна сервиса: включение и отключение степеней, границы между ними
//   period.js  — период: месяц, год или диапазон дат → две даты «с … по …» для сервера
//   api.js     — запрос к серверу (GET /api/data)
//   helpers.js — формат чисел, склонения, классы CSS, группировка строк
//   App.jsx    — вся страница: её состояние и загрузка данных
//   components/ — части страницы:
//     Filters.jsx       — фильтры «Период» и «Продукт»
//     MetricBlock.jsx   — раскрывающийся блок метрики: кольцо, полосы сервисов и таблица
//     Donut.jsx         — кольцевая диаграмма с легендой
//     ServiceBars.jsx   — полосы по сервисам
//     DetailTable.jsx   — таблица «как в Excel»
//     ServiceDialog.jsx — окно сервиса: свои границы степеней
//     Tooltip.jsx       — всплывающая подсказка
//
// Как это работает (React):
//   компонент — функция, которая по данным возвращает разметку (JSX). Состояние страницы (useState в App.jsx)
//   меняется — React сам вызывает компоненты заново и обновляет на странице только то, что изменилось.
//   Поэтому функции render() больше нет: достаточно поменять состояние.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { TooltipProvider } from './components/Tooltip.jsx';
import './style.css';

createRoot(document.getElementById('root')).render(
//1 .document.getElementById('root') вернет <div>...</div> из index.html
//2 createRoot((...).render(...) — React сам нарисует App в этом <div> и будет обновлять его при изменении состояния
    <StrictMode>
        <TooltipProvider>
            <App />
        </TooltipProvider>
    </StrictMode>,
);
