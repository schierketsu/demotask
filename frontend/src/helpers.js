// helpers.js — мелкие помощники для отображения: формат чисел, склонения, классы CSS, группировка строк.

// Числа по-русски: 1234 → «1 234», 0.48 → «48 %»
export const numberFormat = new Intl.NumberFormat('ru-RU');
export const percentFormat = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0 });

// Правила русских склонений после числа: 1 авария, 2 аварии, 5 аварий
const pluralRules = new Intl.PluralRules('ru-RU');

/** Форма слова после числа: plural(2, ['авария', 'аварии', 'аварий']) → 'аварии' */
function plural(count, forms) {
    const rule = pluralRules.select(count);   // 'one' (1, 21…), 'few' (2–4, 22–24…) или 'many' (0, 5–20…)
    if (rule === 'one') {
        return forms[0];
    }
    if (rule === 'few') {
        return forms[1];
    }
    return forms[2];
}

/** Слово «авария» в нужной форме для числа: 1 → «авария», 3 → «аварии», 29 → «аварий» */
export function accidentsWord(count) {
    return plural(count, ['авария', 'аварии', 'аварий']);
}

/** Классы CSS через пробел, пустые пропускаются: classNames('slice', false, 'dimmed') → 'slice dimmed' */
export function classNames(...names) {
    return names.filter(Boolean).join(' ');
}

/**
 * Разложить строки по группам с одинаковым ключом, сохраняя порядок, в котором группы встретились.
 * Например, groupBy(rows, row => row.product_id) → [[сервисы продукта 1], [сервисы продукта 3], …]
 */
export function groupBy(rows, getKey) {
    const groups = new Map();   // ключ → список строк; Map помнит порядок, в котором ключи появились
    for (const row of rows) {
        const key = getKey(row);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(row);
    }
    return Array.from(groups.values());
}
