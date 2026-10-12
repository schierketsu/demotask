// service-dialog.js — окно «Индивидуальные границы деградации»: у отдельного сервиса можно задать свои границы
// степеней вместо общих (по умолчанию у всех: минимальная до 20%, частичная до 50%, значительная до 80%).
//
// Из чего состоит окно, сверху вниз:
//   заголовок — название сервиса;
//   аварии сервиса — по оси на каждую метрику: кружок посередине диапазона, в нём сколько аварий в диапазоне,
//                    цвет — степень при границах из окна; под кружками — бледные цветные зоны степеней;
//   «Границы деградации, %» — четыре колонки степеней. Название степени — кнопка: нажали — степень отключена
//                    (её проценты забирает соседняя), нажали ещё раз — включена снова. Под каждой включённой
//                    степенью — поле «до скольких процентов она действует» со стрелками ▲▼ (шаг 10%); у последней
//                    включённой поля нет — она всегда до 100%. Настраиваются только включённые степени: например,
//                    отключили все, кроме минимальной, — минимальная 0–100%, полей нет;
//   кнопки «Сбросить» (включить все степени и вернуть границы по умолчанию), «Отмена», «Сохранить».
//
// Как это работает:
//   нажали на чип сервиса в таблице (view.js) → openServiceDialog(id сервиса, render)
//   включаем и отключаем степени, меняем числа → в окне сразу видно, к какой степени отнесутся аварии сервиса
//   «Сохранить» → границы запоминаются в state.serviceBounds → страница перерисовывается (render),
//                 у чипа сервиса появляется чёрная обводка; если в полях границы по умолчанию — свои границы убираются
//
// Всё это — только на странице: на сервер ничего не уходит, после перезагрузки страницы границы сбрасываются.
//
// Окно — стандартный элемент <dialog>: браузер сам затемняет страницу под ним,
// держит фокус внутри окна и закрывает его по Esc.

import { STEPEN_BOUNDS, STEPEN_COLORS, STEPEN_NAMES } from './config.js';
import { state } from './state.js';
import { boundsOf, formatRange, getStepenRanges, stepenOf } from './calc.js';
import { byId, createElement } from './dom.js';


// Шаг границ — 10%: колонки таблицы идут по 10%, и граница степени не должна разрезать колонку пополам
const BOUND_STEP = 10;

// Подписи процентов под осями с авариями — каждые 20%: 0, 20, 40, 60, 80, 100 (отсечки — чаще, каждые BOUND_STEP)
const AXIS_STEP = 20;

// Окно одно на всю страницу (оно есть в index.html); содержимое собирается заново при каждом открытии
const dialog = byId('service-dialog');

// Что открыто в окне сейчас
let service = null;      // строка сервиса из state.data.rows: название, аварии по диапазонам (counts)
// границы, выставленные в окне, — ещё не сохранены: например [20, 50, 80]. Хранятся так же, как сохранённые:
// у отключённой степени граница равна предыдущей — места ей не остаётся ([20, 20, 80] — частичная отключена)
let draft = [];
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

// ---------- включённые степени и границы между ними ----------
// Окно думает так: есть включённые степени по порядку (например, [0, 2, 3] — минимальная, значительная, полная)
// и ends — до скольких процентов действует каждая из них, кроме последней (она всегда до 100): [20, 80].
// Сохраняются же границы в обычном виде, для всех трёх: [20, 20, 80]. Ниже — перевод туда и обратно.

/** Включённые степени при границах bounds — номера по порядку: [20, 50, 80] → [0, 1, 2, 3]; [20, 20, 80] → [0, 2, 3] */
function enabledStepens(bounds) {
    const ranges = getStepenRanges(bounds);
    const result = [];
    for (let i = 0; i < 4; i++) {
        if (!ranges[i].unused) {
            result.push(i);
        }
    }
    return result;
}

/** До скольких процентов каждая включённая степень, кроме последней: [20, 20, 80] и [0, 2, 3] → [20, 80] */
function endsOf(bounds, enabled) {
    const ends = [];
    for (let j = 0; j < enabled.length - 1; j++) {
        ends.push(bounds[enabled[j]]);
    }
    return ends;
}

/**
 * Обратно — границы для сохранения: [0, 2, 3] и [20, 80] → [20, 20, 80].
 * Граница степени — там, где кончается последняя включённая степень до неё включительно (или 0, если таких нет);
 * у отключённой она совпадает с предыдущей, и места ей не остаётся. [0] и [] → [100, 100, 100] — только минимальная
 */
