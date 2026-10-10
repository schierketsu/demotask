// app.js — точка входа страницы: загрузить данные с сервера, заполнить фильтр, нарисовать шкалу степеней
// и всё остальное. Именно этот файл подключён в index.html, остальные браузер подгружает сам по import.
//
// Из чего состоит страница (все файлы — в public/js/):
//   config.js — постоянные значения: названия, цвета и границы степеней
//   state.js  — состояние страницы: всё, что страница «помнит»
//   calc.js   — расчёты: степени, статистика сервисов, колонки и подсчёты для таблиц
//   dom.js    — помощники: создать элемент, найти элемент по id
//   view.js   — всё отображение: шкала степеней, чипы, карточки метрик, кольцо, полосы, таблица
//   service-dialog.js — окно сервиса: свои границы степеней у отдельного сервиса
//   app.js    — запуск (этот файл)
//
// Как это работает:
//   app.js загружает JSON за последний месяц → кладёт его в state → рисует шкалу степеней и вызывает render() (view.js)
//   render() берёт расчёты из calc.js и рисует страницу
//   пользователь выбирает продукт или степень → state меняется → render() → страница обновилась
//   пользователь выбирает месяц → app.js загружает JSON за этот месяц → state.data заменяется → render()
//   пользователь нажимает на чип сервиса → окно сервиса (service-dialog.js) → сохранил границы → render()
//
// Кто кого подключает (стрелки только вниз, по кругу никто никого не импортирует):
//   app.js            → state.js, view.js, config.js, dom.js
//   view.js           → state.js, config.js, calc.js, dom.js, service-dialog.js
//   service-dialog.js → state.js, config.js, calc.js, dom.js
//   calc.js           → state.js, config.js

import { MONTH_NAMES } from './config.js';
import { state } from './state.js';
import { byId, createElement } from './dom.js';
import { render, renderStepenScale } from './view.js';


/** «Деградация (без учета 5 минут)» → «Без учета 5 минут»: берём текст в скобках и делаем первую букву заглавной */
function shortMetricName(name) {
    const open = name.indexOf('('); //узнать индекс символа
    const close = name.indexOf(')', open + 1);
    const hasBrackets = open !== -1 && close > open + 1;
    const inner = hasBrackets ? name.slice(open + 1, close) : name;   // если скобок нет — берём название целиком
    return inner.charAt(0).toUpperCase() + inner.slice(1);
}

/** '2026-10' → «Октябрь 2026» */
function formatMonth(month) {
    const year = month.slice(0, 4);               // '2026'
    const monthNumber = Number(month.slice(5));   // '10' → 10
    return `${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

/**
 * Загрузить данные с сервера за месяц month («2026-10»); пустая строка — сервер отдаст последний месяц.
 * Если сервер ответил ошибкой — выбросить её с понятным текстом
 */
async function loadData(month) {
    // адрес запроса: '/api/data' или '/api/data?month=2026-10'
    // encodeURIComponent — на всякий случай экранирует символы, которые нельзя писать в адресе как есть
    const url = month === '' ? '/api/data' : `/api/data?month=${encodeURIComponent(month)}`;

    // await — «дождаться»: ответ от сервера приходит не мгновенно
    // fetch — встроенная в браузер функция, которая делает HTTP-запрос на сервер и возвращает промис (обещание) с ответом
    // этот промис это обьект типа Response содежримое которого поля header зоголовок и body
    const response = await fetch(url);

    let body = {};
    try {
        body = await response.json();   // метод json на удивление работает сразу с body и возвращает промис с распарсеным JSON в виде JS-обьекта
    } catch (error) {
        // ответ не в формате JSON (например, страница ошибки) — оставляем пустой объект
    }

    if (!response.ok) {
        // текст ошибки от нашего API… или хотя бы код ответа
        const message = body.error ? body.error : `HTTP ${response.status}`;
        throw new Error(message);
    }
    return body;
}

/** Показать сообщение об ошибке вверху страницы */
function showError(text) {
    const error = byId('error');
    error.textContent = text;
    error.hidden = false;
}

/** Убрать сообщение об ошибке (например, после успешной загрузки другого месяца) */
function hideError() {
    byId('error').hidden = true;
}

/**
 * Положить загруженные данные в state. Короткие названия метрик для заголовков карточек
 * добавляем прямо к метрикам с сервера — после каждой загрузки, потому что метрики приходят заново:
 * { id: 1, name: 'Деградация (без учета 5 минут)' } → + label: 'Без учета 5 минут'
 */
function setData(data) {
    for (const metric of data.metrics) {
        metric.label = shortMetricName(metric.name);
    }
    state.data = data;
}

/** Выбрали другой месяц: загрузить его данные и перерисовать страницу (выбранные продукт и степень сохраняются) */
async function changeMonth(month) {
    state.selectedMonth = month;

    let data;
    try {
        data = await loadData(month);
    } catch (error) {
        // страница остаётся с данными прошлого месяца, сверху — сообщение
        showError(`Не удалось загрузить данные за ${formatMonth(month).toLowerCase()}: ${error.message}`);
        return;
    }

    // пока ждали ответ, могли успеть выбрать ещё один месяц — тогда этот ответ уже не нужен
    if (month !== state.selectedMonth) {
        return;
    }
    setData(data);
    hideError();
    render();
}

/** Старт: загрузить данные за последний месяц, заполнить фильтры, нарисовать шкалу степеней и всё остальное */
async function init() {
    let data;
    try {
        data = await loadData('');   // месяц не указываем — сервер отдаст последний
    } catch (error) {
        showError(`Не удалось загрузить данные: ${error.message}`);
        return;
    }
    setData(data);
    state.selectedMonth = data.month;   // какой месяц сервер отдал — тот и выбран

    // выпадающий список «Месяц»: свежие месяцы сверху
    const monthSelect = byId('month-filter');
    for (let i = data.months.length - 1; i >= 0; i--) {
        const month = data.months[i];
        createElement('option', { value: month }, monthSelect, formatMonth(month));
    }
    monthSelect.value = state.selectedMonth;
    monthSelect.addEventListener('change', function () {
        changeMonth(monthSelect.value);
    });

    // выпадающий список «Продукт»: по пункту на каждый продукт
    const productSelect = byId('product-filter');
    for (const product of state.data.products) {
        createElement('option', { value: product.id }, productSelect, product.name);
    }
    productSelect.addEventListener('change', function () {
        state.selectedProductId = productSelect.value;
        render(); //это только регистрация обработчика, если юзер меняет продукт то функция выполнится позже
    });

    renderStepenScale(); // шкала степеней: границы постоянные, рисуем один раз
    render();            // явно вызываем render(), чтобы отрисовать страницу при первой загрузке
}


init();
