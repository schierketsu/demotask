// charts.js — рисование: кольцевая диаграмма, полосы по сервисам и таблица.
//
// Что здесь происходит, по порядку:
//   1. Общие помощники: формат чисел, склонения, создание элементов.
//   2. Цвета: разбор «#RRGGBB», оттенки, цвет текста на цветном фоне.
//   3. Всплывающая подсказка.
//   4. Кольцевая диаграмма (SVG) с легендой.
//   5. Полосы по сервисам.
//   6. Таблица «как в Excel» и выравнивание её колонок.
//
// Сторонних библиотек нет — всё рисуется обычными HTML- и SVG-элементами.
// Тексты из данных вставляются только через textContent: так они не могут превратиться в HTML-код.
// Отсюда другие модули берут: el, byId, sum, inkFor, renderDonut, renderServiceBars, renderTable, equalizeColumns.


// ============================================================================
// 1. Общие помощники
// ============================================================================

// Пространство имён SVG: без него браузер создаст обычный HTML-элемент, а не SVG-фигуру
const SVG_NS = 'http://www.w3.org/2000/svg';

// Числа по-русски: 1234 → «1 234», 0.48 → «48 %»
const numberFormat = new Intl.NumberFormat('ru-RU');
const percentFormat = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0 });

// Правила русских склонений после числа: 1 авария, 2 аварии, 5 аварий
const pluralRules = new Intl.PluralRules('ru-RU');

/** Сумма чисел списка: sum([1, 2, 3]) → 6 */
export function sum(numbers) {
    let total = 0;
    for (const number of numbers) {
        total = total + number;
    }
    return total;
}

/** Форма слова после числа: plural(2, ['авария', 'аварии', 'аварий']) → 'аварии' */
function plural(count, forms) {
    const rule = pluralRules.select(count);   // 'one' (1, 21…), 'few' (2–4, 22–24…) или 'many' (0, 5–20…)
    if (rule === 'one') {
        return forms[0];
    }
    if (rule === 'few') {
        return forms[1];
    }
    return forms[2];
}

/** Слово «авария» в нужной форме для числа: 1 → «авария», 3 → «аварии», 29 → «аварий» */
function accidentsWord(count) {
    return plural(count, ['авария', 'аварии', 'аварий']);
}

/**
 * Создать HTML-элемент: тег, атрибуты, родитель (в конец которого вставить) и текст — последние два необязательны.
 * Например: el('span', { class: 'muted' }, row, '0–20%') → <span class="muted">0–20%</span> в конце row.
 */
export function el(tag, attrs = {}, parent = null, text = null) {
    const element = document.createElement(tag);
    for (const name of Object.keys(attrs)) {
        element.setAttribute(name, attrs[name]);
    }
    if (text !== null) {
        element.textContent = text;
    }
    if (parent) {
        parent.append(element);
    }
    return element;
}

/** Найти элемент страницы по его id */
export function byId(id) {
    return document.getElementById(id);
}

/** То же, что el, но для SVG-фигур (круг, контур, текст внутри <svg>) */
function svgEl(tag, attrs, parent) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const name of Object.keys(attrs)) {
        element.setAttribute(name, attrs[name]);
    }
    if (parent) {
        parent.append(element);
    }
    return element;
}

/** Приглушать ли элемент степени index: да, если выбрана какая-то другая степень */
function isDimmed(index, selected) {
    return selected !== null && selected !== index;
}


// ============================================================================
// 2. Цвета
// ============================================================================

/** Цвет «#RRGGBB» → три числа от 0 до 255 (красный, зелёный, синий): '#4bd163' → [75, 209, 99] */
function hexToRgb(hex) {
    const red = parseInt(hex.slice(1, 3), 16);     // 16 — цифры шестнадцатеричные: 'd1' → 209
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);
    return [red, green, blue];
}

