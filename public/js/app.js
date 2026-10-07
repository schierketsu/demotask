// app.js — точка входа страницы: загрузить данные с сервера, заполнить фильтр, построить панель
// настройки и нарисовать всё. Именно этот файл подключён в index.html, остальные браузер подгружает сам по import.
//
// Из чего состоит страница (все файлы — в public/js/):
//   config.js   — постоянные значения: названия степеней, шаг, настройки по умолчанию
//   state.js    — состояние страницы: всё, что страница «помнит»
//   settings.js — настройки степеней: загрузка из браузера, проверка, сохранение, сдвиг границ
//   calc.js     — расчёты: степени, колонки таблицы, подготовка данных для колец, полос и таблиц
//   controls.js — панель настройки: ползунки, шкала, плашки с цветом и числом
//   view.js     — отрисовка: чипы степеней и карточки метрик
//   charts.js   — рисование: кольцо, полосы, таблица, подсказки и общие помощники
//   app.js      — запуск (этот файл)
//
// Кто кого подключает (стрелки только вниз, по кругу никто никого не импортирует):
//   app.js      → controls.js, view.js, settings.js, state.js, charts.js
//   controls.js → state.js, settings.js, calc.js, config.js, charts.js
//   view.js     → state.js, calc.js, config.js, charts.js
//   calc.js     → state.js, config.js, charts.js
//   state.js    → settings.js → config.js

import { state } from './state.js';
import { saveSettings } from './settings.js';
import { buildControls, updateControls } from './controls.js';
import { render } from './view.js';
import { byId, el } from './charts.js';


/** Настройки изменились: сохранить их, обновить панель и перерисовать страницу */
function apply() {
    saveSettings(state.settings);
    updateControls();
    render();
}

/** «Деградация (без учета 5 минут)» → «Без учета 5 минут»: берём текст в скобках и делаем первую букву заглавной */
function shortName(name) {
    const open = name.indexOf('(');
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

/** Старт: загрузить данные, заполнить фильтр, построить панель настройки и нарисовать всё */
async function init() {
    try {
        state.data = await loadData();
    } catch (error) {
        showError(`Не удалось загрузить данные: ${error.message}`);
        return;
    }

    // короткие названия метрик для заголовков карточек
    for (const metric of state.data.metrics) {
        state.metrics.push({ id: metric.id, label: shortName(metric.name) });
    }

    // выпадающий список «Группа операций»: по пункту на каждую категорию
    const categorySelect = byId('opcat');
    for (const category of state.data.categories) {
        el('option', { value: category.id }, categorySelect, category.name);
    }
    categorySelect.addEventListener('change', function () {
        state.opcat = categorySelect.value;
        render(); //это только регистрация обработчика, если юзер меняет категорию то функция выполнится позже
    });

    // панели настройки передаём, что делать после каждого изменения границ или цветов
    buildControls(apply); //при измененнии настроек будет вызывать apply() и перерисовывать страницу
    apply(); //явно вызываем apply() чтобы отрисовать страницу при первой загрузке
}


init();
