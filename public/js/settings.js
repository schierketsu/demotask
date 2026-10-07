// settings.js — сдвиг границ между степенями деградации.
// Сами границы лежат в state.settings.bounds (state.js) — сюда их передают параметром.

import { STEP } from './config.js';

/**
 * Поставить границу номер i (0, 1 или 2) из списка bounds в значение value.
 * Соседние границы при необходимости сдвигаются, чтобы у каждой степени остался хотя бы один процент.
 * Список bounds меняется на месте — передавайте state.settings.bounds.
 */
export function setBound(bounds, i, value) {
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