function boundsFrom(enabled, ends) {
    const bounds = [];
    let lastEnd = 0;   // где кончается последняя встреченная включённая степень
    for (let i = 0; i < 3; i++) {
        const position = enabled.indexOf(i);
        if (position !== -1) {
            lastEnd = position < ends.length ? ends[position] : 100;   // последняя включённая — до 100
        }
        bounds.push(lastEnd);
    }
    return bounds;
}

/**
 * Поставить ends[position] на value процентов и подвинуть соседние, если нужно (меняет ends на месте).
 * Включённые степени идут подряд, и у каждой — хотя бы 10% шкалы, иначе она бы пропала: значит, границы
 * растут с шагом не меньше 10, первая — не меньше 10, последняя — не больше 90.
 * Например, при [20, 50, 80] ставим первую на 60 → вторая сдвигается вправо: [60, 70, 80];
 * ставим третью на 10 → дальше 30 она не пойдёт (слева нужно место для двух других): [10, 20, 30].
 */
function fitEnd(ends, position, value) {
    // округляем до шага: 34 → 30
    let end = Math.round(value / BOUND_STEP) * BOUND_STEP;

    // каждой границе нужно место для соседей слева и справа
    const lowest = BOUND_STEP * (position + 1);
    const highest = 100 - BOUND_STEP * (ends.length - position);
    if (end < lowest) {
        end = lowest;
    }
    if (end > highest) {
        end = highest;
    }
    ends[position] = end;

    // границы правее должны быть хотя бы на шаг правее — если нет, сдвигаем их вправо
    for (let i = position + 1; i < ends.length; i++) {
        if (ends[i] < ends[i - 1] + BOUND_STEP) {
            ends[i] = ends[i - 1] + BOUND_STEP;
        }
    }
    // границы левее — хотя бы на шаг левее, иначе сдвигаем влево
    for (let i = position - 1; i >= 0; i--) {
        if (ends[i] > ends[i + 1] - BOUND_STEP) {
            ends[i] = ends[i + 1] - BOUND_STEP;
        }
    }
}

/** Поле степени stepen: она действует до value процентов; соседние включённые подвинутся, если нужно */
function setBound(stepen, value) {
    if (Number.isNaN(value)) {
        return;   // в поле ввели не число — ничего не меняем, refresh() вернёт в поле прежнее значение
    }
    const enabled = enabledStepens(draft);
    const ends = endsOf(draft, enabled);
    fitEnd(ends, enabled.indexOf(stepen), value);
    draft = boundsFrom(enabled, ends);
}

/**
 * Нажали на название степени: включённую — отключить, отключённую — включить снова.
 * Отключили — её проценты забирает следующая включённая степень, а если она была последней — предыдущая
 * (последняя всегда до 100%). При 20/50/80: отключили частичную → значительная 21–80%; отключили полную →
 * значительная 51–100%. Последнюю оставшуюся степень отключить нельзя — её кнопка недоступна.
 * Включили — степень встаёт на свой диапазон по умолчанию (частичная — 21–50%), соседние подстраиваются:
 * при одной минимальной включили полную → минимальная 0–80%, полная 81–100%.
 */