/** Полупрозрачный цвет — фон для нулевых ячеек: tint('#4bd163', 0.16) → 'rgba(75, 209, 99, 0.16)' */
function tint(hex, alpha) {
    const rgb = hexToRgb(hex);
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/** Цвет, смешанный с белым; share — доля белого от 0 до 1: lighten('#dc2f3a', 0.25) → '#e5636b' */
function lighten(hex, share) {
    let result = '#';
    for (const channel of hexToRgb(hex)) {
        const mixed = Math.round(channel + (255 - channel) * share);   // сдвигаем канал к 255 — к белому
        result = result + mixed.toString(16).padStart(2, '0');        // обратно в две шестнадцатеричные цифры
    }
    return result;
}

/**
 * Каким цветом писать текст на этом фоне — почти чёрным или белым, смотря что лучше читается.
 * Считаем яркость фона по формуле из стандарта доступности WCAG и сравниваем контраст с чёрным и с белым.
 */
export function inkFor(hex) {
    // каналы 0–255 → «линейные» значения 0–1: так считается яркость, которую видит глаз
    const linear = [];
    for (const channel of hexToRgb(hex)) {
        const value = channel / 255;
        if (value <= 0.03928) {
            linear.push(value / 12.92);
        } else {
            linear.push(((value + 0.055) / 1.055) ** 2.4);
        }
    }
    // зелёный глаз видит ярче всего, синий — слабее всего
    const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];

    const contrastWithBlack = (luminance + 0.05) / 0.05;
    const contrastWithWhite = 1.05 / (luminance + 0.05);
    if (contrastWithBlack > contrastWithWhite) {
        return '#0b0b0b';
    }
    return '#ffffff';
}


// ============================================================================
// 3. Всплывающая подсказка
// ============================================================================

// Один общий элемент подсказки на всю страницу (он есть в index.html)
const tooltip = document.getElementById('tooltip');

/**
 * Показать подсказку возле курсора (x, y).
 * rows — строки подсказки: [{ value: 3, label: 'аварии · 10 %', color: '#ff7d2e' }]
 */
