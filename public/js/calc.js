// calc.js — расчёты: степень для процента, диапазоны степеней, колонки таблицы и подготовка данных
// для колец, полос и таблиц. Страницу здесь не трогаем — только считаем; рисует view.js.
//
// Что здесь, по порядку:
//   1. Степени: какая степень у процента, диапазоны и подписи степеней, подсчёт аварий по степеням.
//   2. Сервисы: фильтр по группе операций, статистика по сервисам для полос и их общий масштаб.
//   3. Таблица: колонки (диапазоны, разрезанные границами степеней), склейка пустых колонок, подсчёт по колонкам.

import { DEGREES, PALETTE } from './config.js';
import { state } from './state.js';


/** Сумма чисел списка: sum([1, 2, 3]) → 6 */
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

/** Номер степени деградации для процента: 0 — минимальная, 1 — частичная, 2 — значительная, 3 — полная */
export function severityOf(pct) {
    const bounds = state.settings.bounds;
    for (let i = 0; i < bounds.length; i++) {
        if (pct <= bounds[i]) {
            return i;
        }
    }
    return 3;   // процент больше всех границ — полная
}

/**
 * Диапазоны четырёх степеней при текущих границах — для подписей: название, первая буква,
 * диапазон процентов, цвет и цвет текста на нём.
 * Например: { name: 'Частичная', short: 'Ч', from: 21, to: 50, color: '#fbc22c', text: '#0b0b0b' }
 */
export function getSeverityRanges() {
    const bounds = state.settings.bounds;
    const result = [];

    for (let i = 0; i < 4; i++) {
        // начало диапазона: у первой степени 0, у остальных — следующий процент после предыдущей границы
        const from = i > 0 ? bounds[i - 1] + 1 : 0;
        // конец диапазона: у последней степени 100, у остальных — своя граница
        const to = i < 3 ? bounds[i] : 100;
        result.push({
            name: DEGREES[i],
            short: DEGREES[i].charAt(0),
            from: from,
            to: to,
            color: PALETTE[i].color,
            text: PALETTE[i].text,
        });
    }
    return result;
}

/** Подпись диапазона степени: «21–50%» */
export function rangeText(severity) {
    return `${severity.from}–${severity.to}%`;
}

/** Сколько аварий каждой степени: [минимальных, частичных, значительных, полных] */
function countBySeverity(pcts) {
    const counts = [0, 0, 0, 0];
    for (const pct of pcts) {
        const severity = severityOf(pct);
        counts[severity] = counts[severity] + 1;
    }
    return counts;
}


// ============================================================================
// 2. Сервисы: фильтр и статистика для полос
// ============================================================================

/** Строки сервисов с учётом фильтра «Группа операций» */
export function filteredRows() {
    const allRows = state.data.rows;
    if (state.opcat === '') {
        return allRows;   // группа не выбрана — показываем все
    }
    const result = [];
    for (const row of allRows) {
        // в выпадающем списке значение хранится текстом, а category_id — число, поэтому сравниваем как текст
        if (String(row.category_id) === state.opcat) {
            result.push(row);
        }
    }
    return result;
}

/**
 * Статистика сервисов для одной метрики — сколько у каждого сервиса аварий каждой степени.
 * Только считает; полосы по ней потом рисует view.js.
 * Например: [{ name: 'Сервис 1', parts: [2, 1, 0, 0] }, …]
 */
export function buildServiceStats(rows, metric) {
    const stats = [];
    for (const row of rows) {
        stats.push({ name: row.service, parts: countBySeverity(row.pcts[metric.id]) });
    }
    return stats;
}

/** Сколько аварий показывать на полосе сервиса: все, или только выбранной степени */
function shownValue(parts) {
    return state.selected === null ? sum(parts) : parts[state.selected];
}

/** Самое большое показываемое значение среди всех сервисов всех метрик (не меньше 1) — общий масштаб полос */
export function maxShownValue(statsByMetric) {
    let max = 1;
    for (const stats of statsByMetric) {
        for (const item of stats) {
            const value = shownValue(item.parts);
            if (value > max) {
                max = value;
            }
        }
    }
    return max;
}


// ============================================================================
// 3. Таблица: колонки и подсчёт по ним
// ============================================================================

/** Есть ли в списке хоть один процент от from до to включительно */
function hasPctInRange(pcts, from, to) {
    for (const pct of pcts) {
        if (pct >= from && pct <= to) {
            return true;
        }
    }
    return false;
}

/** Сколько процентов из списка попадает в диапазон от from до to включительно */
function countPctInRange(pcts, from, to) {
    let count = 0;
    for (const pct of pcts) {
        if (pct >= from && pct <= to) {
            count = count + 1;
        }
    }
    return count;
}

/**
 * Колонки таблицы: диапазоны из базы (0–10, 11–20, …), разрезанные границами степеней,
 * чтобы каждая колонка целиком относилась к одной степени.
 * Например, при границе 25 диапазон 21–30 превращается в две колонки: 21–25 и 26–30.
 * Возвращает список колонок [{ from, to, sev }], где sev — номер степени колонки.
 */
export function tableColumns() {
    const columns = [];
    for (const bucket of state.data.buckets) {
        let from = bucket.pct_from;

        // если внутри диапазона проходит граница степени — отрезаем кусок до неё
        for (const bound of state.settings.bounds) {
            if (bound >= from && bound < bucket.pct_to) {
                columns.push({ from: from, to: bound, sev: severityOf(bound) });
                from = bound + 1;
            }
        }

        // остаток диапазона — ещё одна колонка
        columns.push({ from: from, to: bucket.pct_to, sev: severityOf(bucket.pct_to) });
    }
    return columns;
}

/**
 * Соседние пустые колонки одной степени склеиваются в одну (43–50, 51–60, 61–70 → 43–70),
 * чтобы таблица не разрасталась нулями. pcts — все проценты, которые попадут в таблицу.
 */
export function mergeEmptyColumns(columns, pcts) {
    const result = [];
    for (const column of columns) {
        const empty = !hasPctInRange(pcts, column.from, column.to);

        // последняя уже добавленная колонка (или null, если ещё ничего не добавили)
        const previous = result.length > 0 ? result[result.length - 1] : null;

        const canMerge = empty && previous !== null && previous.empty && previous.sev === column.sev;
        if (canMerge) {
            previous.to = column.to;   // растягиваем предыдущую колонку
        } else {
            result.push({ from: column.from, to: column.to, sev: column.sev, empty: empty });
        }
    }
    return result;
}

/** Все проценты всех показанных сервисов по всем метрикам — одним списком */
export function allPcts(rows) {
    const result = [];
    for (const row of rows) {
        for (const metric of state.data.metrics) {
            for (const pct of row.pcts[metric.id]) {
                result.push(pct);
            }
        }
    }
    return result;
}

/**
 * Строки для таблицы: данные сервиса + counts — сколько аварий попало в каждую колонку,
 * отдельно по каждой метрике: counts[id метрики] = [число в 1-й колонке, число во 2-й, …]
 */
export function tableRowsWithCounts(rows, columns) {
    const result = [];
    for (const row of rows) {
        const counts = {};
        for (const metric of state.data.metrics) {
            const pcts = row.pcts[metric.id];
            const countsInColumns = [];
            for (const column of columns) {
                countsInColumns.push(countPctInRange(pcts, column.from, column.to));
            }
            counts[metric.id] = countsInColumns;
        }

        result.push({
            category_id: row.category_id,
            category: row.category,
            operation_id: row.operation_id,
            operation_num: row.operation_num,
            operation: row.operation,
            service: row.service,
            counts: counts,
        });
    }
    return result;
}
