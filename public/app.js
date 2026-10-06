// app.js — логика страницы.
//
// Что здесь происходит, по порядку:
//   1. Постоянные значения: названия степеней, настройки по умолчанию.
//   2. Состояние страницы (state): всё, что страница «помнит».
//   3. Настройки степеней: загрузка из браузера, проверка, сохранение, сдвиг границ.
//   4. Расчёты: степень для процента, колонки таблицы.
//   5. Панель настройки: ползунки, отрезки шкалы, плашки с цветом и числом.
//   6. Отрисовка: чипы, карточки метрик (кольцо, полосы сервисов, таблица).
//   7. Запуск: загрузка данных с сервера и первая отрисовка.
//
// Сами рисунки (кольцо, полосы, таблицу) рисуют функции из charts.js — отсюда мы только передаём им данные.
// el(тег, атрибуты, родитель, текст) из charts.js создаёт HTML-элемент и сразу вставляет его в родителя.
import { el, equalizeColumns, inkFor, renderDonut, renderServiceBars, renderTable, sum } from './charts.js';


// ============================================================================
// 1. Постоянные значения
// ============================================================================

// Названия четырёх степеней деградации (по МУ по управлению авариями)
const DEGREES = ['Минимальная', 'Частичная', 'Значительная', 'Полная'];

// Шаг, с которым двигаются границы между степенями, в процентах
const STEP = 1;

// Под каким именем настройки хранятся в браузере.
// v3: сменилась палитра по умолчанию — старые сохранённые цвета не подхватываем
const STORAGE_KEY = 'demotask.severity.v3';

// Минимальный зазор (в пикселях) между подписью на шкале и ручкой ползунка
const LABEL_GAP = 8;

/**
 * Настройки по умолчанию.
 *   bounds — верхние границы первых трёх степеней:
 *            минимальная 0–20%, частичная 21–50%, значительная 51–80%, полная — остальное до 100%.
 *   colors — цвета степеней: зелёный, жёлтый, оранжевый, красный.
 * Функция каждый раз создаёт новый объект, чтобы изменения настроек не портили значения по умолчанию.
 */
function defaultSettings() {
    return {
        bounds: [20, 50, 80],
        colors: ['#4bd163', '#fbc22c', '#ff7d2e', '#dc2f3a'],
    };
}

/** Найти элемент страницы по его id */
function byId(id) {
    return document.getElementById(id);
}


// ============================================================================
// 2. Состояние страницы
// ============================================================================

const state = {
    data: null,                 // данные с сервера (ответ /api/data)
    metrics: [],                // метрики с короткими названиями: [{ id, label }]
    opcat: '',                  // выбранная группа операций; '' — все группы
    selected: null,             // выбранная степень: 0..3, или null — «все»
    settings: loadSettings(),   // границы и цвета степеней
    controls: null,             // элементы панели настройки — чтобы потом их обновлять
};


// ============================================================================
// 3. Настройки степеней: загрузка, проверка, сохранение, сдвиг границ
// ============================================================================

/** Прочитать настройки, сохранённые в браузере. Если их нет или они испорчены — вернуть настройки по умолчанию */
function loadSettings() {
    try {
        const text = localStorage.getItem(STORAGE_KEY);   // сохранённый текст или null, если ничего нет
        const saved = JSON.parse(text);                    // текст → объект
        if (isValidSettings(saved)) {
            return saved;
        }
    } catch (error) {
        // нет доступа к хранилищу или в нём битые данные — возьмём настройки по умолчанию
    }
    return defaultSettings();
}

/** Сохранить текущие настройки в браузере */
function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    } catch (error) {
        // не получилось сохранить — не страшно, страница всё равно работает
    }
}

/** Проверить настройки: 3 границы по возрастанию (каждая меньше 100) и 4 цвета вида #RRGGBB */
function isValidSettings(settings) {
    if (settings === null || typeof settings !== 'object') {
        return false;
    }

    // --- границы ---
    const bounds = settings.bounds;
    if (!Array.isArray(bounds) || bounds.length !== 3) {
        return false;
    }
    for (let i = 0; i < 3; i++) {
        // для первой границы «предыдущая» — это 0
        let previous = 0;
        if (i > 0) {
            previous = bounds[i - 1];
        }
        const fitsStep = bounds[i] % STEP === 0;          // кратна шагу
        const biggerThanPrevious = bounds[i] > previous;  // идёт по возрастанию
        const lessThan100 = bounds[i] < 100;
        if (!fitsStep || !biggerThanPrevious || !lessThan100) {
            return false;
        }
    }

    // --- цвета ---
    const colors = settings.colors;
    if (!Array.isArray(colors) || colors.length !== 4) {
        return false;
    }
    for (const color of colors) {
        if (!isHexColor(color)) {
            return false;
        }
    }

    return true;
}

