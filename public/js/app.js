// app.js — точка входа страницы: загрузить данные с сервера, заполнить фильтры и нарисовать страницу.
// Именно этот файл подключён в index.html, остальные браузер подгружает сам по import.
//
// Из чего состоит страница (все файлы — в public/js/):
//   config.js — постоянные значения: названия, цвета и границы степеней
//   state.js  — состояние страницы: всё, что страница «помнит»
//   calc.js   — расчёты: степени, статистика сервисов, колонки и подсчёты для таблиц
//   dom.js    — помощники: создать элемент, найти элемент по id
//   view.js   — всё отображение: карточки метрик, кольцо, полосы, таблица, чипы
//   service-dialog.js — окно сервиса: свои границы степеней у отдельного сервиса
//   app.js    — запуск (этот файл)
//
// Как это работает:
//   app.js загружает JSON за последний месяц → кладёт его в state → вызывает render() (view.js)
//   render() берёт расчёты из calc.js и рисует страницу
//   пользователь выбирает продукт или степень → state меняется → render() → страница обновилась
//   пользователь выбирает период (месяц, год или диапазон дат) → app.js превращает его в две даты «с … по …»,
//     загружает JSON за этот период → state.data заменяется → render()
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
import { render } from './view.js';


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

/** '2026-03-10' → «10.03.2026» */
function formatDate(date) {
    const [year, month, day] = date.split('-');
    return `${day}.${month}.${year}`;
}

/**
 * Первый и последний день выбранного периода { from, to } — их и отправляем на сервер.
 * Месяц '2026-02' → 2026-02-01 … 2026-02-28; год '2026' → 2026-01-01 … 2026-12-31; диапазон — как ввели
 */
function periodDates() {
    if (state.periodType === 'month') {
        const [year, month] = state.selectedMonth.split('-').map(Number);
        // день 0 следующего месяца — последний день нужного: new Date(2026, 2, 0) → 28 февраля 2026
        // (месяцы в Date считаются с нуля, поэтому 2 — это март)
        const lastDay = String(new Date(year, month, 0).getDate()).padStart(2, '0');   // 9 → '09'
        return { from: `${state.selectedMonth}-01`, to: `${state.selectedMonth}-${lastDay}` };
    }
    if (state.periodType === 'year') {
        return { from: `${state.selectedYear}-01-01`, to: `${state.selectedYear}-12-31` };
    }
    return { from: state.rangeFrom, to: state.rangeTo };
}

/** Период словами — для сообщения об ошибке: «октябрь 2026», «2026 год», «10.03.2026 — 15.04.2026» */
function periodLabel() {
    if (state.periodType === 'month') {
        return formatMonth(state.selectedMonth).toLowerCase();
    }
    if (state.periodType === 'year') {
        return `${state.selectedYear} год`;
    }
    return `${formatDate(state.rangeFrom)} — ${formatDate(state.rangeTo)}`;
}

/**
 * Загрузить данные с сервера за период с from по to («2026-01-01», «2026-03-31», оба включительно);
 * пустые строки — сервер отдаст последний месяц. Если сервер ответил ошибкой — выбросить её с понятным текстом
 */
