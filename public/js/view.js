// view.js — всё отображение страницы: шкала степеней (по ней выбирают степень) и карточки метрик
// (слева кольцо, легенда и полосы сервисов, справа таблица). Что посчитать — берём из calc.js.
//
// Что здесь происходит, по порядку:
//   1. Помощники: SVG-элементы, формат чисел, склонения, чип сервиса.
//   2. render() — перерисовать страницу: выбор на шкале степеней и карточки метрик.
//   3. Всплывающая подсказка.
//   4. Кольцевая диаграмма (SVG) с легендой.
//   5. Полосы по сервисам.
//   6. Таблица «как в Excel» и выравнивание её колонок.
//
// Сторонних библиотек нет — всё рисуется обычными HTML- и SVG-элементами.
// Тексты из данных вставляются только через textContent: так они не могут превратиться в HTML-код.
// Отсюда другие модули берут: render и renderStepenScale.
// Название сервиса в таблице — кнопка-чип: по нажатию открывается окно его степеней (service-dialog.js).

import { STEPEN_BOUNDS, STEPEN_NAMES, STEPEN_COLORS } from './config.js';
import { state } from './state.js';
import {
    buildServiceStats, rowsOfSelectedProduct, getStepenRanges, maxShownCount, formatRange, sum,
    buildTableColumns, buildTableRows, stepenOf,
} from './calc.js';
import { byId, createElement } from './dom.js';
import { openServiceDialog } from './service-dialog.js';


// ============================================================================
// 1. Помощники
// ============================================================================

// Пространство имён SVG: без него браузер создаст обычный HTML-элемент, а не SVG-фигуру
const SVG_NS = 'http://www.w3.org/2000/svg';

// Числа по-русски: 1234 → «1 234», 0.48 → «48 %»
const numberFormat = new Intl.NumberFormat('ru-RU');
const percentFormat = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0 });

// Правила русских склонений после числа: 1 авария, 2 аварии, 5 аварий
const pluralRules = new Intl.PluralRules('ru-RU');

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