function toggleStepen(stepen) {
    const enabled = enabledStepens(draft);
    const ends = endsOf(draft, enabled);
    const position = enabled.indexOf(stepen);

    if (position !== -1) {
        // отключаем: убираем степень и одну границу — свою (место забирает следующая)
        // или, у последней включённой, предыдущую (место забирает предыдущая, она теперь до 100)
        if (enabled.length === 1) {
            return;
        }
        const isLast = position === enabled.length - 1;
        enabled.splice(position, 1);
        ends.splice(isLast ? position - 1 : position, 1);
        draft = boundsFrom(enabled, ends);
        return;
    }

    // включаем: ставим степень на её место по порядку
    let insertAt = 0;
    while (insertAt < enabled.length && enabled[insertAt] < stepen) {
        insertAt++;
    }
    enabled.splice(insertAt, 0, stepen);
    const hasPrevious = insertAt > 0;
    const hasNext = insertAt < enabled.length - 1;
    // одна граница добавляется: после степени, если за ней есть включённые, иначе — перед ней
    ends.splice(hasNext ? insertAt : insertAt - 1, 0, 0);

    // границы по умолчанию: начало степени — STEPEN_BOUNDS[stepen - 1], конец — STEPEN_BOUNDS[stepen]
    if (hasPrevious) {
        fitEnd(ends, insertAt - 1, STEPEN_BOUNDS[stepen - 1]);   // предыдущая кончается там, где начинается эта
    }
    if (hasNext) {
        fitEnd(ends, insertAt, STEPEN_BOUNDS[stepen]);           // эта кончается на своей границе по умолчанию
    }
    draft = boundsFrom(enabled, ends);
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

    const tracks = buildCaseTracks(body);
    const boundsParts = buildBoundsColumns(body);

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
        dotsByMetric: tracks.dotsByMetric,
        zonesByMetric: tracks.zonesByMetric,
        columns: boundsParts.columns,
        toggles: boundsParts.toggles,
        rangeTexts: boundsParts.rangeTexts,
        steppers: boundsParts.steppers,
        numberInputs: boundsParts.numberInputs,
        fixedTexts: boundsParts.fixedTexts,
        resetButton: resetButton,
        saveButton: saveButton,
    };
}

/**
 * Аварии сервиса по осям: слева название метрики, справа ось — бледные цветные зоны степеней (сразу видно, где
 * кончается одна степень и начинается другая), на ней кружки посередине диапазонов, где есть аварии
 * (в кружке — сколько их). Под осями — подписи 0%, 20%, … 100%; у нижнего края фона — короткие белые отсечки
 * каждые 10%.
 * Возвращает { dotsByMetric: [[{ element, bucket }, …], …], zonesByMetric: [[зона минимальной, …], …] } —
 * кружки перекрашивает, а зоны двигает refresh()
 */
