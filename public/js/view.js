// view.js — отрисовка страницы по данным и настройкам: чипы степеней над страницей и карточки метрик
// (слева кольцо, легенда и полосы сервисов, справа таблица).
// Что посчитать — берём из calc.js, как нарисовать кольцо, полосы и таблицу — из charts.js.

import { DEGREES } from './config.js';
import { state } from './state.js';
import {
    allPcts, filteredRows, maxShownValue, mergeEmptyColumns, rangeText, serviceBars, severities,
    tableColumns, tableRowsWithCounts,
} from './calc.js';
import { byId, el, equalizeColumns, renderDonut, renderServiceBars, renderTable } from './charts.js';


/** Перерисовать всё, что зависит от данных и настроек: чипы и карточки метрик */
export function render() {
    const sevs = severities();
    const rows = filteredRows();

    renderChips(sevs);

    // для каждой метрики — список сервисов с количеством аварий по степеням
    const barsByMetric = [];
    for (const metric of state.metrics) {
        barsByMetric.push(serviceBars(rows, metric));
    }

    // общий масштаб полос — самое большое значение среди всех метрик (не меньше 1)
    const max = maxShownValue(barsByMetric);

    // колонки таблиц общие для всех метрик, чтобы таблицы совпадали столбец в столбец:
    // склеиваются только колонки, пустые во всех метриках
    const columns = mergeEmptyColumns(tableColumns(), allPcts(rows));
    const tableRows = tableRowsWithCounts(rows, columns);

    // по карточке на метрику
    const container = byId('metric-rows');
    container.replaceChildren();   // убираем старые карточки
    for (let i = 0; i < state.metrics.length; i++) {
        const card = buildMetricCard(state.metrics[i], barsByMetric[i], sevs, max, columns, tableRows);
        container.append(card);
    }

    // таблицы уже на странице — выравниваем колонки диапазонов по ширине
    const tables = document.querySelectorAll('#metric-rows table.grid');
    for (const table of tables) {
        equalizeColumns(table);
    }
}

/** Клик по сектору кольца или строке легенды: выбрать степень; повторный клик — снять выбор */
function toggleSeverity(i) {
    if (state.selected === i) {
        state.selected = null;
    } else {
        state.selected = i;
    }
    render();
}

/** Чипы над страницей: «Все» и по чипу на каждую степень */
function renderChips(sevs) {
    const chips = byId('chips');
    chips.replaceChildren();   // убираем старые чипы

    el('span', { class: 'muted' }, chips, 'Степень деградации');
    chips.append(createChip('Все', null, null, null));
    for (let i = 0; i < sevs.length; i++) {
        chips.append(createChip(rangeText(sevs[i]), i, sevs[i].color, sevs[i].name));
    }
}

/**
 * Один чип. На чипе степени — только цвет и проценты; название — во всплывающей подсказке
 * и для экранного диктора. index — номер степени (null у чипа «Все»).
 */
function createChip(label, index, color, name) {
    const attrs = { type: 'button', role: 'radio', class: 'chip', 'aria-checked': String(state.selected === index) };
    if (name !== null) {
        attrs.title = name;
        attrs['aria-label'] = `${name}, ${label}`;
    }
    const button = el('button', attrs);
    if (color !== null) {
        el('span', { class: 'key', style: `background: ${color}` }, button);   // цветной кружок
    }
    button.append(label);

    button.addEventListener('click', function () {
        state.selected = index;
        render();
    });
    return button;
}

/** Карточка одной метрики: слева сводка (кольцо, легенда, полосы сервисов), справа таблица */
function buildMetricCard(metric, items, sevs, max, columns, tableRows) {
    const card = el('section', { class: 'card metric-card' });

    // ---------- слева: сводка ----------
    const summary = el('div', { class: 'metric-summary' }, card);
    el('h2', {}, summary, metric.label);

    // кольцо: сколько всего аварий каждой степени
    const donutParts = [];
    for (let k = 0; k < 4; k++) {
        let total = 0;
        for (const item of items) {
            total = total + item.parts[k];
        }
        donutParts.push({
            label: sevs[k].name,
            short: sevs[k].short,
            sub: rangeText(sevs[k]),
            value: total,
            color: sevs[k].color,
        });
    }
    renderDonut(el('div', {}, summary), {
        parts: donutParts,
        selected: state.selected,
        onSelect: toggleSeverity,
    });

    // заголовок над полосами
    let title = 'Сервисы';
    if (state.selected !== null) {
        title = `Сервисы · ${sevs[state.selected].name.toLowerCase()} деградация`;
    }
    el('h3', {}, summary, title);

    // полосы по сервисам
    renderServiceBars(el('div', {}, summary), {
        items: items,
        colors: state.settings.colors,
        names: DEGREES,
        selected: state.selected,
        max: max,
    });

    // ---------- справа: детализация (таблица) ----------
    const detail = el('div', { class: 'metric-detail' }, card);
    el('div', { class: 'detail-title muted' }, detail, 'Детализация');
    renderTable(el('div', { class: 'table-wrap' }, detail), {
        metric: metric,
        columns: columns,
        rows: tableRows,
        colors: state.settings.colors,
        selected: state.selected,
    });

    return card;
}