/** То же, что createElement, но для SVG-фигур (круг, контур, текст внутри <svg>) */
function createSvgElement(tag, attrs, parent) {
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
function isDimmed(index) {
    return state.selectedStepen !== null && state.selectedStepen !== index;
}

/**
 * Чип сервиса — название сервиса кнопкой: по нажатию открывается окно его степеней деградации.
 * У сервиса со своими границами степеней чип синий (класс custom) — видно, что он изменён.
 * После сохранения или сброса в окне страница перерисовывается (render).
 */
function createServiceChip(serviceId, name, isCustom, parent) {
    const chip = createElement('button', {
        type: 'button',
        class: isCustom ? 'service-chip custom' : 'service-chip',
        'aria-haspopup': 'dialog',
        title: isCustom ? 'Свои границы степеней — нажмите, чтобы изменить' : 'Нажмите, чтобы задать свои границы степеней',
    }, parent, name);
    chip.addEventListener('click', function () {
        openServiceDialog(serviceId, render);
    });
    return chip;
}


// ============================================================================
// 2. render() — перерисовать страницу
// ============================================================================

/** Перерисовать всё, что зависит от данных и выбора: подсветку шкалы и карточки метрик */
export function render() {
    const ranges = getStepenRanges();
    const rows = rowsOfSelectedProduct();
    const metrics = state.data.metrics;

    markSelectedStepen();

    // для каждой метрики — сколько аварий каждой степени у каждого сервиса
    const statsByMetric = [];
    for (const metric of metrics) {
        statsByMetric.push(buildServiceStats(rows, metric));
    }

    // общий масштаб полос — самое большое значение среди всех метрик (не меньше 1)
    const maxCount = maxShownCount(statsByMetric);

    // колонки таблиц — диапазоны по 10%, одинаковые для всех метрик
    const columns = buildTableColumns();
    const tableRows = buildTableRows(rows);

    // по раскрывающемуся блоку на метрику: надпись и под ней карточка
    const container = byId('metric-rows');
    container.replaceChildren();   // убираем старые блоки
    for (let i = 0; i < metrics.length; i++) {
        const card = buildMetricCard(metrics[i], statsByMetric[i], ranges, maxCount, columns, tableRows);
        container.append(buildMetricBlock(metrics[i], card));
    }

    // таблицы раскрытых карточек уже на странице — выравниваем колонки диапазонов по ширине.
    // У скрытых карточек мерить нечего: их таблицы выравниваются в момент раскрытия (buildMetricBlock)
    const tables = document.querySelectorAll('#metric-rows details[open] table.grid');
    for (const table of tables) {
        equalizeColumns(table);
    }
}

/**
 * Шкала степеней над карточками — рисуется один раз при запуске, границы постоянные (STEPEN_BOUNDS):
 * цветные отрезки с названием степени и деления 0, 10, … 100 под шкалой.
 * Отрезок — кнопка: клик выбирает степень, повторный клик снимает выбор (снова видны все степени).
 */
export function renderStepenScale() {
    const ranges = getStepenRanges();

    // отрезки шкалы: ширина — по размеру диапазона степени, фон — её цвет с лёгким градиентом
    for (let i = 0; i < ranges.length; i++) {
        const color = ranges[i].color;
        const segment = createElement('button', { type: 'button', title: formatRange(ranges[i]) }, byId('range-track'));
        // ширина — расстояние между границами (20, 30, 30, 20), чтобы стыки цветов пришлись на деления 20, 50, 80
        segment.style.flexGrow = ranges[i].to - (i > 0 ? ranges[i - 1].to : 0);
        segment.style.background = `linear-gradient(90deg, color-mix(in srgb, ${color} 86%, #fff), ${color})`;
        segment.style.color = ranges[i].textColor;   // чёрный или белый текст — что лучше читается на этом цвете
        createElement('b', {}, segment, ranges[i].name);   // название степени — жирным, по центру отрезка
        segment.addEventListener('click', function () {
            toggleStepen(i);
        });
    }

    // деления под шкалой: 0, 10, 20, … 100
    for (let value = 0; value <= 100; value += 10) {
        createElement('span', { style: `left: ${value}%` }, byId('range-scale'), String(value));
    }
}

/** Клик по отрезку шкалы, сектору кольца или строке легенды: выбрать степень; повторный клик — снять выбор */
function toggleStepen(i) {
    state.selectedStepen = state.selectedStepen === i ? null : i;
    render();
}

/** Подсветить выбор на шкале: выбранная степень яркая, остальные приглушены (как секторы кольца) */
function markSelectedStepen() {
    const segments = byId('range-track').children;
    for (let i = 0; i < segments.length; i++) {
        segments[i].classList.toggle('dimmed', isDimmed(i));
        segments[i].setAttribute('aria-pressed', String(state.selectedStepen === i));
    }
}

/**
 * Карточка одной метрики: слева сводка (кольцо, легенда, полосы сервисов), справа таблица.
 *   metric — метрика ({ id, name, label }), stats — статистика её сервисов из buildServiceStats,
 *   ranges — диапазоны степеней, maxCount — общий масштаб полос, columns и tableRows — данные таблицы
 */
function buildMetricCard(metric, stats, ranges, maxCount, columns, tableRows) {
    const card = createElement('section', { class: 'card metric-card' });

    // ---------- слева: сводка ----------
    // название метрики не здесь, а в надписи над карточкой (buildMetricBlock)
    const summary = createElement('div', { class: 'metric-summary' }, card);

    // кольцо: сколько всего аварий каждой степени
    const donutParts = [];
    for (let stepen = 0; stepen < 4; stepen++) {
        let total = 0;
        for (const item of stats) {
            total = total + item.stepenCounts[stepen];
        }
        donutParts.push({
            name: ranges[stepen].name,
            letter: ranges[stepen].letter,
            rangeLabel: formatRange(ranges[stepen]),
            count: total,
            color: ranges[stepen].color,
            textColor: ranges[stepen].textColor,
        });
    }
    renderDonut(createElement('div', {}, summary), donutParts);

    // заголовок над полосами: «Сервисы» или, если выбрана степень, «Сервисы · частичная деградация»
    const title = state.selectedStepen === null ? 'Сервисы' : `Сервисы · ${ranges[state.selectedStepen].name.toLowerCase()} деградация`;
    createElement('h3', {}, summary, title);

    // полосы по сервисам
    renderServiceBars(createElement('div', {}, summary), stats, maxCount);

    // ---------- справа: детализация (таблица) ----------
    const detail = createElement('div', { class: 'metric-detail' }, card);
    createElement('div', { class: 'detail-title muted' }, detail, 'Детализация');
    renderTable(createElement('div', { class: 'table-wrap' }, detail), metric, columns, tableRows);

    return card;
}

/**
 * Раскрывающийся блок метрики: надпись («Без учета 5 минут») и под ней карточка.
 * Сделан на стандартных <details>/<summary>: браузер сам раскрывает и скрывает карточку по нажатию
 * на надпись (и с клавиатуры). Какие блоки раскрыты, запоминаем в state.openMetrics —
 * иначе после каждой перерисовки (например, при выборе продукта или степени) блоки снова скрывались бы.
 */
function buildMetricBlock(metric, card) {
    const block = createElement('details', { class: 'metric-block' });
    block.open = state.openMetrics[metric.id] === true;
    createElement('summary', {}, block, metric.label);
    block.append(card);

    block.addEventListener('toggle', function () {
        state.openMetrics[metric.id] = block.open;
        // скрытую таблицу измерить нельзя — выравниваем колонки, когда карточку раскрыли
        if (block.open) {
            equalizeColumns(block.querySelector('table.grid'));
        }
    });
    return block;
}


// ============================================================================
// 3. Всплывающая подсказка
// ============================================================================

// Один общий элемент подсказки на всю страницу (он есть в index.html)
const tooltip = byId('tooltip');

/**
 * Показать подсказку возле курсора (x, y).
 * rows — строки подсказки: [{ value: 3, label: 'аварии · 10 %', color: '#ff7d2e' }]
 */
function showTooltip(title, rows, x, y) {
    tooltip.replaceChildren();   // убираем прошлое содержимое
    createElement('div', { class: 'tooltip-title' }, tooltip, title);
    for (const item of rows) {
        const row = createElement('div', { class: 'tooltip-row' }, tooltip);
        createElement('span', { class: 'tooltip-key', style: `background: ${item.color}` }, row);   // цветная метка
        createElement('span', {}, row, numberFormat.format(item.value));
        createElement('span', { class: 'tooltip-label' }, row, item.label);
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

    // ниже курсора; если снизу не помещается — над курсором
    const fitsBelow = y + 14 + height <= innerHeight - 8;
    const top = fitsBelow ? y + 14 : y - height - 10;

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
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    return `M${pointOnCircle(OUTER_RADIUS, startAngle)}`
        + `A${OUTER_RADIUS},${OUTER_RADIUS} 0 ${largeArc} 1 ${pointOnCircle(OUTER_RADIUS, endAngle)}`
        + `L${pointOnCircle(INNER_RADIUS, endAngle)}`
        + `A${INNER_RADIUS},${INNER_RADIUS} 0 ${largeArc} 0 ${pointOnCircle(INNER_RADIUS, startAngle)}`
        + 'Z';
}

/**
 * Кольцевая диаграмма с легендой справа. Рисует внутрь host, заменяя то, что там было.
 *   parts — части кольца, по одной на степень:
 *           [{ name: 'Частичная', letter: 'Ч', rangeLabel: '21–50%', count: 10, color: '#fbc22c', textColor: '#0b0b0b' }, …]
 *           name — название (для подсказок), letter — буква на секторе, rangeLabel — диапазон, count — сколько аварий,
 *           color — цвет сектора, textColor — цвет буквы на нём
 * Клик по сектору или строке легенды выбирает степень (toggleStepen).
 */
function renderDonut(host, parts) {
    const values = [];
    for (const part of parts) {
        values.push(part.count);
    }
    const total = sum(values);   // всего аварий

    const wrapper = createElement('div', { class: 'donut' });
    const svg = createSvgElement('svg', {
        viewBox: `0 0 ${DONUT_SIZE} ${DONUT_SIZE}`,
        width: DONUT_SIZE,
        height: DONUT_SIZE,
        role: 'img',
        'aria-label': 'Доли аварий по степеням деградации',
    }, wrapper);

    // аварий нет — рисуем пустое серое кольцо
    if (total === 0) {
        createSvgElement('circle', {
            cx: DONUT_CENTER,
            cy: DONUT_CENTER,
            r: (OUTER_RADIUS + INNER_RADIUS) / 2,          // круг посередине между краями кольца…
            fill: 'none',
            stroke: 'var(--line)',
            'stroke-width': OUTER_RADIUS - INNER_RADIUS,   // …с обводкой толщиной во всё кольцо
        }, svg);
    }

    drawSectors(svg, parts, total);
    drawCenter(svg, parts, total);
    drawLegend(wrapper, parts, total);

    host.replaceChildren(wrapper);
}

/** Секторы кольца: по одному на каждую степень, где есть аварии; на достаточно широких — буква степени */
function drawSectors(svg, parts, total) {
    let startAngle = 0;   // секторы идут по часовой стрелке, начиная сверху

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part.count) {
            continue;   // у степени нет аварий — сектора нет
        }

        // доля аварий → доля круга (полный круг — 2π радиан)
        const endAngle = startAngle + (part.count / total) * 2 * Math.PI;
        const isWholeRing = part.count === total;

        // если все аварии одной степени — сектор на весь круг. Дугу ровно в 360° SVG не рисует
        // (начало совпадает с концом), поэтому рисуем две половины
        const path = isWholeRing
            ? sectorPath(0, Math.PI) + sectorPath(Math.PI, 2 * Math.PI)
            : sectorPath(startAngle, endAngle);
        const className = isWholeRing ? 'slice full' : 'slice';
        const slice = createSvgElement('path', { d: path, fill: part.color, class: className }, svg);
        if (isDimmed(i)) {
            slice.classList.add('dimmed');
        }

        // буква степени посередине сектора — чтобы степени различались не только цветом
        if (endAngle - startAngle >= MIN_ANGLE_FOR_LETTER) {
            const middleAngle = (startAngle + endAngle) / 2;
            const middleRadius = (OUTER_RADIUS + INNER_RADIUS) / 2;
            const letter = createSvgElement('text', {
                class: 'slice-letter',
                x: DONUT_CENTER + middleRadius * Math.sin(middleAngle),
                y: DONUT_CENTER - middleRadius * Math.cos(middleAngle) + 4,   // +4 — опустить на полвысоты буквы
                fill: part.textColor,   // чёрная или белая буква — что лучше читается на цвете сектора
            }, svg);
            letter.textContent = part.letter;
            if (isDimmed(i)) {
                letter.classList.add('dimmed');
            }
        }

        // клик — выбрать степень; наведение — подсказка «Частичная · 21–50%: 10 аварий · 34 %»
        slice.addEventListener('click', function () {
            toggleStepen(i);
        });
        attachTooltip(slice, function () {
            const label = `${accidentsWord(part.count)} · ${percentFormat.format(part.count / total)}`;
            return {
                title: `${part.name} · ${part.rangeLabel}`,
                rows: [{ value: part.count, label: label, color: part.color }],
            };
        });

        startAngle = endAngle;   // следующий сектор начинается там, где закончился этот
    }
}

