// service-dialog.js — окно «Степени деградации сервиса»: у отдельного сервиса можно задать свои границы
// степеней вместо общих (по умолчанию у всех: минимальная до 20%, частичная до 50%, значительная до 80%).
//
// Как это работает:
//   нажали на чип сервиса (view.js) → openServiceDialog(id сервиса, render)
//   вводим границы числами → в окне сразу видно, к какой степени отнесутся аварии сервиса
//   «Сохранить» → границы запоминаются в state.serviceBounds → страница перерисовывается (render),
//                 чип сервиса становится синим — видно, что у него свои границы
//   «Вернуть исходные» → свои границы сервиса убираются из state.serviceBounds → снова границы по умолчанию
//
// Всё это — только на странице: на сервер ничего не уходит, после перезагрузки страницы границы сбрасываются.
//
// Окно — стандартный элемент <dialog>: браузер сам затемняет страницу под ним,
// держит фокус внутри окна и закрывает его по Esc.

import { STEPEN_BOUNDS, STEPEN_COLORS, STEPEN_NAMES } from './config.js';
import { state } from './state.js';
import { boundsOf, countByStepen, formatRange, getStepenRanges, hasOwnBounds, stepenOf, sum } from './calc.js';
import { byId, createElement } from './dom.js';


// Шаг границ — 10%: колонки таблицы идут по 10%, и граница степени не должна разрезать колонку пополам
const BOUND_STEP = 10;

// Окно одно на всю страницу (оно есть в index.html); содержимое собирается заново при каждом открытии
const dialog = byId('service-dialog');

// Что открыто в окне сейчас
let service = null;      // строка сервиса из state.data.rows: название, продукт, операция, аварии по диапазонам
let draft = [];          // границы, выставленные в окне, — ещё не сохранены: например [20, 50, 80]
let afterChange = null;  // что вызвать после сохранения или сброса — перерисовать страницу
let parts = null;        // элементы окна, которые обновляются при каждом движении границ (их собирает buildDialog)


// Клик по затемнению вокруг окна закрывает окно. Клик внутри окна попадает во внутренний блок,
// а по затемнению — в сам <dialog>, поэтому их можно различить
dialog.addEventListener('click', function (event) {
    if (event.target === dialog) {
        dialog.close();
    }
});


/**
 * Открыть окно степеней сервиса.
 *   serviceId — id сервиса
 *   onChange — что вызвать, когда границы сохранены или сброшены (страница передаёт свой render)
 */