function showTooltip(title, rows, x, y) {
    tooltip.replaceChildren();   // убираем прошлое содержимое
    el('div', { class: 'tip-title' }, tooltip, title);
    for (const item of rows) {
        const row = el('div', { class: 'tip-row' }, tooltip);
        el('span', { class: 'tip-key', style: `background: ${item.color}` }, row);   // цветная метка
        el('span', {}, row, numberFormat.format(item.value));
        el('span', { class: 'tip-label' }, row, item.label);
    }
    tooltip.hidden = false;

    // ставим правее и ниже курсора, но не даём вылезти за края окна
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;

    let left = x + 14;
    if (left > innerWidth - width - 8) {
        left = innerWidth - width - 8;   // упёрлись в правый край
    }
    if (left < 8) {
        left = 8;                        // упёрлись в левый край
    }

    let top = y + 14;
    if (top + height > innerHeight - 8) {
        top = y - height - 10;           // снизу не помещается — показываем над курсором
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

/**
 * Показывать подсказку, пока курсор над элементом.
 * getContent() вызывается при каждом движении мыши и возвращает { title, rows } для showTooltip.
 */
function attachTooltip(element, getContent) {
    element.addEventListener('pointermove', function (event) {
        const content = getContent();
        showTooltip(content.title, content.rows, event.clientX, event.clientY);
    });
    element.addEventListener('pointerleave', function () {
        tooltip.hidden = true;
    });
}


// ============================================================================
// 4. Кольцевая диаграмма
// ============================================================================

// Размеры кольца в пикселях
const DONUT_SIZE = 180;                  // ширина и высота рисунка
const DONUT_CENTER = DONUT_SIZE / 2;     // центр кольца (и по x, и по y)
const OUTER_RADIUS = 86;                 // внешний край кольца
const INNER_RADIUS = 56;                 // внутренний край — «дырка» в центре
const MIN_ANGLE_FOR_LETTER = 0.35;       // буква на секторе — только если он не уже ~20° (угол в радианах)

/** Точка на окружности радиуса radius под углом angle (в радианах; 0 — сверху, дальше по часовой): «x,y» */
function pointOnCircle(radius, angle) {
    const x = DONUT_CENTER + radius * Math.sin(angle);
    const y = DONUT_CENTER - radius * Math.cos(angle);
    return `${x},${y}`;
}

/**
 * Контур сектора кольца от угла startAngle до endAngle — строка для атрибута d у SVG-элемента <path>.
 * Порядок: M — встать на внешний край, A — дуга по внешнему краю, L — линия к внутреннему краю,
 * A — дуга по внутреннему краю обратно, Z — замкнуть контур.
 */
function sectorPath(startAngle, endAngle) {
    // дугу больше половины круга SVG нужно явно пометить как «большую», иначе он нарисует короткую
    let largeArc = 0;
    if (endAngle - startAngle > Math.PI) {
        largeArc = 1;
    }
    return `M${pointOnCircle(OUTER_RADIUS, startAngle)}`
        + `A${OUTER_RADIUS},${OUTER_RADIUS} 0 ${largeArc} 1 ${pointOnCircle(OUTER_RADIUS, endAngle)}`
        + `L${pointOnCircle(INNER_RADIUS, endAngle)}`
        + `A${INNER_RADIUS},${INNER_RADIUS} 0 ${largeArc} 0 ${pointOnCircle(INNER_RADIUS, startAngle)}`
        + 'Z';
}

/**
 * Кольцевая диаграмма с легендой справа. Рисует внутрь host, заменяя то, что там было.
 *   parts — части кольца, по одной на степень:
 *           [{ label: 'Частичная', short: 'Ч', sub: '21–50%', value: 10, color: '#fbc22c' }, …]
 *           label — название (для подсказок), short — буква на секторе, sub — диапазон, value — сколько аварий
 *   selected — номер выбранной степени или null
 *   onSelect(i) — что делать при клике на сектор или строку легенды
 */
export function renderDonut(host, options) {
    const parts = options.parts;
    const selected = options.selected;
    const onSelect = options.onSelect;

    const values = [];
    for (const part of parts) {
        values.push(part.value);
    }
    const total = sum(values);   // всего аварий

    const wrapper = el('div', { class: 'donut' });
    const svg = svgEl('svg', {
        viewBox: `0 0 ${DONUT_SIZE} ${DONUT_SIZE}`,
        width: DONUT_SIZE,
        height: DONUT_SIZE,
        role: 'img',
        'aria-label': 'Доли аварий по степеням деградации',
    }, wrapper);

    // аварий нет — рисуем пустое серое кольцо
    if (total === 0) {
        svgEl('circle', {
            cx: DONUT_CENTER,
            cy: DONUT_CENTER,
            r: (OUTER_RADIUS + INNER_RADIUS) / 2,          // круг посередине между краями кольца…
            fill: 'none',
            stroke: 'var(--line)',
            'stroke-width': OUTER_RADIUS - INNER_RADIUS,   // …с обводкой толщиной во всё кольцо
        }, svg);
    }

    drawSectors(svg, parts, total, selected, onSelect);
    drawCenter(svg, parts, total, selected);
    drawLegend(wrapper, parts, total, selected, onSelect);

    host.replaceChildren(wrapper);
}

/** Секторы кольца: по одному на каждую степень, где есть аварии; на достаточно широких — буква степени */
function drawSectors(svg, parts, total, selected, onSelect) {
    let startAngle = 0;   // секторы идут по часовой стрелке, начиная сверху

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part.value) {
            continue;   // у степени нет аварий — сектора нет
        }

        // доля аварий → доля круга (полный круг — 2π радиан)
        const endAngle = startAngle + (part.value / total) * 2 * Math.PI;
        const isWholeRing = part.value === total;

        // если все аварии одной степени — сектор на весь круг. Дугу ровно в 360° SVG не рисует
        // (начало совпадает с концом), поэтому рисуем две половины
        let path = sectorPath(startAngle, endAngle);
        let className = 'slice';
        if (isWholeRing) {
            path = sectorPath(0, Math.PI) + sectorPath(Math.PI, 2 * Math.PI);
            className = 'slice full';
        }
        const slice = svgEl('path', { d: path, fill: part.color, class: className }, svg);
        if (isDimmed(i, selected)) {
            slice.classList.add('dim');
        }

        // буква степени посередине сектора — чтобы степени различались не только цветом
        if (endAngle - startAngle >= MIN_ANGLE_FOR_LETTER) {
            const middleAngle = (startAngle + endAngle) / 2;
            const middleRadius = (OUTER_RADIUS + INNER_RADIUS) / 2;
            const letter = svgEl('text', {
                class: 'slice-num',
                x: DONUT_CENTER + middleRadius * Math.sin(middleAngle),
                y: DONUT_CENTER - middleRadius * Math.cos(middleAngle) + 4,   // +4 — опустить на полвысоты буквы
                fill: inkFor(part.color),
            }, svg);
            letter.textContent = part.short;
            if (isDimmed(i, selected)) {
                letter.classList.add('dim');
            }
        }

        // клик — выбрать степень; наведение — подсказка «Частичная · 21–50%: 10 аварий · 34 %»
        slice.addEventListener('click', function () {
            onSelect(i);
        });
        attachTooltip(slice, function () {
            const label = `${accidentsWord(part.value)} · ${percentFormat.format(part.value / total)}`;
            return {
                title: `${part.label} · ${part.sub}`,
                rows: [{ value: part.value, label: label, color: part.color }],
            };
        });

        startAngle = endAngle;   // следующий сектор начинается там, где закончился этот
    }
}

