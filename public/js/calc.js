// calc.js — расчёты: степень для диапазона, диапазоны степеней, колонки таблицы и подготовка данных
// для колец, полос и таблиц. Страницу здесь не трогаем — только считаем; рисует view.js.
//
// Аварии приходят с сервера не точными процентами, а количеством в каждом диапазоне по 10%:
// row.counts[id метрики] = [в 0–10%, в 11–20%, …, в 91–100%] — по порядку state.data.buckets.
//
// Что здесь, по порядку:
//   1. Степени: к какой степени относится процент или диапазон, подписи степеней, подсчёт аварий по степеням.
//   2. Сервисы: фильтр по продукту, статистика по сервисам для полос и их общий масштаб.
//   3. Таблица: колонки (диапазоны по 10% из базы) и строки с количеством аварий в них.

import { STEPEN_BOUNDS, STEPEN_NAMES, STEPEN_COLORS } from './config.js';
import { state } from './state.js';


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

/** Заданы ли у сервиса свои границы степеней (в окне сервиса) — тогда у его чипа чёрная обводка */
export function hasOwnBounds(serviceId) {
    return state.serviceBounds[serviceId] !== undefined;
}

/**
 * Границы степеней сервиса: свои, если их задали в окне сервиса (state.serviceBounds), иначе общие по умолчанию.
 * Например: [30, 60, 90] — минимальная до 30%, частичная до 60%, значительная до 90%
 */
export function boundsOf(row) {
    if (hasOwnBounds(row.service_id)) {
        return state.serviceBounds[row.service_id];
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
 * диапазон процентов, цвет и цвет текста на нём.
 * Например: { name: 'Частичная', letter: 'Ч', from: 21, to: 50, color: '#fbc22c', textColor: '#0b0b0b' }
 */
export function getStepenRanges(bounds = STEPEN_BOUNDS) {
    const result = [];

    for (let i = 0; i < 4; i++) {
        // начало диапазона: у первой степени 0, у остальных — следующий процент после предыдущей границы
        const from = i > 0 ? bounds[i - 1] + 1 : 0;
        // конец диапазона: у последней степени 100, у остальных — своя граница
        const to = i < 3 ? bounds[i] : 100;
        result.push({
            name: STEPEN_NAMES[i],
            letter: STEPEN_NAMES[i].charAt(0),
            from: from,
            to: to,
            color: STEPEN_COLORS[i].color,
            textColor: STEPEN_COLORS[i].textColor,
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
 * bucketCounts — сколько аварий в каждом диапазоне: [в 0–10%, в 11–20%, …] (row.counts[id метрики]).
 * Степень диапазона — по его верхней границе: границы степеней кратны 10, поэтому диапазон
 * целиком попадает в одну степень (21–30% при границах 20/50/80 — частичная)
 */
export function countByStepen(bucketCounts, bounds) {
    const counts = [0, 0, 0, 0];
    const buckets = state.data.buckets;
    for (let i = 0; i < buckets.length; i++) {
        const stepen = stepenOf(buckets[i].pct_to, bounds);
        counts[stepen] = counts[stepen] + bucketCounts[i];
    }
    return counts;
}


// ============================================================================
// 2. Сервисы: фильтр и статистика для полос
// ============================================================================

/** Строки сервисов с учётом фильтра «Продукт» */
export function rowsOfSelectedProduct() {
    const allRows = state.data.rows;
    if (state.selectedProductId === '') {
        return allRows;   // продукт не выбран — показываем все
    }
    const result = [];
    for (const row of allRows) {
        // в выпадающем списке значение хранится текстом, а product_id — число, поэтому сравниваем как текст
        if (String(row.product_id) === state.selectedProductId) {
            result.push(row);
        }
    }
    return result;
}

/**
 * Статистика сервисов для одной метрики — сколько у каждого сервиса аварий каждой степени
 * (по его собственным границам, если они заданы). Только считает; полосы по ней потом рисует view.js.
 * Например: [{ name: 'Сервис 1', stepenCounts: [2, 1, 0, 0] }, …]
 */
export function buildServiceStats(rows, metric) {
    const stats = [];
    for (const row of rows) {
        stats.push({ name: row.service, stepenCounts: countByStepen(row.counts[metric.id], boundsOf(row)) });
    }
    return stats;
}

/** Сколько аварий показывать на полосе сервиса: все, или только выбранной степени */
function shownCount(stepenCounts) {
    return state.selectedStepen === null ? sum(stepenCounts) : stepenCounts[state.selectedStepen];
}

/** Самое большое показываемое значение среди всех сервисов всех метрик (не меньше 1) — общий масштаб полос */
export function maxShownCount(statsByMetric) {
    let max = 1;
    for (const stats of statsByMetric) {
        for (const item of stats) {
            const value = shownCount(item.stepenCounts);
            if (value > max) {
                max = value;
            }
        }
    }
    return max;
}


// ============================================================================
// 3. Таблица: колонки и строки
// ============================================================================

/**
 * Колонки таблицы — диапазоны из базы по 10%: 0–10, 11–20, …, 91–100.
 * Границы степеней (20, 50, 80) кратны 10, поэтому каждая колонка целиком относится к одной степени.
 * Возвращает список колонок [{ from, to, stepen }], где stepen — номер степени колонки.
 */
export function buildTableColumns() {
    const columns = [];
    for (const bucket of state.data.buckets) {
        columns.push({ from: bucket.pct_from, to: bucket.pct_to, stepen: stepenOf(bucket.pct_to) });
    }
    return columns;
}

/**
 * Строки для таблицы: данные сервиса + columnCounts — сколько аварий в каждой колонке,
 * отдельно по каждой метрике: columnCounts[id метрики] = [число в 1-й колонке, число во 2-й, …].
 * Колонки — те же диапазоны, что пришли с сервера, поэтому количество берём как есть (row.counts)
 */
export function buildTableRows(rows) {
    const result = [];
    for (const row of rows) {
        result.push({
            product_id: row.product_id,
            product: row.product,
            operation_id: row.operation_id,
            operation_num: row.operation_num,
            operation: row.operation,
            service_id: row.service_id,
            service: row.service,
            bounds: boundsOf(row),           // границы степеней сервиса — по ним красятся ячейки его строки
            isCustom: hasOwnBounds(row.service_id),
            columnCounts: row.counts,
        });
    }
    return result;
}