export function openServiceDialog(serviceId, onChange) {
    service = findService(serviceId);
    if (service === null) {
        return;
    }
    // начинаем с тех границ, что у сервиса сейчас (свои или по умолчанию);
    // slice — копия: двигая границы в окне, не трогаем сохранённые
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
 * Например, при границах [20, 50, 80] тянем первую на 60 → вторая сдвигается вправо: [60, 70, 80];
 * тянем третью на 10 → дальше 30 она не пойдёт (слева нужно место для двух других): [10, 20, 30].
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


/**
 * Собрать содержимое окна для текущего сервиса: заголовок, аварии кружками по диапазонам,
 * поля с границами, табличку «сколько аварий какой степени» и кнопки.
 * Значения во все эти элементы раскладывает refresh() — здесь только создаём их и вешаем обработчики.
 */
function buildDialog() {
    const body = createElement('div', { class: 'dialog-body' });

    // ---------- заголовок: название сервиса и крестик ----------
    const head = createElement('div', { class: 'dialog-head' }, body);
    createElement('h2', { id: 'service-dialog-title' }, head, service.service);
    const closeButton = createElement('button', { type: 'button', class: 'dialog-close', 'aria-label': 'Закрыть' }, head, '×');
    closeButton.addEventListener('click', function () {
        dialog.close();
    });

    // ---------- аварии сервиса: кружок посередине диапазона, в нём — сколько аварий в диапазоне,
    // цвет — степень при границах из окна ----------
    const editor = createElement('div', { class: 'bounds-editor' }, body);
    const buckets = state.data.buckets;
    const dotsByMetric = [];
    for (const metric of state.data.metrics) {
        createElement('div', { class: 'small bounds-caption' }, editor, metric.label);
        const bucketCounts = service.counts[metric.id];   // сколько аварий в каждом диапазоне: [5, 0, 5, 1, …]
        const dots = [];
        if (sum(bucketCounts) === 0) {
            createElement('div', { class: 'small muted bounds-dots-empty' }, editor, 'аварий нет');
        } else {
            const row = createElement('div', { class: 'bounds-dots' }, editor);
            for (let i = 0; i < buckets.length; i++) {
                if (bucketCounts[i] === 0) {
                    continue;   // в диапазоне аварий нет — кружка нет
                }
                // середина диапазона на шкале: 0–10% → 5%, 21–30% → 25%
                const middle = buckets[i].pct_to - BOUND_STEP / 2;
                const dot = createElement('span', {
                    style: `left: ${middle}%`,
                    title: `${buckets[i].label} — ${bucketCounts[i]}`,
                }, row, String(bucketCounts[i]));
                dots.push({ element: dot, bucket: buckets[i] });
            }
        }
        dotsByMetric.push(dots);
    }

    // ---------- числа: до скольки процентов каждая степень ----------
    const fields = createElement('div', { class: 'bounds-fields' }, body);
    const rangeTexts = [];
    const numberInputs = [];
    for (let i = 0; i < 4; i++) {
        const field = createElement('div', { class: 'bounds-field' }, fields);
        createElement('span', { class: 'color-key', style: `background: ${STEPEN_COLORS[i].color}` }, field);
        createElement('span', {}, field, STEPEN_NAMES[i]);
        rangeTexts.push(createElement('span', { class: 'muted' }, field));   // «0–20%» — ставит refresh()
        const edit = createElement('label', { class: 'muted' }, field);
        if (i < 3) {
            edit.append('до ');
            const input = createElement('input', {
                type: 'number', step: BOUND_STEP,
                min: BOUND_STEP * (i + 1), max: 100 - BOUND_STEP * (3 - i),
                'aria-label': `${STEPEN_NAMES[i]} до, %`,
            }, edit);
            edit.append(' %');
            // change — когда число ввели целиком (Enter или ушли из поля), а не на каждой цифре
            input.addEventListener('change', function () {
                setBound(i, Number(input.value));
                refresh();
            });
            numberInputs.push(input);
        } else {
            edit.append('до 100 %');   // полная — всегда до 100%
        }
    }

    // ---------- сколько аварий какой степени при новых границах ----------
    const preview = createElement('table', { class: 'small bounds-preview' }, body);
    const headRow = createElement('tr', {}, createElement('thead', {}, preview));
    createElement('th', {}, headRow, 'Аварий');
    for (let i = 0; i < 4; i++) {
        const th = createElement('th', { title: STEPEN_NAMES[i] }, headRow);
        createElement('span', { class: 'color-key', style: `background: ${STEPEN_COLORS[i].color}` }, th);
        th.append(` ${STEPEN_NAMES[i]}`);
    }
    const previewBody = createElement('tbody', {}, preview);
    const previewCells = [];   // previewCells[номер метрики][номер степени] — ячейка с числом
    for (const metric of state.data.metrics) {
        const tr = createElement('tr', {}, previewBody);
        createElement('th', {}, tr, metric.label);
        const cells = [];
        for (let i = 0; i < 4; i++) {
            cells.push(createElement('td', {}, tr));
        }
        previewCells.push(cells);
    }

    // ---------- кнопки ----------
    const foot = createElement('div', { class: 'dialog-foot' }, body);
    const resetButton = createElement('button', { type: 'button', class: 'btn' }, foot, 'Вернуть исходные');
    createElement('span', { class: 'spacer' }, foot);
    const cancelButton = createElement('button', { type: 'button', class: 'btn' }, foot, 'Отмена');
    const saveButton = createElement('button', { type: 'button', class: 'btn primary' }, foot, 'Сохранить');

    resetButton.addEventListener('click', function () {
        apply(null);   // null — убрать свои границы, у сервиса снова границы по умолчанию
    });
    cancelButton.addEventListener('click', function () {
        dialog.close();   // ничего не сохраняем
    });
    saveButton.addEventListener('click', function () {
        // выставили ровно границы по умолчанию — это то же самое, что вернуть исходные
        apply(sameBounds(draft, STEPEN_BOUNDS) ? null : draft.slice());
    });

    dialog.replaceChildren(body);
    parts = {
        dotsByMetric, rangeTexts, numberInputs, previewCells,
        resetButton, saveButton,
    };
}


/** Разложить текущие границы из окна (draft) по всем элементам окна: кружки, числа, табличка, кнопки */
function refresh() {
    const ranges = getStepenRanges(draft);      // диапазоны степеней при границах из окна
    const saved = boundsOf(service);            // границы, которые у сервиса сохранены сейчас

    // числа в полях и подписи диапазонов «0–20%»
    for (let i = 0; i < 3; i++) {
        parts.numberInputs[i].value = draft[i];
    }
    for (let i = 0; i < 4; i++) {
        parts.rangeTexts[i].textContent = formatRange(ranges[i]);
    }

    // кружки с авариями: цвет — степень диапазона при новых границах (по его верхней границе)
    for (const dots of parts.dotsByMetric) {
        for (const dot of dots) {
            const colors = STEPEN_COLORS[stepenOf(dot.bucket.pct_to, draft)];
            dot.element.style.background = colors.color;
            dot.element.style.color = colors.textColor;   // число в кружке — чёрное или белое, что лучше читается
        }
    }

    // табличка: сколько аварий какой степени при новых границах; если отличается от сохранённых — «было N»
    const metrics = state.data.metrics;
    for (let m = 0; m < metrics.length; m++) {
        const bucketCounts = service.counts[metrics[m].id];
        const counts = countByStepen(bucketCounts, draft);
        const savedCounts = countByStepen(bucketCounts, saved);
        for (let i = 0; i < 4; i++) {
            const cell = parts.previewCells[m][i];
            cell.textContent = String(counts[i]);
            if (counts[i] !== savedCounts[i]) {
                createElement('span', { class: 'muted' }, cell, ` было ${savedCounts[i]}`);
            }
        }
    }

    // кнопки: «Сохранить» — только если границы в окне отличаются от сохранённых,
    // «Вернуть исходные» — только если у сервиса сейчас свои границы
    parts.saveButton.disabled = sameBounds(draft, saved);
    parts.resetButton.disabled = !hasOwnBounds(service.service_id);
}


/**
 * Применить границы к сервису: массив [30, 60, 90] — свои границы, null — вернуть по умолчанию.
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