/**
 * Подпись в центре кольца. Ничего не выбрано — всего аварий: «29» и «аварий».
 * Выбрана степень — сколько аварий этой степени и какая это доля: «10» и «34 %».
 */
function drawCenter(svg, parts, total) {
    const selected = state.selectedStepen;
    const value = selected === null ? total : parts[selected].count;
    const share = total > 0 ? percentFormat.format(value / total) : '';   // аварий нет вообще — долю не посчитать
    const caption = selected === null ? accidentsWord(total) : share;

    const valueText = createSvgElement('text', { x: DONUT_CENTER, y: DONUT_CENTER + 4, class: 'donut-value' }, svg);
    valueText.textContent = numberFormat.format(value);
    const captionText = createSvgElement('text', { x: DONUT_CENTER, y: DONUT_CENTER + 24, class: 'donut-label' }, svg);
    captionText.textContent = caption;
}

/** Легенда справа от кольца: по строке на степень — цвет, диапазон, сколько аварий и какая это доля */
function drawLegend(wrapper, parts, total) {
    const legend = createElement('div', { class: 'donut-legend' }, wrapper);

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const share = total > 0 ? percentFormat.format(part.count / total) : '—';   // аварий нет вообще — долю не посчитать

        // название степени в строке не пишем — оно во всплывающей подсказке и для экранного диктора
        const row = createElement('button', {
            type: 'button',
            class: 'legend-row',
            'aria-pressed': String(state.selectedStepen === i),
            title: part.name,
            'aria-label': `${part.name}, ${part.rangeLabel}: ${numberFormat.format(part.count)}, ${share}`,
        }, legend);
        if (isDimmed(i)) {
            row.classList.add('dimmed');
        }
        createElement('span', { class: 'color-key', style: `background: ${part.color}` }, row);    // цветной квадратик
        createElement('span', { class: 'muted' }, row, part.rangeLabel);                           // диапазон «21–50%»
        createElement('span', { class: 'legend-value' }, row, numberFormat.format(part.count));
        createElement('span', { class: 'muted legend-percent' }, row, share);

        row.addEventListener('click', function () {
            toggleStepen(i);
        });
    }
}


