// controls.js — панель настройки степеней: ползунки, цветная шкала с подписями, облачка со значениями,
// деления под шкалой и плашки с цветом степени и полем границы; здесь же сдвиг границ (setBound).
//
// Элементы создаются один раз (buildControls), а потом только обновляются (updateControls).
// Что делать после того, как пользователь что-то поменял, решает app.js — он передаёт функцию onChange:
//   ползунок изменился → setBound() → state.settings.bounds изменились → onChange() → страница перерисована

import { STEPEN_NAMES, SCALE_LABEL_GAP, STEPEN_COLORS, BOUND_STEP, defaultSettings } from './config.js';
import { state } from './state.js';
import { getStepenRanges, formatRange } from './calc.js';
import { byId, createElement } from './view.js';


/**
 * Поставить границу номер i (0, 1 или 2) в значение value — меняет state.settings.bounds.
 * Соседние границы при необходимости сдвигаются, чтобы у каждой степени остался хотя бы один процент.
 */
function setBound(i, value) {
    const bounds = state.settings.bounds;

    // 1. Округляем до шага
    let newBound = Math.round(value / BOUND_STEP) * BOUND_STEP;

    // 2. Не пускаем границу слишком близко к краям шкалы:
    //    слева от неё должны поместиться i + 1 степеней, справа — 3 - i степеней, по шагу на каждую
    const lowest = BOUND_STEP * (i + 1);
    const highest = 100 - BOUND_STEP * (3 - i);
    if (newBound < lowest) {
        newBound = lowest;
    }
    if (newBound > highest) {
        newBound = highest;
    }
    bounds[i] = newBound;

    // 3. Каждая граница правее должна быть хотя бы на шаг больше предыдущей — иначе двигаем её вправо
    for (let j = i + 1; j < 3; j++) {
        const minimum = bounds[j - 1] + BOUND_STEP;
        if (bounds[j] < minimum) {
            bounds[j] = minimum;
        }
    }

    // 4. Каждая граница левее должна быть хотя бы на шаг меньше следующей — иначе двигаем её влево
    for (let j = i - 1; j >= 0; j--) {
        const maximum = bounds[j + 1] - BOUND_STEP;
        if (bounds[j] > maximum) {
            bounds[j] = maximum;
        }
    }
}


/**
 * Один раз создать все элементы панели настройки и подключить к ним обработчики.
 * onChange() вызывается после каждого изменения границ.
 */
