// settings.js — настройки степеней (границы и цвета): загрузка из браузера, проверка, сохранение, сдвиг границ.
// Сами настройки лежат в state.settings (state.js) — сюда их передают параметром.

import { STEP, STORAGE_KEY, defaultSettings } from './config.js';


/** Прочитать настройки, сохранённые в браузере. Если их нет или они испорчены — вернуть настройки по умолчанию */
export function loadSettings() {
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

/** Сохранить настройки в браузере */
export function saveSettings(settings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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
