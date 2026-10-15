// api.js — запросы к серверу (backend/app/main.py): данные дашборда за период (GET /api/data)
// и импорт случаев из CSV (POST /api/cases/import: проверка и запись, только роль editor).
// Каждый запрос несёт access token Keycloak в заголовке Authorization: Bearer … (auth.js).

import { accessToken } from './auth.js';


/**
 * Запрос к API с токеном. Ответ — разобранный JSON; если сервер ответил ошибкой — выбросить её с понятным текстом
 * (401 — не вошли или токен плохой, 403 — не хватает роли: текст приходит от сервера).
 * csv — для POST: текст CSV-файла, уходит телом запроса как есть
 */
async function request(url, csv) {
    const token = await accessToken();
    const options = { headers: { Authorization: `Bearer ${token}` } };
    if (csv !== undefined) {
        options.method = 'POST';
        options.headers['Content-Type'] = 'text/csv; charset=utf-8';
        options.body = csv;
    }

    // await — «дождаться»: ответ от сервера приходит не мгновенно
    // fetch — встроенная в браузер функция, которая делает HTTP-запрос на сервер и возвращает промис (обещание) с ответом
    // этот промис это обьект типа Response содежримое которого поля header зоголовок и body
    const response = await fetch(url, options);

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


/** «Деградация (без учета 5 минут)» → «Без учета 5 минут»: берём текст в скобках и делаем первую букву заглавной */
function shortMetricName(name) {
    const open = name.indexOf('('); //узнать индекс символа
    const close = name.indexOf(')', open + 1);
    const hasBrackets = open !== -1 && close > open + 1;
    const inner = hasBrackets ? name.slice(open + 1, close) : name;   // если скобок нет — берём название целиком
    return inner.charAt(0).toUpperCase() + inner.slice(1);
}

/**
 * Загрузить данные с сервера за период с from по to («2026-01-01», «2026-03-31», оба включительно);
 * пустые строки — сервер отдаст последний месяц. Если сервер ответил ошибкой — выбросить её с понятным текстом.
 * К метрикам добавляем короткие названия для заголовков карточек:
 * { id: 1, name: 'Деградация (без учета 5 минут)' } → + label: 'Без учета 5 минут'
 */
export async function loadData(from, to) {
    // адрес запроса: '/api/data' или '/api/data?from=2026-01-01&to=2026-03-31'
    // URLSearchParams собирает часть адреса после «?» и экранирует символы, которые нельзя писать в адресе как есть
    const url = from === '' ? '/api/data' : `/api/data?${new URLSearchParams({ from: from, to: to })}`;
    const body = await request(url);

    for (const metric of body.metrics) {
        metric.label = shortMetricName(metric.name);
    }
    return body;
}

/**
 * Проверить CSV перед импортом — в базу ничего не пишется. Ответ сервера:
 * { total, months: ['2025-09', …], services: [{ service, operation, product, counts: [по месяцам], total }],
 *   rowCount, errorCount, errors: [{ line, error }] }
 */
export async function previewImport(csv) {
    return request('/api/cases/import?dry_run=true', csv);
}

/** Записать все строки CSV в базу одной транзакцией → { added: 519 }. Строка с ошибкой — не пишется ничего */
export async function commitImport(csv) {
    return request('/api/cases/import', csv);
}