/** Цвет вида #RRGGBB: решётка и ровно 6 шестнадцатеричных цифр (0–9, a–f, большими или маленькими буквами) */
function isHexColor(text) {
    if (typeof text !== 'string' || text.length !== 7 || text[0] !== '#') {
        return false;
    }
    const allowed = '0123456789abcdef';
    for (let i = 1; i < 7; i++) {
        const char = text[i].toLowerCase();
        if (!allowed.includes(char)) {
            return false;
        }
    }
    return true;
}

/**
 * Поставить границу номер i (0, 1 или 2) в значение value.
 * Соседние границы при необходимости сдвигаются, чтобы у каждой степени остался хотя бы один процент.
 */
function setBound(i, value) {
    const bounds = state.settings.bounds;

    // 1. Округляем до шага
    let newBound = Math.round(value / STEP) * STEP;

    // 2. Не пускаем границу слишком близко к краям шкалы:
    //    слева от неё должны поместиться i + 1 степеней, справа — 3 - i степеней, по шагу на каждую
    const lowest = STEP * (i + 1);
    const highest = 100 - STEP * (3 - i);
    if (newBound < lowest) {
        newBound = lowest;
    }
    if (newBound > highest) {
        newBound = highest;
    }
    bounds[i] = newBound;

    // 3. Каждая граница правее должна быть хотя бы на шаг больше предыдущей — иначе двигаем её вправо
    for (let j = i + 1; j < 3; j++) {
        const minimum = bounds[j - 1] + STEP;
        if (bounds[j] < minimum) {
            bounds[j] = minimum;
        }
    }

    // 4. Каждая граница левее должна быть хотя бы на шаг меньше следующей — иначе двигаем её влево
    for (let j = i - 1; j >= 0; j--) {
        const maximum = bounds[j + 1] - STEP;
        if (bounds[j] > maximum) {
            bounds[j] = maximum;
        }
    }
}


// ============================================================================
// 4. Расчёты
// ============================================================================

/** Номер степени деградации для процента: 0 — минимальная, 1 — частичная, 2 — значительная, 3 — полная */
function severityOf(pct) {
    const bounds = state.settings.bounds;
    for (let i = 0; i < bounds.length; i++) {
        if (pct <= bounds[i]) {
            return i;
        }
    }
    return 3;   // процент больше всех границ — полная
}

/**
 * Описание четырёх степеней для подписей: название, первая буква, диапазон процентов и цвет.
 * Например: { name: 'Частичная', short: 'Ч', from: 21, to: 50, color: '#fbc22c' }
 */
function severities() {
    const bounds = state.settings.bounds;
    const colors = state.settings.colors;
    const result = [];

    for (let i = 0; i < 4; i++) {
        // начало диапазона: у первой степени 0, у остальных — следующий процент после предыдущей границы
        let from = 0;
        if (i > 0) {
            from = bounds[i - 1] + 1;
        }
        // конец диапазона: у последней степени 100, у остальных — своя граница
        let to = 100;
        if (i < 3) {
            to = bounds[i];
        }
        result.push({
            name: DEGREES[i],
            short: DEGREES[i].charAt(0),
            from: from,
            to: to,
            color: colors[i],
        });
    }
    return result;
}

