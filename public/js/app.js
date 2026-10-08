// app.js — точка входа страницы: загрузить данные с сервера, заполнить фильтр, нарисовать шкалу степеней
// и всё остальное. Именно этот файл подключён в index.html, остальные браузер подгружает сам по import.
//
// Из чего состоит страница (все файлы — в public/js/):
//   config.js — постоянные значения: названия, цвета и границы степеней
//   state.js  — состояние страницы: всё, что страница «помнит»
//   calc.js   — расчёты: степени, статистика сервисов, колонки и подсчёты для таблиц
//   view.js   — всё отображение: шкала степеней, чипы, карточки метрик, кольцо, полосы, таблица
//   app.js    — запуск (этот файл)
//
// Как это работает:
//   app.js загружает JSON → кладёт его в state → рисует шкалу степеней и вызывает render() (view.js)
//   render() берёт расчёты из calc.js и рисует страницу
//   пользователь выбирает продукт или степень → state меняется → render() → страница обновилась
//
// Кто кого подключает (стрелки только вниз, по кругу никто никого не импортирует):
//   app.js  → state.js, view.js
//   view.js → state.js, config.js, calc.js
//   calc.js → state.js, config.js

import { state } from './state.js';
import { byId, createElement, render, renderStepenScale } from './view.js';


/** «Деградация (без учета 5 минут)» → «Без учета 5 минут»: берём текст в скобках и делаем первую букву заглавной */
function shortMetricName(name) {
    const open = name.indexOf('('); //узнать индекс символа
    const close = name.indexOf(')', open + 1);
    const hasBrackets = open !== -1 && close > open + 1;
    const inner = hasBrackets ? name.slice(open + 1, close) : name;   // если скобок нет — берём название целиком
    return inner.charAt(0).toUpperCase() + inner.slice(1);
}

/** Загрузить данные с сервера. Если сервер ответил ошибкой — выбросить её с понятным текстом */
async function loadData() {
    // await — «дождаться»: ответ от сервера приходит не мгновенно
    // fetch — встроенная в браузер функция, которая делает HTTP-запрос на сервер и возвращает промис (обещание) с ответом
    // этот промис это обьект типа Response содежримое которого поля header зоголовок и body
    const response = await fetch('/api/data');

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

/** Старт: загрузить данные, заполнить фильтр, нарисовать шкалу степеней и всё остальное */
async function init() {
    try {
        state.data = await loadData();
    } catch (error) {
        showError(`Не удалось загрузить данные: ${error.message}`);
        return;
    }

    // короткие названия метрик для заголовков карточек — добавляем прямо к метрикам с сервера:
    // { id: 1, name: 'Деградация (без учета 5 минут)' } → + label: 'Без учета 5 минут'
    for (const metric of state.data.metrics) {
        metric.label = shortMetricName(metric.name);
    }

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