/**
 * Подпись в центре кольца. Ничего не выбрано — всего аварий: «29» и «аварий».
 * Выбрана степень — сколько аварий этой степени и какая это доля: «10» и «34 %».
 */
function drawCenter(svg, parts, total, selected) {
    let value = total;
    let caption = accidentsWord(total);
    if (selected !== null) {
        value = parts[selected].value;
        caption = '';   // аварий нет вообще — долю не посчитать, подпись пустая
        if (total > 0) {
            caption = percentFormat.format(value / total);
        }
    }

    const valueText = svgEl('text', { x: DONUT_CENTER, y: DONUT_CENTER + 4, class: 'donut-value' }, svg);
    valueText.textContent = numberFormat.format(value);
    const captionText = svgEl('text', { x: DONUT_CENTER, y: DONUT_CENTER + 24, class: 'donut-label' }, svg);
    captionText.textContent = caption;
}

/** Легенда справа от кольца: по строке на степень — цвет, диапазон, сколько аварий и какая это доля */
function drawLegend(wrapper, parts, total, selected, onSelect) {
    const legend = el('div', { class: 'donut-legend' }, wrapper);

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        let share = '—';   // аварий нет вообще — долю не посчитать
        if (total > 0) {
            share = percentFormat.format(part.value / total);
        }

        // название степени в строке не пишем — оно во всплывающей подсказке и для экранного диктора
        const row = el('button', {
            type: 'button',
            class: 'legend-row',
            'aria-pressed': String(selected === i),
            title: part.label,
            'aria-label': `${part.label}, ${part.sub}: ${numberFormat.format(part.value)}, ${share}`,
        }, legend);
        if (isDimmed(i, selected)) {
            row.classList.add('dim');
        }
        el('span', { class: 'key', style: `background: ${part.color}` }, row);    // цветной квадратик
        el('span', { class: 'muted' }, row, part.sub);                           // диапазон «21–50%»
        el('span', { class: 'legend-value' }, row, numberFormat.format(part.value));
        el('span', { class: 'muted legend-pct' }, row, share);

        row.addEventListener('click', function () {
            onSelect(i);
        });
    }
}


// ============================================================================
// 5. Полосы по сервисам
// ============================================================================

/**
 * Полосы по сервисам: у каждого сервиса полоса из цветных кусков — сколько у него аварий каждой степени.
 *   items — [{ name: 'Сервис 4', parts: [5, 6, 1, 0] }] — количество аварий по степеням
 *   colors, names — цвета и названия степеней
 *   selected — номер выбранной степени или null; если степень выбрана — на полосах только она
 *   max — самое большое значение среди всех карточек: от него считается длина полос,
 *         поэтому полосы в разных карточках можно сравнивать
 * Сервисы без аварий не показываем, остальные — от большего к меньшему.
 */
