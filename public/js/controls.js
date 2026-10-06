// controls.js — панель настройки степеней: ползунки, цветная шкала с подписями, облачка со значениями,
// деления под шкалой и плашки с выбором цвета и полем границы.
//
// Элементы создаются один раз (buildControls), а потом только обновляются (updateControls).
// Что делать после того, как пользователь что-то поменял, решает app.js — он передаёт функцию onChange.

import { DEGREES, LABEL_GAP, STEP, defaultSettings } from './config.js';
import { state } from './state.js';
import { setBound } from './settings.js';
import { rangeText, severities } from './calc.js';
import { byId, el, inkFor } from './charts.js';


/**
 * Один раз создать все элементы панели настройки и подключить к ним обработчики.
 * onChange() вызывается после каждого изменения границ или цветов.
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
    const label = `Граница между степенями «${DEGREES[i]}» и «${DEGREES[i + 1]}», %`;
    const slider = el('input', { type: 'range', min: 0, max: 100, step: STEP, 'aria-label': label }, byId('range'));

    // двигают ползунок — ставим новую границу и перерисовываем страницу
    slider.addEventListener('input', function () {
        setBound(state.settings.bounds, i, Number(slider.value));
        onChange();
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
function createTile(i, onChange) {
    const tile = el('div', { class: 'sev-tile' }, byId('sev-tiles'));

    // выбор цвета: поменяли цвет — запоминаем и перерисовываем
    const color = el('input', { type: 'color', 'aria-label': `Цвет степени «${DEGREES[i]}»` }, tile);
    color.addEventListener('input', function () {
        state.settings.colors[i] = color.value;
        onChange();
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
            setBound(state.settings.bounds, i, Number(num.value));
            onChange();
        });
    } else {
        // у последней степени верхняя граница всегда 100 — поле только для вида, как у остальных плашек
        el('input', { type: 'number', value: 100, readonly: '', tabindex: -1, 'aria-label': numberLabel }, edit);
    }
    edit.append(' %');

    return { color: color, range: range, num: num };
}

/** Привести панель настройки в соответствие с текущими границами и цветами */
export function updateControls() {
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
        const start = i > 0 ? bounds[i - 1] : 0;     // у первой степени — от 0
        const end = i < 3 ? bounds[i] : 100;         // у последней — до 100
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