export function buildControls(onChange) {
    const sliders = [];
    for (let i = 0; i < 3; i++) {
        sliders.push(createSlider(i, onChange));
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
        tiles.push(createTile(i, onChange));
    }

    // кнопка «Сбросить» возвращает настройки по умолчанию
    byId('reset').addEventListener('click', function () {
        state.settings = defaultSettings();
        onChange();
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
function createSlider(i, onChange) {
    const label = `Граница между степенями «${STEPEN_NAMES[i]}» и «${STEPEN_NAMES[i + 1]}», %`;
    const slider = createElement('input', { type: 'range', min: 0, max: 100, step: BOUND_STEP, 'aria-label': label }, byId('range'));

    // двигают ползунок — ставим новую границу и перерисовываем страницу
    slider.addEventListener('input', function () {
        setBound(i, Number(slider.value));
        onChange();
    });
    return slider;
}

/** Отрезок шкалы для степени i: номер и название */
function createSegment(i) {
    const segment = createElement('span', { title: STEPEN_NAMES[i] }, byId('range-track'));
    createElement('b', {}, segment, String(i + 1));
    createElement('small', {}, segment, STEPEN_NAMES[i]);
    return segment;
}

/** «Облачко» над ручкой ползунка — в нём пишется значение границы */
function createBubble() {
    return createElement('span', { class: 'range-bubble', 'aria-hidden': 'true' }, byId('range'));
}

/** Подписи под шкалой: 0, 10, 20, … 100 */
function createScale() {
    for (let value = 0; value <= 100; value += 10) {
        createElement('span', { style: `left: ${value}%` }, byId('range-scale'), String(value));
    }
}

/**
 * Плашка степени i: слева квадратик цвета степени, справа диапазон и поле «до … %».
 * Возвращает { range, boundInput } — элементы, которые потом обновляет updateControls().
 */
function createTile(i, onChange) {
    const tile = createElement('div', { class: 'stepen-tile' }, byId('stepen-tiles'));

    // квадратик цвета — только для наглядности: цвета степеней постоянные (STEPEN_COLORS в config.js)
    createElement('span', { class: 'stepen-swatch', style: `background: ${STEPEN_COLORS[i].color}`, title: STEPEN_NAMES[i] }, tile);

    // справа от цвета — диапазон текстом и поле границы
    const tileText = createElement('div', {}, tile);
    const rangeLabel = createElement('div', { class: 'muted' }, tileText);
    const boundLabel = createElement('label', { class: 'stepen-bound' }, tileText, 'до ');
    const numberLabel = `Верхняя граница степени «${STEPEN_NAMES[i]}», %`;

    let boundInput = null;
    if (i < 3) {
        // у первых трёх степеней границу можно ввести числом
        boundInput = createElement('input', { type: 'number', min: BOUND_STEP * (i + 1), max: 100 - BOUND_STEP * (3 - i), step: BOUND_STEP, 'aria-label': numberLabel }, boundLabel);
        boundInput.addEventListener('change', function () {
            // стёртое поле — это не ноль: просто возвращаем в поле текущее значение
            if (boundInput.value === '') {
                updateControls();
                return;
            }
            setBound(i, Number(boundInput.value));
            onChange();
        });
    } else {
        // у последней степени верхняя граница всегда 100 — поле только для вида, как у остальных плашек
        createElement('input', { type: 'number', value: 100, readonly: '', tabindex: -1, 'aria-label': numberLabel }, boundLabel);
    }
    boundLabel.append(' %');

    return { rangeLabel: rangeLabel, boundInput: boundInput };
}

/** Привести панель настройки в соответствие с текущими границами */
export function updateControls() {
    const bounds = state.settings.bounds;
    const ranges = getStepenRanges();
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
        const color = STEPEN_COLORS[i].color;
        segment.style.background = `linear-gradient(90deg, color-mix(in srgb, ${color} 86%, #fff), ${color})`;
        segment.style.color = STEPEN_COLORS[i].textColor;   // чёрный или белый текст — что лучше читается на этом цвете
    }

    // облачки над ручками: текст — значение границы, положение — над центром ручки.
    // Центр ручки ходит от thumb/2 до (ширина − thumb/2), поэтому облачко ставим туда же
    for (let i = 0; i < 3; i++) {
        const bubble = controls.bubbles[i];
        bubble.textContent = String(bounds[i]);
        bubble.style.left = `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${bounds[i] / 100})`;
    }

    // плашки: диапазон текстом и число в поле границы
    for (let i = 0; i < 4; i++) {
        const tile = controls.tiles[i];
        tile.rangeLabel.textContent = formatRange(ranges[i]);
        if (tile.boundInput !== null) {
            tile.boundInput.value = bounds[i];
        }
    }

    fitSegmentLabels();
}

/**
 * Номер и название степени на отрезке шкалы показываем, только если они помещаются между ручками
 * с зазором SCALE_LABEL_GAP. Отрезок сужается — сначала пропадает название, потом номер.
 */
function fitSegmentLabels() {
    // ширина ручки ползунка задана в CSS переменной --thumb
    const rangeStyle = getComputedStyle(byId('range'));
    const thumbWidth = parseFloat(rangeStyle.getPropertyValue('--thumb'));

    for (const segment of state.controls.segments) {
        for (const label of segment.children) {
            label.hidden = false;   // сначала показываем, чтобы измерить ширину текста
            const neededWidth = label.scrollWidth + 2 * (thumbWidth / 2 + SCALE_LABEL_GAP);
            label.hidden = segment.clientWidth < neededWidth;
        }
    }
}