export function renderServiceBars(host, options) {
    const items = options.items;
    const colors = options.colors;
    const names = options.names;
    const selected = options.selected;
    const max = options.max;

    // сколько аварий показываем у каждого сервиса: все, или только выбранной степени
    const shown = [];
    for (const item of items) {
        let value = sum(item.parts);
        if (selected !== null) {
            value = item.parts[selected];
        }
        if (value > 0) {
            shown.push({ name: item.name, parts: item.parts, value: value });
        }
    }
    // от большего к меньшему; у сервисов с равным значением сохраняется исходный порядок
    shown.sort(function (a, b) {
        return b.value - a.value;
    });

    if (shown.length === 0) {
        host.replaceChildren(el('p', { class: 'empty' }, null, 'Аварий нет'));
        return;
    }

    const list = el('div', { class: 'bars' });
    for (const service of shown) {
        const row = el('div', { class: 'bars-row' }, list);
        el('div', {}, row, service.name);
        const line = el('div', { class: 'bar-line' }, row);

        // длина полосы — доля от самого большого значения; 3em оставляем под число справа от полосы
        const bar = el('div', { class: 'bar', style: `width: calc((100% - 3em) * ${service.value / max})` }, line);

        // куски полосы: по одному на степень, длина — по количеству аварий
        for (let i = 0; i < service.parts.length; i++) {
            const count = service.parts[i];
            if (!count || isDimmed(i, selected)) {
                continue;   // у степени нет аварий или выбрана другая степень — куска нет
            }
            const piece = el('span', { style: `flex-grow: ${count}; background: ${colors[i]}` }, bar);
            attachTooltip(piece, function () {
                return { title: service.name, rows: [{ value: count, label: names[i].toLowerCase(), color: colors[i] }] };
            });
        }

        el('span', { class: 'bar-value' }, line, numberFormat.format(service.value));
    }
    host.replaceChildren(list);
}


// ============================================================================
// 6. Таблица «как в Excel»
// ============================================================================

// Самая узкая допустимая колонка диапазона, в пикселях: шире самой длинной подписи («91–100»)
const VALUE_COL_MIN = 56;

/**
 * Разложить строки по группам с одинаковым ключом, сохраняя порядок, в котором группы встретились.
 * Например, groupBy(rows, row => row.category_id) → [[сервисы группы 1], [сервисы группы 3], …]
 */
function groupBy(rows, getKey) {
    const groups = new Map();   // ключ → список строк; Map помнит порядок, в котором ключи появились
    for (const row of rows) {
        const key = getKey(row);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(row);
    }
    return Array.from(groups.values());
}

/**
 * Таблица одной метрики: строка «Всего», под ней группы операций с подытогом, в каждой группе — её сервисы.
 * Рисует внутрь host, заменяя то, что там было.
 *   metric — метрика, для которой строим таблицу: { id, label }
 *   columns — колонки диапазонов [{ from: 21, to: 30, sev: 1 }], sev — номер степени колонки.
 *             Колонки общие для всех метрик, поэтому таблицы разных метрик совпадают столбец в столбец
 *   rows — сервисы; rows[].counts[id метрики] — сколько аварий попало в каждую колонку
 *   colors — цвета степеней; selected — номер выбранной степени или null
 */
export function renderTable(host, options) {
    const metric = options.metric;
    const columns = options.columns;
    const rows = options.rows;
    const colors = options.colors;
    const selected = options.selected;

    // ячейки с числами для одной строки: counts[i] — сколько аварий в колонке i
    function addValueCells(tr, counts) {
        for (let i = 0; i < counts.length; i++) {
            const cell = el('td', {}, tr, numberFormat.format(counts[i]));
            paintCell(cell, counts[i], colors[columns[i].sev]);
            if (isDimmed(columns[i].sev, selected)) {
                cell.classList.add('dim');
            }
        }
    }

    const table = el('table', { class: 'grid' });
    addColumnGroup(table, columns.length);
    addHeader(table, columns, colors, selected);

    const body = el('tbody', {}, table);

    // строка «Всего» — по всем показанным сервисам
    const totalRow = el('tr', { class: 'sum' }, body);
    el('td', { colspan: 3, class: 'name' }, totalRow, 'Всего');
    addValueCells(totalRow, sumByColumn(rows, metric, columns.length));

    for (const groupRows of groupBy(rows, function (row) { return row.category_id; })) {
        // строка группы операций с подытогом по её сервисам
        const groupRow = el('tr', { class: 'sum' }, body);
        el('td', { colspan: 3, class: 'name' }, groupRow, groupRows[0].category);
        addValueCells(groupRow, sumByColumn(groupRows, metric, columns.length));

        // сервисы группы. Номер и название операции пишем один раз — в ячейку высотой во все её сервисы (rowspan)
        for (const operationRows of groupBy(groupRows, function (row) { return row.operation_id; })) {
            for (let i = 0; i < operationRows.length; i++) {
                const row = operationRows[i];
                const tr = el('tr', {}, body);
                if (i === 0) {
                    el('td', { rowspan: operationRows.length }, tr, String(row.operation_num));
                    el('td', { rowspan: operationRows.length, class: 'name' }, tr, row.operation);
                }
                el('td', { class: 'name' }, tr, row.service);
                addValueCells(tr, row.counts[metric.id]);
            }
        }
    }

    host.replaceChildren(table);
}

