// bounds.js — логика окна сервиса: включение и отключение степеней и границы между ними.
// Функции «чистые»: получают границы и возвращают новые, старые не меняют — так состояние React
// всегда заменяется целиком, и React видит, что оно поменялось.
//
// Границы хранятся так же, как сохранённые у сервиса: [20, 50, 80] — минимальная до 20%, частичная до 50%,
// значительная до 80%, дальше полная. У отключённой степени граница равна предыдущей — места ей не остаётся
// ([20, 20, 80] — частичная отключена).
//
// Внутри окно думает так: есть включённые степени по порядку (например, [0, 2, 3] — минимальная, значительная,
// полная) и ends — до скольких процентов действует каждая из них, кроме последней (она всегда до 100): [20, 80].
// Ниже — перевод туда и обратно.

import { STEPEN_BOUNDS } from './config.js';
import { getStepenRanges } from './calc.js';


// Шаг границ — 10%: колонки таблицы идут по 10%, и граница степени не должна разрезать колонку пополам
export const BOUND_STEP = 10;


/** Одинаковые ли границы: [20, 50, 80] и [20, 50, 80] — да */
export function sameBounds(a, b) {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

/** Включённые степени при границах bounds — номера по порядку: [20, 50, 80] → [0, 1, 2, 3]; [20, 20, 80] → [0, 2, 3] */
export function enabledStepens(bounds) {
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
 * Поставить ends[position] на value процентов и подвинуть соседние, если нужно (меняет ends на месте —
 * это рабочая копия внутри setBound и toggleStepen, наружу она не уходит).
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

/**
 * Поле степени stepen: она действует до value процентов; соседние включённые подвинутся, если нужно.
 * Возвращает новые границы; в поле ввели не число — прежние
 */
export function setBound(bounds, stepen, value) {
    if (Number.isNaN(value)) {
        return bounds;
    }
    const enabled = enabledStepens(bounds);
    const ends = endsOf(bounds, enabled);
    fitEnd(ends, enabled.indexOf(stepen), value);
    return boundsFrom(enabled, ends);
}

/**
 * Нажали на название степени: включённую — отключить, отключённую — включить снова. Возвращает новые границы.
 * Отключили — её проценты забирает следующая включённая степень, а если она была последней — предыдущая
 * (последняя всегда до 100%). При 20/50/80: отключили частичную → значительная 21–80%; отключили полную →
 * значительная 51–100%. Последнюю оставшуюся степень отключить нельзя — границы не меняются (кнопка и так недоступна).
 * Включили — степень встаёт на свой диапазон по умолчанию (частичная — 21–50%), соседние подстраиваются:
 * при одной минимальной включили полную → минимальная 0–80%, полная 81–100%.
 */
export function toggleStepen(bounds, stepen) {
    const enabled = enabledStepens(bounds);
    const ends = endsOf(bounds, enabled);
    const position = enabled.indexOf(stepen);

    if (position !== -1) {
        // отключаем: убираем степень и одну границу — свою (место забирает следующая)
        // или, у последней включённой, предыдущую (место забирает предыдущая, она теперь до 100)
        if (enabled.length === 1) {
            return bounds;
        }
        const isLast = position === enabled.length - 1;
        enabled.splice(position, 1);
        ends.splice(isLast ? position - 1 : position, 1);
        return boundsFrom(enabled, ends);
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
    return boundsFrom(enabled, ends);
}
