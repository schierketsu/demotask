// calc.js — расчёты: степень для диапазона, диапазоны степеней, колонки таблицы и подготовка данных
// для колец, полос и таблиц. Страницу здесь не трогаем — только считаем; рисуют компоненты (components/).
// Все функции «чистые»: всё, что им нужно, приходит параметрами, и они ничего не меняют снаружи —
// поэтому React может вызывать их при каждой перерисовке.
//
// Аварии приходят с сервера не точными процентами, а количеством в каждом диапазоне по 10%:
// row.counts[id метрики] = [в 0–10%, в 11–20%, …, в 91–100%] — по порядку data.buckets.
//
// Что здесь, по порядку:
//   1. Степени: к какой степени относится процент или диапазон, подписи степеней, подсчёт аварий по степеням.
//   2. Сервисы: фильтр по продукту, статистика по сервисам для полос и их общий масштаб.
//   3. Таблица: колонки (диапазоны по 10% из базы) и итоги по степеням.

import { STEPEN_BOUNDS, STEPEN_NAMES, STEPEN_COLORS } from './config.js';


//функция суммы
export function sum(numbers) {
    let total = 0;
    for (const number of numbers) {
        total = total + number;
    }
    return total;
}


// ============================================================================
// 1. Степени
// ============================================================================

/**
 * Заданы ли у сервиса свои границы степеней (в окне сервиса) — тогда у его чипа чёрная обводка.
 *   serviceBounds — свои границы сервисов: { id сервиса: [30, 60, 90] } (состояние страницы, App.jsx)
 */
export function hasOwnBounds(serviceBounds, serviceId) {
    return serviceBounds[serviceId] !== undefined;
}

/**
 * Границы степеней сервиса: свои, если их задали в окне сервиса, иначе общие по умолчанию.
 * Например: [30, 60, 90] — минимальная до 30%, частичная до 60%, значительная до 90%, дальше полная.
 * Границы могут совпадать — тогда степень между ними не используется: [100, 100, 100] — только минимальная
 */
export function boundsOf(serviceBounds, serviceId) {
    if (hasOwnBounds(serviceBounds, serviceId)) {
        return serviceBounds[serviceId];
    }
    return STEPEN_BOUNDS;
}

/**
 * Номер степени деградации для процента: 0 — минимальная, 1 — частичная, 2 — значительная, 3 — полная.
 * bounds — границы степеней; не указаны — общие по умолчанию (STEPEN_BOUNDS)
 */
export function stepenOf(percent, bounds = STEPEN_BOUNDS) {
    for (let i = 0; i < bounds.length; i++) {
        if (percent <= bounds[i]) {
            return i;
        }
    }
    return 3;   // процент больше всех границ — полная
}

/**
 * Диапазоны четырёх степеней при границах bounds (по умолчанию — общих) — для подписей: название, первая буква,
 * диапазон процентов и цвет, а также start и end — где степень начинается и кончается на шкале
 * 0–100 (для цветных зон) и unused — степень отключена в окне сервиса: её граница совпала с предыдущей, места ей
 * не осталось, аварий в ней не будет.
 * Например: { name: 'Частичная', letter: 'Ч', from: 21, to: 50, start: 20, end: 50, unused: false, color: '#fbc22c' }
 */
export function getStepenRanges(bounds = STEPEN_BOUNDS) {
    const result = [];

    for (let i = 0; i < 4; i++) {
        // где степень на шкале: от предыдущей границы (у первой — от 0) до своей (у последней — до 100)
        const start = i > 0 ? bounds[i - 1] : 0;
        const end = i < 3 ? bounds[i] : 100;
        result.push({
            name: STEPEN_NAMES[i],
            letter: STEPEN_NAMES[i].charAt(0),
            // в подписи: со следующего процента после предыдущей границы; если степень начинается с самого
            // начала шкалы (первая или все до неё не используются) — от 0
            from: start > 0 ? start + 1 : 0,
            to: end,
            start: start,
            end: end,
            unused: start === end,
            color: STEPEN_COLORS[i].color,
        });
    }
    return result;
}

/** форматер { from: 21, to: 50 } → «21–50%» */
export function formatRange(stepen) {
    return `${stepen.from}–${stepen.to}%`;
}