/** Описание колонок таблицы: три колонки названий и все колонки диапазонов. Ширину им потом задаст equalizeColumns */
function addColumnGroup(table, valueColumnCount) {
    const colgroup = el('colgroup', {}, table);
    for (let i = 0; i < 3; i++) {
        el('col', { class: 'name-col' }, colgroup);       // №, операция, сервис
    }
    el('col', { span: valueColumnCount }, colgroup);       // колонки диапазонов — одним описанием на все
}

/** Строка заголовков: «№ / Операция / Сервис» и подписи диапазонов на цвете своей степени */
function addHeader(table, columns, colors, selected) {
    const head = el('tr', {}, el('thead', {}, table));
    for (const title of ['№', 'Операция', 'Сервис']) {
        el('th', { class: 'name' }, head, title);
    }
    for (const column of columns) {
        const cell = el('th', { class: 'bucket' }, head, columnTitle(column));
        const color = colors[column.sev];
        cell.style.backgroundColor = color;
        cell.style.color = inkFor(color);
        if (isDimmed(column.sev, selected)) {
            cell.classList.add('dim');
        }
    }
}

/** Подпись колонки: «21–30», а если колонка шириной в один процент — просто «31» */
function columnTitle(column) {
    if (column.from === column.to) {
        return String(column.from);
    }
    return `${column.from}–${column.to}`;
}

/** Сумма по колонкам для нескольких сервисов: сколько аварий у них всех вместе в каждой колонке */
function sumByColumn(rows, metric, columnCount) {
    const totals = [];
    for (let i = 0; i < columnCount; i++) {
        let total = 0;
        for (const row of rows) {
            total = total + row.counts[metric.id][i];
        }
        totals.push(total);
    }
    return totals;
}

/**
 * Покрасить ячейку цветом степени её колонки:
 * есть аварии — чуть высветленный цвет и жирное число, нет — бледный оттенок и серый ноль.
 */
function paintCell(cell, count, color) {
    if (count) {
        const fill = lighten(color, 0.25);
        cell.style.backgroundColor = fill;
        cell.style.color = inkFor(fill);
        cell.classList.add('nz');   // nz = non-zero; в CSS такие числа жирные
    } else {
        cell.style.backgroundColor = tint(color, 0.16);
        cell.style.color = 'var(--text-2)';
    }
}

/**
 * Сделать колонки диапазонов строго одинаковой ширины.
 * В обычной раскладке браузер раздаёт свободное место пропорционально содержимому, и колонка
 * с длинной подписью («91–100») выходит шире остальных. Поэтому:
 *   1. берём ширину колонок №, операции и сервиса такой, какой её только что посчитал браузер (по содержимому);
 *   2. закрепляем её;
 *   3. переключаем таблицу на фиксированную раскладку — там остаток ширины делится между колонками поровну.
 * Если места меньше, чем VALUE_COL_MIN на колонку, таблица не сжимается, а прокручивается.
 * Вызывать, когда таблица уже на странице — иначе мерить нечего.
 */
export function equalizeColumns(table) {
    // 1. ширина колонок с названиями
    const nameWidths = [];
    for (const th of table.querySelectorAll('thead th.name')) {
        nameWidths.push(th.getBoundingClientRect().width);
    }

    // 2. закрепляем её у описаний колонок
    const nameColumns = table.querySelectorAll('col.name-col');
    for (let i = 0; i < nameColumns.length; i++) {
        nameColumns[i].style.width = `${nameWidths[i]}px`;
    }

    // таблица не уже, чем названия + колонки диапазонов по VALUE_COL_MIN + промежутки между ячейками
    // (промежутков на один больше, чем колонок: колонок диапазонов valueCount и ещё 3 колонки названий)
    const valueCount = table.querySelectorAll('thead th.bucket').length;
    let spacing = parseFloat(getComputedStyle(table).borderSpacing);   // промежуток между ячейками из CSS
    if (Number.isNaN(spacing)) {
        spacing = 0;
    }
    table.style.minWidth = `${sum(nameWidths) + valueCount * VALUE_COL_MIN + (valueCount + 4) * spacing}px`;

    // 3. фиксированная раскладка
    table.style.tableLayout = 'fixed';
}