/** Подпись диапазона степени: «21–50%» */
function rangeText(severity) {
    return `${severity.from}–${severity.to}%`;
}

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
function tableColumns() {
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
function mergeEmptyColumns(columns, pcts) {
    const result = [];
    for (const column of columns) {
        const empty = !hasPctInRange(pcts, column.from, column.to);

        // последняя уже добавленная колонка (или null, если ещё ничего не добавили)
        let previous = null;
        if (result.length > 0) {
            previous = result[result.length - 1];
        }

        const canMerge = empty && previous !== null && previous.empty && previous.sev === column.sev;
        if (canMerge) {
            previous.to = column.to;   // растягиваем предыдущую колонку
        } else {
            result.push({ from: column.from, to: column.to, sev: column.sev, empty: empty });
        }
    }
    return result;
}


// ============================================================================
// 5. Панель настройки: ползунки, шкала, плашки с цветом и числом
// ============================================================================

/** Один раз создать все элементы панели настройки и подключить к ним обработчики */
function buildControls() {
    const sliders = [];
    for (let i = 0; i < 3; i++) {
        sliders.push(createSlider(i));
    }

    const segments = [];
    for (let i = 0; i < 4; i++) {
        segments.push(createSegment(i));
    }

    const bubbles = [];
    for (let i = 0; i < 3; i++) {
        bubbles.push(createBubble());
    }

    createScale();

    const tiles = [];
    for (let i = 0; i < 4; i++) {
        tiles.push(createTile(i));
    }

    // кнопка «Сбросить» возвращает настройки по умолчанию
    byId('reset').addEventListener('click', function () {
        state.settings = defaultSettings();
        apply();
    });

    // запоминаем созданные элементы, чтобы потом обновлять их в updateControls()
    state.controls = { sliders: sliders, segments: segments, bubbles: bubbles, tiles: tiles };

    // подписи на шкале перепроверяем, когда меняется ширина шкалы (например, вместе с окном)…
    const observer = new ResizeObserver(fitSegmentLabels);
    observer.observe(byId('range-track'));
    // …и когда догрузится шрифт: от него зависит ширина текста
    document.fonts.ready.then(fitSegmentLabels);
}

/** Ползунок границы номер i — между степенями i и i + 1 */
function createSlider(i) {
    const label = `Граница между степенями «${DEGREES[i]}» и «${DEGREES[i + 1]}», %`;
    const slider = el('input', { type: 'range', min: 0, max: 100, step: STEP, 'aria-label': label }, byId('range'));

    // двигают ползунок — ставим новую границу и перерисовываем страницу
    slider.addEventListener('input', function () {
        setBound(i, Number(slider.value));
        apply();
    });
    return slider;
}

/** Отрезок шкалы для степени i: номер и название */
function createSegment(i) {
    const segment = el('span', { title: DEGREES[i] }, byId('range-track'));
    el('b', {}, segment, String(i + 1));
    el('small', {}, segment, DEGREES[i]);
    return segment;
}

/** «Облачко» над ручкой ползунка — в нём пишется значение границы */
function createBubble() {
    return el('span', { class: 'range-bubble', 'aria-hidden': 'true' }, byId('range'));
}

/** Подписи под шкалой: 0, 10, 20, … 100 */
function createScale() {
    for (let value = 0; value <= 100; value += 10) {
        el('span', { style: `left: ${value}%` }, byId('range-scale'), String(value));
    }
}

/**
 * Плашка степени i: слева выбор цвета, справа диапазон и поле «до … %».
 * Возвращает { color, range, num } — элементы, которые потом обновляет updateControls().
 */
function createTile(i) {
    const tile = el('div', { class: 'sev-tile' }, byId('sev-tiles'));

    // выбор цвета: поменяли цвет — запоминаем и перерисовываем
    const color = el('input', { type: 'color', 'aria-label': `Цвет степени «${DEGREES[i]}»` }, tile);
    color.addEventListener('input', function () {
        state.settings.colors[i] = color.value;
        apply();
    });

    // справа от цвета — диапазон текстом и поле границы
    const info = el('div', {}, tile);
    const range = el('div', { class: 'muted' }, info);
    const edit = el('label', { class: 'sev-edit' }, info, 'до ');
    const numberLabel = `Верхняя граница степени «${DEGREES[i]}», %`;

    let num = null;
    if (i < 3) {
        // у первых трёх степеней границу можно ввести числом
        num = el('input', { type: 'number', min: STEP * (i + 1), max: 100 - STEP * (3 - i), step: STEP, 'aria-label': numberLabel }, edit);
        num.addEventListener('change', function () {
            // стёртое поле — это не ноль: просто возвращаем в поле текущее значение
            if (num.value === '') {
                updateControls();
                return;
            }
            setBound(i, Number(num.value));
            apply();
        });
    } else {
        // у последней степени верхняя граница всегда 100 — поле только для вида, как у остальных плашек
        el('input', { type: 'number', value: 100, readonly: '', tabindex: -1, 'aria-label': numberLabel }, edit);
    }
    edit.append(' %');

    return { color: color, range: range, num: num };
}

/** Привести панель настройки в соответствие с текущими границами и цветами */
function updateControls() {
    const bounds = state.settings.bounds;
    const colors = state.settings.colors;
    const sevs = severities();
    const controls = state.controls;

    // ползунки
    for (let i = 0; i < 3; i++) {
        controls.sliders[i].value = bounds[i];
    }

    // отрезки шкалы: ширина — по размеру диапазона степени, фон — её цвет
    for (let i = 0; i < 4; i++) {
        const segment = controls.segments[i];
        let start = 0;
        if (i > 0) {
            start = bounds[i - 1];
        }
        let end = 100;
        if (i < 3) {
            end = bounds[i];
        }
        segment.style.flexGrow = end - start;
        // лёгкий градиент: слева цвет чуть светлее
        segment.style.background = `linear-gradient(90deg, color-mix(in srgb, ${colors[i]} 86%, #fff), ${colors[i]})`;
        // чёрный или белый текст — что лучше читается на этом цвете
        segment.style.color = inkFor(colors[i]);
    }

    // облачки над ручками: текст — значение границы, положение — над центром ручки.
    // Центр ручки ходит от thumb/2 до (ширина − thumb/2), поэтому облачко ставим туда же
    for (let i = 0; i < 3; i++) {
        const bubble = controls.bubbles[i];
        bubble.textContent = String(bounds[i]);
        bubble.style.left = `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${bounds[i] / 100})`;
    }

    // плашки: цвет, диапазон текстом и число в поле границы
    for (let i = 0; i < 4; i++) {
        const tile = controls.tiles[i];
        tile.color.value = colors[i];
        tile.range.textContent = rangeText(sevs[i]);
        if (tile.num !== null) {
            tile.num.value = bounds[i];
        }
    }

    fitSegmentLabels();
}

/**
 * Номер и название степени на отрезке шкалы показываем, только если они помещаются между ручками
 * с зазором LABEL_GAP. Отрезок сужается — сначала пропадает название, потом номер.
 */
function fitSegmentLabels() {
    // ширина ручки ползунка задана в CSS переменной --thumb
    const rangeStyle = getComputedStyle(byId('range'));
    const thumb = parseFloat(rangeStyle.getPropertyValue('--thumb'));

    for (const segment of state.controls.segments) {
        for (const label of segment.children) {
            label.hidden = false;   // сначала показываем, чтобы измерить ширину текста
            const neededWidth = label.scrollWidth + 2 * (thumb / 2 + LABEL_GAP);
            label.hidden = segment.clientWidth < neededWidth;
        }
    }
}


// ============================================================================
// 6. Отрисовка: чипы, карточки метрик
// ============================================================================

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

/** Перерисовать всё, что зависит от данных и настроек: чипы и карточки метрик */
function render() {
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

/** Строки сервисов с учётом фильтра «Группа операций» */
function filteredRows() {
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

/** Сколько аварий каждой степени: [минимальных, частичных, значительных, полных] */
function countBySeverity(pcts) {
    const counts = [0, 0, 0, 0];
    for (const pct of pcts) {
        const severity = severityOf(pct);
        counts[severity] = counts[severity] + 1;
    }
    return counts;
}

/** Для одной метрики: [{ name: 'Сервис 1', parts: [кол-во аварий по степеням] }, …] */
function serviceBars(rows, metric) {
    const items = [];
    for (const row of rows) {
        items.push({ name: row.service, parts: countBySeverity(row.pcts[metric.id]) });
    }
    return items;
}

/** Сколько аварий показывать на полосе сервиса: все, или только выбранной степени */
function shownValue(parts) {
    if (state.selected === null) {
        return sum(parts);
    }
    return parts[state.selected];
}

/** Самое большое показываемое значение среди всех полос всех метрик (не меньше 1) */
function maxShownValue(barsByMetric) {
    let max = 1;
    for (const items of barsByMetric) {
        for (const item of items) {
            const value = shownValue(item.parts);
            if (value > max) {
                max = value;
            }
        }
    }
    return max;
}

/** Все проценты всех показанных сервисов по всем метрикам — одним списком */
function allPcts(rows) {
    const result = [];
    for (const row of rows) {
        for (const metric of state.metrics) {
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
function tableRowsWithCounts(rows, columns) {
    const result = [];
    for (const row of rows) {
        const counts = {};
        for (const metric of state.metrics) {
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

/** Настройки изменились: сохранить их, обновить панель и перерисовать страницу */
function apply() {
    saveSettings();
    updateControls();
    render();
}


// ============================================================================
// 7. Запуск страницы
// ============================================================================

/** «Деградация (без учета 5 минут)» → «Без учета 5 минут»: берём текст в скобках и делаем первую букву заглавной */
function shortName(name) {
    let inner = name;   // если скобок нет — берём название целиком
    const open = name.indexOf('(');
    const close = name.indexOf(')', open + 1);
    if (open !== -1 && close > open + 1) {
        inner = name.slice(open + 1, close);
    }
    return inner.charAt(0).toUpperCase() + inner.slice(1);
}

/** Загрузить данные с сервера. Если сервер ответил ошибкой — выбросить её с понятным текстом */
async function loadData() {
    // await — «дождаться»: ответ от сервера приходит не мгновенно
    const response = await fetch('/api/data');

    let body = {};
    try {
        body = await response.json();   // текст ответа → объект
    } catch (error) {
        // ответ не в формате JSON (например, страница ошибки) — оставляем пустой объект
    }

    if (!response.ok) {
        let message = body.error;                    // текст ошибки от нашего API…
        if (!message) {
            message = `HTTP ${response.status}`;    // …или хотя бы код ответа
        }
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
        render();
    });

    buildControls();
    apply();
}

init();