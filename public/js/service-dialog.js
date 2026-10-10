// service-dialog.js — окно «Индивидуальные границы деградации»: у отдельного сервиса можно задать свои границы
// степеней вместо общих (по умолчанию у всех: минимальная до 20%, частичная до 50%, значительная до 80%).
//
// Из чего состоит окно, сверху вниз:
//   заголовок — название сервиса;
//   аварии сервиса — по оси на каждую метрику: кружок посередине диапазона, в нём сколько аварий в диапазоне,
//                    цвет — степень при границах из окна;
//   «Границы деградации, %» — четыре колонки степеней; в колонке частичной, значительной и полной — поле
//                    «после скольких процентов начинается эта степень» со стрелками ▲▼ (шаг 10%);
//   «Изменение количества аварий» — сколько аварий какой степени станет и на сколько это больше или меньше,
//                    чем при сохранённых границах;
//   кнопки «Сбросить» (вернуть в поля границы по умолчанию), «Отмена», «Сохранить».
//
// Как это работает:
//   нажали на чип сервиса в таблице (view.js) → openServiceDialog(id сервиса, render)
//   меняем числа → в окне сразу видно, к какой степени отнесутся аварии сервиса
//   «Сохранить» → границы запоминаются в state.serviceBounds → страница перерисовывается (render),
//                 у чипа сервиса появляется чёрная обводка; если в полях границы по умолчанию — свои границы убираются
//
// Всё это — только на странице: на сервер ничего не уходит, после перезагрузки страницы границы сбрасываются.
//
// Окно — стандартный элемент <dialog>: браузер сам затемняет страницу под ним,
// держит фокус внутри окна и закрывает его по Esc.

import { STEPEN_BOUNDS, STEPEN_COLORS, STEPEN_NAMES } from './config.js';
import { state } from './state.js';
import { boundsOf, countByStepen, formatRange, getStepenRanges, stepenOf } from './calc.js';
import { byId, createElement } from './dom.js';


// Шаг границ — 10%: колонки таблицы идут по 10%, и граница степени не должна разрезать колонку пополам
const BOUND_STEP = 10;

// Засечки на осях с авариями — каждые 20%: 0, 20, 40, 60, 80, 100
const AXIS_STEP = 20;

// Окно одно на всю страницу (оно есть в index.html); содержимое собирается заново при каждом открытии
const dialog = byId('service-dialog');

// Что открыто в окне сейчас
let service = null;      // строка сервиса из state.data.rows: название, аварии по диапазонам (counts)
let draft = [];          // границы, выставленные в окне, — ещё не сохранены: например [20, 50, 80]
let afterChange = null;  // что вызвать после сохранения — перерисовать страницу
let parts = null;        // элементы окна, которые обновляются при каждом изменении границ (их собирает buildDialog)


// Клик по затемнению вокруг окна закрывает окно. Клик внутри окна попадает во внутренние блоки,
// а по затемнению — в сам <dialog>, поэтому их можно различить
dialog.addEventListener('click', function (event) {
    if (event.target === dialog) {
        dialog.close();
    }
});


/**
 * Открыть окно границ сервиса.
 *   serviceId — id сервиса
 *   onChange — что вызвать, когда границы сохранены (страница передаёт свой render)
 */
export function openServiceDialog(serviceId, onChange) {
    service = findService(serviceId);
    if (service === null) {
        return;
    }
    // начинаем с тех границ, что у сервиса сейчас (свои или по умолчанию);
    // slice — копия: меняя границы в окне, не трогаем сохранённые
    draft = boundsOf(service).slice();
    afterChange = onChange;

    buildDialog();
    refresh();
    dialog.showModal();
}

/** Строка сервиса с этим id из загруженных данных; не нашли — null */
function findService(serviceId) {
    for (const row of state.data.rows) {
        if (row.service_id === serviceId) {
            return row;
        }
    }
    return null;
}