/**
 * Сколько аварий каждой степени при границах bounds: [минимальных, частичных, значительных, полных].
 * bucketCounts — сколько аварий в каждом диапазоне: [в 0–10%, в 11–20%, …] (row.counts[id метрики]),
 * buckets — сами диапазоны (data.buckets).
 * Степень диапазона — по его верхней границе: границы степеней кратны 10, поэтому диапазон
 * целиком попадает в одну степень (21–30% при границах 20/50/80 — частичная)
 */
export function countByStepen(bucketCounts, bounds, buckets) {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < buckets.length; i++) {
        const stepen = stepenOf(buckets[i].pct_to, bounds);
        counts[stepen] = counts[stepen] + bucketCounts[i];
    }
    return counts;
}


// ============================================================================
// 2. Сервисы: фильтр и статистика для полос
// ============================================================================

/** Строки сервисов с учётом фильтра «Продукт»: productId — выбранный продукт, '' — все */
export function rowsOfProduct(rows, productId) {
    if (productId === '') {
        return rows;   // продукт не выбран — показываем все
    }
    const result = [];
    for (const row of rows) {
        // в выпадающем списке значение хранится текстом, а product_id — число, поэтому сравниваем как текст
        if (String(row.product_id) === productId) {
            result.push(row);
        }
    }
    return result;
}

/**
 * Статистика сервисов для одной метрики — сколько у каждого сервиса аварий каждой степени
 * (по его собственным границам, если они заданы). Только считает; полосы по ней потом рисует ServiceBars.
 * Например: [{ name: 'Сервис 1', stepenCounts: [2, 1, 0, 0] }, …]
 */
export function buildServiceStats(rows, metric, buckets, serviceBounds) {
    const stats = [];
    for (const row of rows) {
        const bounds = boundsOf(serviceBounds, row.service_id);
        stats.push({ name: row.service, stepenCounts: countByStepen(row.counts[metric.id], bounds, buckets) });
    }
    return stats;
}

/** Сколько аварий показывать на полосе сервиса: все, или только выбранной степени (selectedStepen; null — все) */
export function shownCount(stepenCounts, selectedStepen) {
    return selectedStepen === null ? sum(stepenCounts) : stepenCounts[selectedStepen];
}

/** Самое большое показываемое значение среди всех сервисов всех метрик (не меньше 1) — общий масштаб полос */
export function maxShownCount(statsByMetric, selectedStepen) {
    let max = 1;
    for (const stats of statsByMetric) {
        for (const item of stats) {
            const value = shownCount(item.stepenCounts, selectedStepen);
            if (value > max) {
                max = value;
            }
        }
    }
    return max;
}


// ============================================================================
// 3. Таблица: колонки и итоги
// ============================================================================

/**
 * Колонки таблицы — диапазоны из базы по 10%: 0–10, 11–20, …, 91–100.
 * Границы степеней (20, 50, 80) кратны 10, поэтому каждая колонка целиком относится к одной степени.
 * Возвращает список колонок [{ from, to, stepen }], где stepen — номер степени колонки.
 */
export function buildTableColumns(buckets) {
    const columns = [];
    for (const bucket of buckets) {
        columns.push({ from: bucket.pct_from, to: bucket.pct_to, stepen: stepenOf(bucket.pct_to) });
    }
    return columns;
}

/**
 * Сколько колонок-диапазонов у каждой степени (по границам по умолчанию): [2, 3, 3, 2].
 * Это ширина объединённых ячеек степеней — в заголовке таблицы и в строках «Всего» и продуктов
 */
export function stepenColumnSpans(columns) {
    const spans = [0, 0, 0, 0];
    for (const column of columns) {
        spans[column.stepen] = spans[column.stepen] + 1;
    }
    return spans;
}

/**
 * Сколько аварий каждой степени у нескольких сервисов вместе — для строк «Всего» и продуктов: [14, 10, 1, 4].
 * Каждый сервис считается по своим границам: если сервису задали свои, его аварии попадают в итог той степени,
 * к которой они относятся у него, — поэтому итог совпадает с кольцом.
 */
export function sumByStepen(rows, metric, buckets, serviceBounds) {
    const totals = [0, 0, 0, 0];
    for (const row of rows) {
        const counts = countByStepen(row.counts[metric.id], boundsOf(serviceBounds, row.service_id), buckets);
        for (let i = 0; i < 4; i++) {
            totals[i] = totals[i] + counts[i];
        }
    }
    return totals;
}