// ============================================================================
// 5. Полосы по сервисам
// ============================================================================

/**
 * Полосы по сервисам: у каждого сервиса полоса из цветных кусков — сколько у него аварий каждой степени.
 *   stats — статистика из buildServiceStats: [{ name: 'Сервис 4', stepenCounts: [5, 6, 1, 0] }]
 *   maxCount — самое большое значение среди всех карточек: от него считается длина полос,
 *         поэтому полосы в разных карточках можно сравнивать
 * Если степень выбрана — на полосах только она. Сервисы без аварий не показываем, остальные — от большего к меньшему.
 */
function renderServiceBars(host, stats, maxCount) {
    // сколько аварий показываем у каждого сервиса: все, или только выбранной степени
    const visibleServices = [];
    for (const item of stats) {
        const shownCount = state.selectedStepen === null ? sum(item.stepenCounts) : item.stepenCounts[state.selectedStepen];
        if (shownCount > 0) {
            visibleServices.push({ name: item.name, stepenCounts: item.stepenCounts, shownCount: shownCount });
        }
    }
    // от большего к меньшему; у сервисов с равным значением сохраняется исходный порядок
    visibleServices.sort(function (a, b) {
        return b.shownCount - a.shownCount;
    });

    if (visibleServices.length === 0) {
        host.replaceChildren(createElement('p', { class: 'empty' }, null, 'Аварий нет'));
        return;
    }

    const list = createElement('div', { class: 'bars' });
    for (const service of visibleServices) {
        const row = createElement('div', { class: 'bars-row' }, list);
        createElement('div', {}, row, service.name);
        const line = createElement('div', { class: 'bar-line' }, row);

        // длина полосы — доля от самого большого значения; 3em оставляем под число справа от полосы
        const bar = createElement('div', { class: 'bar', style: `width: calc((100% - 3em) * ${service.shownCount / maxCount})` }, line);

        // куски полосы: по одному на степень, длина — по количеству аварий
        for (let i = 0; i < service.stepenCounts.length; i++) {
            const count = service.stepenCounts[i];
            if (!count || isDimmed(i)) {
                continue;   // у степени нет аварий или выбрана другая степень — куска нет
            }
            const color = STEPEN_COLORS[i].color;
            const piece = createElement('span', { style: `flex-grow: ${count}; background: ${color}` }, bar);
            attachTooltip(piece, function () {
                return { title: service.name, rows: [{ value: count, label: STEPEN_NAMES[i].toLowerCase(), color: color }] };
            });
        }

        createElement('span', { class: 'bar-value' }, line, numberFormat.format(service.shownCount));
    }
    host.replaceChildren(list);
}