/** Одинаковые ли границы: [20, 50, 80] и [20, 50, 80] — да */
function sameBounds(a, b) {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

/**
 * Поставить границу номер index (0, 1 или 2) на value процентов и подвинуть соседние, если нужно.
 * Границы идут по возрастанию с шагом 10, и между соседними — хотя бы один шаг,
 * чтобы в каждой степени осталась хотя бы одна колонка таблицы.
 * Например, при границах [20, 50, 80] ставим первую на 60 → вторая сдвигается вправо: [60, 70, 80];
 * ставим третью на 10 → дальше 30 она не пойдёт (слева нужно место для двух других): [10, 20, 30].
 */
function setBound(index, value) {
    if (Number.isNaN(value)) {
        return;   // в поле ввели не число — ничего не меняем, refresh() вернёт в поле прежнее значение
    }
    // округляем до шага: 34 → 30
    let bound = Math.round(value / BOUND_STEP) * BOUND_STEP;

    // каждой границе нужно место для соседей: первая — не меньше 10, последняя — не больше 90
    const lowest = BOUND_STEP * (index + 1);
    const highest = 100 - BOUND_STEP * (draft.length - index);
    if (bound < lowest) {
        bound = lowest;
    }
    if (bound > highest) {
        bound = highest;
    }
    draft[index] = bound;

    // границы правее этой должны быть хотя бы на шаг правее — если нет, сдвигаем их вправо
    for (let i = index + 1; i < draft.length; i++) {
        if (draft[i] < draft[i - 1] + BOUND_STEP) {
            draft[i] = draft[i - 1] + BOUND_STEP;
        }
    }
    // границы левее — хотя бы на шаг левее, иначе сдвигаем влево
    for (let i = index - 1; i >= 0; i--) {
        if (draft[i] > draft[i + 1] - BOUND_STEP) {
            draft[i] = draft[i + 1] - BOUND_STEP;
        }
    }
}

/** Цветная точка степени i — перед её названием */
function createStepenDot(i, parent) {
    return createElement('span', { class: 'stepen-dot', style: `background: ${STEPEN_COLORS[i].color}` }, parent);
}


/**
 * Собрать содержимое окна для текущего сервиса.
 * Значения в элементы, которые зависят от границ, раскладывает refresh() — здесь только создаём их
 * и вешаем обработчики.
 */
function buildDialog() {
    const body = createElement('div', { class: 'dialog-body' });

    // ---------- заголовок: название сервиса, подзаголовок и крестик ----------
    const head = createElement('div', { class: 'dialog-head' }, body);
    const titles = createElement('div', {}, head);
    createElement('h2', { id: 'service-dialog-title', class: 'dialog-title' }, titles, service.service);
    createElement('p', { class: 'muted' }, titles, 'Индивидуальные границы деградации');
    const closeButton = createElement('button', { type: 'button', class: 'dialog-close', 'aria-label': 'Закрыть' }, head);
    closeButton.addEventListener('click', function () {
        dialog.close();
    });

    const dotsByMetric = buildCaseTracks(body);
    const boundsParts = buildBoundsColumns(body);
    const previewCells = buildChangesTable(body);

    // ---------- кнопки: в подвале окна, под линией на всю ширину ----------
    const foot = createElement('div', { class: 'dialog-foot' });
    const resetButton = createElement('button', { type: 'button', class: 'btn' }, foot, 'Сбросить');
    createElement('span', { class: 'spacer' }, foot);
    const cancelButton = createElement('button', { type: 'button', class: 'btn' }, foot, 'Отмена');
    const saveButton = createElement('button', { type: 'button', class: 'btn primary' }, foot, 'Сохранить');

    resetButton.addEventListener('click', function () {
        // в поля — границы по умолчанию; сохранятся они только по «Сохранить»
        draft = STEPEN_BOUNDS.slice();
        refresh();
    });
    cancelButton.addEventListener('click', function () {
        dialog.close();   // ничего не сохраняем
    });
    saveButton.addEventListener('click', function () {
        // в полях границы по умолчанию — значит, своих границ у сервиса нет
        apply(sameBounds(draft, STEPEN_BOUNDS) ? null : draft.slice());
    });

    dialog.replaceChildren(body, foot);
    parts = {
        dotsByMetric: dotsByMetric,
        rangeTexts: boundsParts.rangeTexts,
        numberInputs: boundsParts.numberInputs,
        previewCells: previewCells,
        resetButton: resetButton,
        saveButton: saveButton,
    };
}

/**
 * Аварии сервиса по осям: слева название метрики, справа ось с засечками каждые 20%,
 * на оси — кружки посередине диапазонов, где есть аварии (в кружке — сколько их). Под осями — подписи 0%…100%.
 * Возвращает кружки по метрикам: [[{ element, bucket }, …], …] — их перекрашивает refresh()
 */
function buildCaseTracks(body) {
    const tracks = createElement('div', { class: 'case-tracks' }, body);
    const buckets = state.data.buckets;
    const dotsByMetric = [];

    for (const metric of state.data.metrics) {
        createElement('div', {}, tracks, metric.label);
        const track = createElement('div', { class: 'case-track' }, tracks);
        // засечки на оси: 0, 20, 40, … 100
        for (let value = 0; value <= 100; value += AXIS_STEP) {
            createElement('span', { class: 'case-tick', style: `left: ${value}%` }, track);
        }

        const bucketCounts = service.counts[metric.id];   // сколько аварий в каждом диапазоне: [5, 0, 5, 1, …]
        const dots = [];
        for (let i = 0; i < buckets.length; i++) {
            if (bucketCounts[i] === 0) {
                continue;   // в диапазоне аварий нет — кружка нет
            }
            // середина диапазона на оси: 0–10% → 5%, 21–30% → 25%
            const middle = buckets[i].pct_to - BOUND_STEP / 2;
            const dot = createElement('span', {
                class: 'case-bubble',
                style: `left: ${middle}%`,
                title: `${buckets[i].label} — ${bucketCounts[i]}`,
            }, track, String(bucketCounts[i]));
            dots.push({ element: dot, bucket: buckets[i] });
        }
        dotsByMetric.push(dots);
    }

    // подписи под осями: 0%, 20%, … 100% (слева пустая ячейка — под названиями метрик)
    createElement('div', {}, tracks);
    const axis = createElement('div', { class: 'case-axis small muted' }, tracks);
    for (let value = 0; value <= 100; value += AXIS_STEP) {
        createElement('span', { style: `left: ${value}%` }, axis, `${value}%`);
    }
    return dotsByMetric;
}

/**
 * «Границы деградации, %»: четыре колонки — точка и название степени, её диапазон, а у частичной, значительной
 * и полной ещё поле: после скольких процентов начинается эта степень. Это та же граница, что «до скольких
 * процентов предыдущая степень»: поле под частичной — draft[0], под значительной — draft[1], под полной — draft[2].
 * Возвращает подписи диапазонов и поля — их обновляет refresh()
 */
function buildBoundsColumns(body) {
    createElement('h3', { class: 'dialog-section-title' }, body, 'Границы деградации, %');
    const columns = createElement('div', { class: 'bounds-columns' }, body);
    const rangeTexts = [];
    const numberInputs = [];

    for (let i = 0; i < 4; i++) {
        const column = createElement('div', { class: 'bounds-column' }, columns);
        const name = createElement('div', { class: 'bounds-name' }, column);
        createStepenDot(i, name);
        name.append(STEPEN_NAMES[i]);
        rangeTexts.push(createElement('div', { class: 'muted' }, column));   // «41–70%» — ставит refresh()

        if (i === 0) {
            continue;   // минимальная всегда начинается с 0% — поля нет
        }
        const boundIndex = i - 1;   // какую границу меняет поле этой колонки
        const field = createElement('div', { class: 'bounds-field' }, column);
        const stepper = createElement('div', { class: 'stepper' }, field);
        const input = createElement('input', {
            type: 'number', step: BOUND_STEP,
            min: BOUND_STEP * i, max: 100 - BOUND_STEP * (4 - i),
            'aria-label': `${STEPEN_NAMES[i]}: начинается после, %`,
        }, stepper);
        // change — когда число ввели целиком (Enter или ушли из поля), а не на каждой цифре
        input.addEventListener('change', function () {
            setBound(boundIndex, Number(input.value));
            refresh();
        });

        // свои стрелки ▲▼ вместо стандартных: на шаг 10% вверх или вниз
        const arrows = createElement('div', { class: 'stepper-arrows' }, stepper);
        const up = createElement('button', { type: 'button', class: 'stepper-up', 'aria-label': 'Больше на 10%' }, arrows);
        const down = createElement('button', { type: 'button', class: 'stepper-down', 'aria-label': 'Меньше на 10%' }, arrows);
        up.addEventListener('click', function () {
            setBound(boundIndex, draft[boundIndex] + BOUND_STEP);
            refresh();
        });
        down.addEventListener('click', function () {
            setBound(boundIndex, draft[boundIndex] - BOUND_STEP);
            refresh();
        });

        createElement('span', { class: 'muted' }, field, '%');
        numberInputs.push(input);
    }
    return { rangeTexts: rangeTexts, numberInputs: numberInputs };
}

/**
 * «Изменение количества аварий»: по строке на метрику, по колонке на степень.
 * Возвращает ячейки с числами: previewCells[номер метрики][номер степени] — их заполняет refresh()
 */
function buildChangesTable(body) {
    createElement('h3', { class: 'dialog-section-title' }, body, 'Изменение количества аварий');
    const wrap = createElement('div', { class: 'changes-wrap' }, body);
    const table = createElement('table', { class: 'changes' }, wrap);

    const headRow = createElement('tr', {}, createElement('thead', {}, table));
    createElement('th', {}, headRow);
    // в заголовках колонок — только цветные точки степеней; название — во всплывающей подсказке и для экранного диктора
    for (let i = 0; i < 4; i++) {
        const th = createElement('th', { title: STEPEN_NAMES[i], 'aria-label': STEPEN_NAMES[i] }, headRow);
        createStepenDot(i, th);
    }

    const tableBody = createElement('tbody', {}, table);
    const previewCells = [];
    for (const metric of state.data.metrics) {
        const tr = createElement('tr', {}, tableBody);
        createElement('th', {}, tr, metric.label);
        const cells = [];
        for (let i = 0; i < 4; i++) {
            cells.push(createElement('td', {}, tr));
        }
        previewCells.push(cells);
    }
    return previewCells;
}


/** Разложить текущие границы из окна (draft) по всем элементам окна: кружки, поля, табличка, кнопки */
function refresh() {
    const ranges = getStepenRanges(draft);      // диапазоны степеней при границах из окна
    const saved = boundsOf(service);            // границы, которые у сервиса сохранены сейчас

    // диапазоны «41–70%» под названиями степеней и числа в полях
    for (let i = 0; i < 4; i++) {
        parts.rangeTexts[i].textContent = formatRange(ranges[i]);
    }
    for (let i = 0; i < 3; i++) {
        parts.numberInputs[i].value = draft[i];
    }

    // кружки с авариями: цвет — степень диапазона при новых границах (по его верхней границе)
    for (const dots of parts.dotsByMetric) {
        for (const dot of dots) {
            const colors = STEPEN_COLORS[stepenOf(dot.bucket.pct_to, draft)];
            dot.element.style.background = colors.color;
            dot.element.style.color = colors.textColor;   // число в кружке — чёрное или белое, что лучше читается
        }
    }

    // табличка: сколько аварий какой степени при новых границах и на сколько это отличается от сохранённых
    const metrics = state.data.metrics;
    for (let m = 0; m < metrics.length; m++) {
        const bucketCounts = service.counts[metrics[m].id];
        const counts = countByStepen(bucketCounts, draft);
        const savedCounts = countByStepen(bucketCounts, saved);
        for (let i = 0; i < 4; i++) {
            const cell = parts.previewCells[m][i];
            cell.replaceChildren();   // убираем прошлое содержимое
            createElement('strong', {}, cell, String(counts[i]));
            const change = counts[i] - savedCounts[i];
            if (change > 0) {
                createElement('span', { class: 'change up' }, cell, `(+${change})`);
            } else if (change < 0) {
                createElement('span', { class: 'change down' }, cell, `(−${-change})`);   // настоящий минус «−», а не дефис
            }
        }
    }

    // кнопки: «Сохранить» — только если границы в окне отличаются от сохранённых,
    // «Сбросить» — только если в полях не границы по умолчанию
    parts.saveButton.disabled = sameBounds(draft, saved);
    parts.resetButton.disabled = sameBounds(draft, STEPEN_BOUNDS);
}


/**
 * Применить границы к сервису: массив [30, 60, 90] — свои границы, null — границы по умолчанию.
 * Границы запоминаются только на странице, в state.serviceBounds (на сервер ничего не уходит);
 * затем окно закрывается, и страница перерисовывается с новыми степенями сервиса.
 */
function apply(bounds) {
    if (bounds === null) {
        delete state.serviceBounds[service.service_id];   // delete — убрать запись: своих границ больше нет
    } else {
        state.serviceBounds[service.service_id] = bounds;
    }
    dialog.close();
    afterChange();
}