async function loadData(from, to) {
    // адрес запроса: '/api/data' или '/api/data?from=2026-01-01&to=2026-03-31'
    // URLSearchParams собирает часть адреса после «?» и экранирует символы, которые нельзя писать в адресе как есть
    const url = from === '' ? '/api/data' : `/api/data?${new URLSearchParams({ from: from, to: to })}`;

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

/** Убрать сообщение об ошибке (например, после успешной загрузки другого периода) */
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

/** Показать поле выбранного способа (месяц, год или две даты), остальные два — скрыть */
function showPeriodFields() {
    byId('month-field').hidden = state.periodType !== 'month';
    byId('year-field').hidden = state.periodType !== 'year';
    byId('range-field').hidden = state.periodType !== 'range';
}

// период последнего запроса «2026-01-01|2026-03-31» — чтобы не показать устаревший ответ (см. changePeriod)
let requestedPeriod = '';

/**
 * Поменялся период (способ выбора, месяц, год или дата диапазона): загрузить его данные и перерисовать страницу.
 * Выбранные продукт, степень и свои границы сервисов сохраняются
 */
async function changePeriod() {
    showPeriodFields();

    const { from, to } = periodDates();
    if (from === '' || to === '') {
        return;   // в диапазоне стёрли дату — ждём, пока введут обе
    }
    if (from > to) {   // строки ГГГГ-ММ-ДД сравниваются как даты
        showError('Начало периода позже его конца');
        return;
    }

    requestedPeriod = `${from}|${to}`;
    let data;
    try {
        data = await loadData(from, to);
    } catch (error) {
        // страница остаётся с данными прошлого периода, сверху — сообщение
        showError(`Не удалось загрузить данные за ${periodLabel()}: ${error.message}`);
        return;
    }

    // пока ждали ответ, могли успеть выбрать другой период — тогда этот ответ уже не нужен
    if (requestedPeriod !== `${from}|${to}`) {
        return;
    }
    setData(data);
    hideError();
    render();
}

/** Заполнить поля периода: списки месяцев и годов, календари диапазона; при изменении — changePeriod() */
function initPeriodFields(data) {
    // способ выбора периода: месяц, год или диапазон дат
    const typeSelect = byId('period-type');
    typeSelect.value = state.periodType;
    typeSelect.addEventListener('change', function () {
        state.periodType = typeSelect.value;
        changePeriod();
    });

    // выпадающий список «Месяц»: свежие месяцы сверху
    const monthSelect = byId('month-filter');
    for (let i = data.months.length - 1; i >= 0; i--) {
        const month = data.months[i];
        createElement('option', { value: month }, monthSelect, formatMonth(month));
    }
    monthSelect.value = state.selectedMonth;
    monthSelect.addEventListener('change', function () {
        state.selectedMonth = monthSelect.value;
        changePeriod();
    });

    // выпадающий список «Год»: годы из списка месяцев, свежие сверху ('2026-10' → '2026', без повторов)
    const yearSelect = byId('year-filter');
    for (let i = data.months.length - 1; i >= 0; i--) {
        const year = data.months[i].slice(0, 4);
        if (yearSelect.querySelector(`option[value="${year}"]`) === null) {
            createElement('option', { value: year }, yearSelect, year);
        }
    }
    yearSelect.value = state.selectedYear;
    yearSelect.addEventListener('change', function () {
        state.selectedYear = yearSelect.value;
        changePeriod();
    });

    // диапазон дат «с … по …»: календарь можно листать только в пределах дат, за которые есть случаи
    for (const [id, field] of [['range-from', 'rangeFrom'], ['range-to', 'rangeTo']]) {
        const input = byId(id);
        input.min = data.minDate;
        input.max = data.maxDate;
        input.value = state[field];
        input.addEventListener('change', function () {
            state[field] = input.value;   // пустая строка, если дату стёрли
            changePeriod();
        });
    }

    showPeriodFields();
}

/** Старт: загрузить данные за последний месяц, заполнить фильтры и нарисовать страницу */
async function init() {
    let data;
    try {
        data = await loadData('', '');   // период не указываем — сервер отдаст последний месяц
    } catch (error) {
        showError(`Не удалось загрузить данные: ${error.message}`);
        return;
    }
    setData(data);

    // какой месяц сервер отдал — тот и выбран; год — этого месяца, диапазон — тот же месяц,
    // но не дальше последней даты случаев (иначе календарь отметит дату как недопустимую)
    state.selectedMonth = data.from.slice(0, 7);   // '2026-10-01' → '2026-10'
    state.selectedYear = data.from.slice(0, 4);    // '2026-10-01' → '2026'
    state.rangeFrom = data.from;
    state.rangeTo = data.to < data.maxDate ? data.to : data.maxDate;
    requestedPeriod = `${data.from}|${data.to}`;

    initPeriodFields(data);

    // выпадающий список «Продукт»: по пункту на каждый продукт
    const productSelect = byId('product-filter');
    for (const product of state.data.products) {
        createElement('option', { value: product.id }, productSelect, product.name);
    }
    productSelect.addEventListener('change', function () {
        state.selectedProductId = productSelect.value;
        render(); //это только регистрация обработчика, если юзер меняет продукт то функция выполнится позже
    });

    render();   // явно вызываем render(), чтобы отрисовать страницу при первой загрузке
}


init();