// ============================================================================
// 6. Таблица «как в Excel»
// ============================================================================

// Самая узкая допустимая колонка диапазона, в пикселях: шире самой длинной подписи («91–100»)
const MIN_RANGE_COLUMN_WIDTH = 56;

/**
 * Разложить строки по группам с одинаковым ключом, сохраняя порядок, в котором группы встретились.
 * Например, groupBy(rows, row => row.product_id) → [[сервисы продукта 1], [сервисы продукта 3], …]
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
 * Таблица одной метрики: строка «Всего», под ней продукты с подытогом, в каждом продукте — его операции и сервисы.
 * Рисует внутрь host, заменяя то, что там было.
 *   metric — метрика, для которой строим таблицу
 *   columns — колонки диапазонов [{ from: 21, to: 30, stepen: 1 }], stepen — номер степени колонки.
 *             Колонки общие для всех метрик, поэтому таблицы разных метрик совпадают столбец в столбец
 *   rows — сервисы; rows[].columnCounts[id метрики] — сколько аварий попало в каждую колонку,
 *          rows[].bounds — границы степеней сервиса (свои или по умолчанию), rows[].isCustom — свои ли они
 */
function renderTable(host, metric, columns, rows) {
    // ячейки с числами для одной строки: counts[i] — сколько аварий в колонке i.
    // bounds — границы степеней строки. У сервиса со своими границами колонка может относиться
    // не к той степени, что в заголовке, — тогда ячейка красится цветом его степени
    function addValueCells(tr, counts, bounds) {
        for (let i = 0; i < counts.length; i++) {
            const stepen = stepenOf(columns[i].to, bounds);
            const cell = createElement('td', {}, tr, numberFormat.format(counts[i]));
            paintCell(cell, counts[i], STEPEN_COLORS[stepen]);
            if (isDimmed(stepen)) {
                cell.classList.add('dimmed');
            }
        }
    }

    const table = createElement('table', { class: 'grid' });
    addColumnGroup(table, columns.length);
    addHeader(table, columns);

    const body = createElement('tbody', {}, table);

    // строка «Всего» — по всем показанным сервисам
    const totalRow = createElement('tr', { class: 'sum' }, body);
    createElement('td', { colspan: 3, class: 'name' }, totalRow, 'Всего');
    addValueCells(totalRow, sumByColumn(rows, metric, columns.length), STEPEN_BOUNDS);

    for (const productRows of groupBy(rows, function (row) { return row.product_id; })) {
        // строка продукта с подытогом по его сервисам
        const productRow = createElement('tr', { class: 'sum' }, body);
        createElement('td', { colspan: 3, class: 'name' }, productRow, productRows[0].product);
        addValueCells(productRow, sumByColumn(productRows, metric, columns.length), STEPEN_BOUNDS);

        // сервисы группы. Номер и название операции пишем один раз — в ячейку высотой во все её сервисы (rowspan)
        for (const operationRows of groupBy(productRows, function (row) { return row.operation_id; })) {
            for (let i = 0; i < operationRows.length; i++) {
                const row = operationRows[i];
                const tr = createElement('tr', {}, body);
                if (i === 0) {
                    createElement('td', { rowspan: operationRows.length }, tr, String(row.operation_num));
                    createElement('td', { rowspan: operationRows.length, class: 'name' }, tr, row.operation);
                }
                const serviceCell = createElement('td', { class: 'name' }, tr);
                createServiceChip(row.service_id, row.service, row.isCustom, serviceCell);
                addValueCells(tr, row.columnCounts[metric.id], row.bounds);
            }
        }
    }

    host.replaceChildren(table);
}