function buildCaseTracks(body) {
    const tracks = createElement('div', { class: 'case-tracks' }, body);
    const buckets = state.data.buckets;
    const dotsByMetric = [];
    const zonesByMetric = [];

    for (const metric of state.data.metrics) {
        createElement('div', {}, tracks, metric.label);
        const track = createElement('div', { class: 'case-track' }, tracks);

        // зоны степеней — первыми, чтобы засечки и кружки легли поверх них; где и какой ширины — ставит refresh()
        const zones = [];
        for (let i = 0; i < 4; i++) {
            const color = STEPEN_COLORS[i].emptyCellBackground;   // цвет степени с прозрачностью 16 %
            zones.push(createElement('span', { class: 'case-zone', style: `background: ${color}` }, track));
        }
        zonesByMetric.push(zones);

        // короткие белые отсечки у нижнего края фона — каждые 10%: 10, 20, … 90 (подписи под осью — только у 20, 40, …).
        // У 0% и 100% не рисуем: там край фона, белая отсечка слилась бы с белым окном
        for (let value = BOUND_STEP; value < 100; value += BOUND_STEP) {
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
    return { dotsByMetric: dotsByMetric, zonesByMetric: zonesByMetric };
}

/**
 * «Границы деградации, %»: четыре колонки. В каждой — кнопка с точкой и названием степени (включить или отключить),
 * диапазон («21–50%» или «отключена») и поле «до … %»: у включённой степени — число со стрелками,
 * у последней включённой — надпись «до 100 %», у отключённой поля не видно.
 * Возвращает элементы, которые обновляет refresh(): колонки, кнопки, подписи, поля и надписи «100»
 */
function buildBoundsColumns(body) {
    createElement('h3', { class: 'dialog-section-title' }, body, 'Границы деградации, %');
    const columnsBox = createElement('div', { class: 'bounds-columns' }, body);
    const result = { columns: [], toggles: [], rangeTexts: [], steppers: [], numberInputs: [], fixedTexts: [] };

    for (let i = 0; i < 4; i++) {
        const column = createElement('div', { class: 'bounds-column' }, columnsBox);
        result.columns.push(column);

        // название степени — кнопка-переключатель: aria-pressed="true" — включена (ставит refresh())
        const toggle = createElement('button', { type: 'button', class: 'bounds-toggle' }, column);
        createStepenDot(i, toggle);
        toggle.append(STEPEN_NAMES[i]);
        toggle.addEventListener('click', function () {
            toggleStepen(i);
            refresh();
        });
        result.toggles.push(toggle);

        result.rangeTexts.push(createElement('div', { class: 'muted' }, column));   // «41–70%» — ставит refresh()

        // «до [20] %» или «до 100 %» — что из них видно, решает refresh(); у полной поля нет:
        // включённая полная всегда последняя, а где она начинается, задаёт поле степени перед ней
        const field = createElement('div', { class: 'bounds-field' }, column);
        createElement('span', { class: 'muted' }, field, 'до');
        if (i < 3) {
            const stepper = buildStepper(i, field);
            result.steppers.push(stepper.box);
            result.numberInputs.push(stepper.input);
        }
        result.fixedTexts.push(createElement('span', { class: 'bounds-fixed' }, field, '100'));
        createElement('span', { class: 'muted' }, field, '%');
    }
    return result;
}

/**
 * Поле степени stepen (до скольких процентов она действует) со своими стрелками ▲▼ на шаг 10% — в конец field.
 * Возвращает { box — рамка поля со стрелками, input — само поле }: число в поле ставит refresh()
 */
function buildStepper(stepen, field) {
    const box = createElement('div', { class: 'stepper' }, field);
    const input = createElement('input', {
        type: 'number', step: BOUND_STEP, min: 0, max: 100,
        'aria-label': `${STEPEN_NAMES[stepen]}: до скольких процентов, %`,
    }, box);
    // change — когда число ввели целиком (Enter или ушли из поля), а не на каждой цифре
    input.addEventListener('change', function () {
        setBound(stepen, Number(input.value));
        refresh();
    });

    // свои стрелки ▲▼ вместо стандартных: на шаг 10% вверх или вниз
    const arrows = createElement('div', { class: 'stepper-arrows' }, box);
    const up = createElement('button', { type: 'button', class: 'stepper-up', 'aria-label': 'Больше на 10%' }, arrows);
    const down = createElement('button', { type: 'button', class: 'stepper-down', 'aria-label': 'Меньше на 10%' }, arrows);
    up.addEventListener('click', function () {
        setBound(stepen, draft[stepen] + BOUND_STEP);
        refresh();
    });
    down.addEventListener('click', function () {
        setBound(stepen, draft[stepen] - BOUND_STEP);
        refresh();
    });
    return { box: box, input: input };
}

/** Разложить текущие границы из окна (draft) по всем элементам окна: колонки степеней, зоны, кружки, кнопки */
function refresh() {
    const ranges = getStepenRanges(draft);      // диапазоны степеней при границах из окна
    const saved = boundsOf(service);            // границы, которые у сервиса сохранены сейчас

    // колонки степеней: включена ли (кнопка нажата), диапазон «41–70%» или «отключена» (колонка бледнеет, поля нет);
    // у последней включённой вместо поля — «до 100 %»; последнюю оставшуюся степень отключить нельзя
    const enabled = enabledStepens(draft);
    const lastEnabled = enabled[enabled.length - 1];
    for (let i = 0; i < 4; i++) {
        const isOn = !ranges[i].unused;
        const isOnlyOne = isOn && enabled.length === 1;
        parts.columns[i].classList.toggle('off', !isOn);
        parts.toggles[i].setAttribute('aria-pressed', String(isOn));
        parts.toggles[i].disabled = isOnlyOne;
        if (isOnlyOne) {
            parts.toggles[i].title = 'Последнюю степень отключить нельзя';
        } else {
            parts.toggles[i].title = isOn ? 'Отключить степень' : 'Включить степень';
        }
        parts.rangeTexts[i].textContent = isOn ? formatRange(ranges[i]) : 'отключена';
        parts.fixedTexts[i].hidden = i !== lastEnabled;
    }
    for (let i = 0; i < 3; i++) {
        parts.steppers[i].hidden = i === lastEnabled;
        parts.numberInputs[i].value = draft[i];
    }

    // цветные зоны степеней на осях: от начала до конца степени; у отключённой ширина 0 — её не видно
    for (const zones of parts.zonesByMetric) {
        for (let i = 0; i < 4; i++) {
            zones[i].style.left = `${ranges[i].start}%`;
            zones[i].style.width = `${ranges[i].end - ranges[i].start}%`;
        }
    }

    // кружки с авариями: цвет — степень диапазона при новых границах (по его верхней границе);
    // число в кружке всегда белое (style.css, .case-bubble)
    for (const dots of parts.dotsByMetric) {
        for (const dot of dots) {
            dot.element.style.background = STEPEN_COLORS[stepenOf(dot.bucket.pct_to, draft)].color;
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
