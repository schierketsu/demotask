// period.js — период, за который показываются данные: месяц, год или произвольный диапазон дат.
// Сервер всегда получает две даты «с … по …» — здесь выбор пользователя превращается в них.
//
// Период на странице (состояние в App.jsx) — объект:
//   { type: 'month' | 'year' | 'range', month: '2026-10', year: '2026', rangeFrom: '2026-01-15', rangeTo: '2026-03-10' }
// type — как выбирают период; остальные поля — что выбрано в каждом способе. Переключение способа
// не стирает выбор в остальных.

import { MONTH_NAMES } from './config.js';


/** '2026-10' → «Октябрь 2026» */
export function formatMonth(month) {
    const year = month.slice(0, 4);               // '2026'
    const monthNumber = Number(month.slice(5));   // '10' → 10
    return `${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

/** '2026-03-10' → «10.03.2026» */
export function formatDate(date) {
    const [year, month, day] = date.split('-');
    return `${day}.${month}.${year}`;
}

/**
 * Первый и последний день периода { from, to } — их и отправляем на сервер.
 * Месяц '2026-02' → 2026-02-01 … 2026-02-28; год '2026' → 2026-01-01 … 2026-12-31; диапазон — как ввели
 */
export function periodDates(period) {
    if (period.type === 'month') {
        const [year, month] = period.month.split('-').map(Number);
        // день 0 следующего месяца — последний день нужного: new Date(2026, 2, 0) → 28 февраля 2026
        // (месяцы в Date считаются с нуля, поэтому 2 — это март)
        const lastDay = String(new Date(year, month, 0).getDate()).padStart(2, '0');   // 9 → '09'
        return { from: `${period.month}-01`, to: `${period.month}-${lastDay}` };
    }
    if (period.type === 'year') {
        return { from: `${period.year}-01-01`, to: `${period.year}-12-31` };
    }
    return { from: period.rangeFrom, to: period.rangeTo };
}

/** Период словами — для сообщения об ошибке: «октябрь 2026», «2026 год», «10.03.2026 — 15.04.2026» */
export function periodLabel(period) {
    if (period.type === 'month') {
        return formatMonth(period.month).toLowerCase();
    }
    if (period.type === 'year') {
        return `${period.year} год`;
    }
    return `${formatDate(period.rangeFrom)} — ${formatDate(period.rangeTo)}`;
}

/**
 * Период сразу после первой загрузки: какой месяц сервер отдал — тот и выбран; год — этого месяца,
 * диапазон — тот же месяц, но не дальше последней даты случаев (иначе календарь отметит дату как недопустимую)
 */
export function initialPeriod(data) {
    return {
        type: 'month',
        month: data.from.slice(0, 7),   // '2026-10-01' → '2026-10'
        year: data.from.slice(0, 4),    // '2026-10-01' → '2026'
        rangeFrom: data.from,
        rangeTo: data.to < data.maxDate ? data.to : data.maxDate,
    };
}