/** Описание колонок таблицы: три колонки названий и все колонки диапазонов. Ширину им потом задаст equalizeColumns */
function addColumnGroup(table, valueColumnCount) {
    const colgroup = createElement('colgroup', {}, table);
    for (let i = 0; i < 3; i++) {
        createElement('col', { class: 'name-col' }, colgroup);       // №, операция, сервис
    }
    createElement('col', { span: valueColumnCount }, colgroup);       // колонки диапазонов — одним описанием на все
}

/** Строка заголовков: «№ / Операция / Сервис» и подписи диапазонов на цвете своей степени */
function addHeader(table, columns) {
    const head = createElement('tr', {}, createElement('thead', {}, table));
    for (const title of ['№', 'Операция', 'Сервис']) {
        createElement('th', { class: 'name' }, head, title);
    }
    for (const column of columns) {
        const cell = createElement('th', { class: 'range-column' }, head, columnTitle(column));
        cell.style.backgroundColor = STEPEN_COLORS[column.stepen].color;
        cell.style.color = STEPEN_COLORS[column.stepen].textColor;
        if (isDimmed(column.stepen)) {
            cell.classList.add('dimmed');
        }
    }
}

/** Подпись колонки: «21–30», а если колонка шириной в один процент — просто «31» */
function columnTitle(column) {
    return column.from === column.to ? String(column.from) : `${column.from}–${column.to}`;
}

/** Сумма по колонкам для нескольких сервисов: сколько аварий у них всех вместе в каждой колонке */
function sumByColumn(rows, metric, columnCount) {
    const totals = [];
    for (let i = 0; i < columnCount; i++) {
        let total = 0;
        for (const row of rows) {
            total = total + row.columnCounts[metric.id][i];
        }
        totals.push(total);
    }
    return totals;
}

/**
 * Покрасить ячейку цветом степени её колонки (colors — набор цветов степени из STEPEN_COLORS):
 * есть аварии — чуть высветленный цвет и жирное тёмное число, нет — бледный оттенок и серый ноль.
 */
function paintCell(cell, count, colors) {
    if (count) {
        cell.style.backgroundColor = colors.cellBackground;
        cell.classList.add('has-accidents');  
    } else {
        cell.style.backgroundColor = colors.emptyCellBackground;
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
 * Если места меньше, чем MIN_RANGE_COLUMN_WIDTH на колонку, таблица не сжимается, а прокручивается.
 * Вызывать, когда таблица уже на странице — иначе мерить нечего.
 */
function equalizeColumns(table) {
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

    // таблица не уже, чем названия + колонки диапазонов по MIN_RANGE_COLUMN_WIDTH + промежутки между ячейками
    // (промежутков на один больше, чем колонок: колонок диапазонов valueCount и ещё 3 колонки названий)
    const valueCount = table.querySelectorAll('thead th.range-column').length;
    const cssSpacing = parseFloat(getComputedStyle(table).borderSpacing);   // промежуток между ячейками из CSS
    const spacing = Number.isNaN(cssSpacing) ? 0 : cssSpacing;
    table.style.minWidth = `${sum(nameWidths) + valueCount * MIN_RANGE_COLUMN_WIDTH + (valueCount + 4) * spacing}px`;

    // 3. фиксированная раскладка
    table.style.tableLayout = 'fixed';
}
