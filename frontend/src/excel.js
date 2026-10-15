// excel.js — выгрузка в Excel по кнопке «Экспорт» в панели фильтров: то, что на странице, за выбранный период
// и продукт. В файле два листа:
//   «Без изменений» — у всех сервисов границы степеней по умолчанию, как будто в окне сервиса ничего не меняли
//   «С изменениями» — со своими границами сервисов, как сейчас на странице
// На каждом листе по каждой метрике («Без учета 5 минут», «С учетом 5 минут») — то же, что в её блоке:
// сводка по степеням (кольцо), сервисы (полосы под кольцом) и детализация (таблица).
//
// Файл собирает библиотека ExcelJS прямо в браузере. Она большая, поэтому загружается только по нажатию кнопки:
// import() внутри функции — Vite выносит её в отдельный файл, и страница без неё открывается так же быстро.

import {
    boundsOf, buildServiceStats, buildTableColumns, columnTitle, formatRange, getStepenRanges, hasOwnBounds,
    rowsOfProduct, stepenColumnSpans, stepenOf, sum, sumByStepen,
} from './calc.js';
import { STEPEN_COLORS, STEPEN_NAMES } from './config.js';
import { groupBy } from './helpers.js';
import { formatDate, formatMonth, periodDates } from './period.js';


// Цвета оформления — как на странице (global.scss), в записи Excel: AARRGGBB
const TEXT = 'FF0B0B0B';
const TEXT_2 = 'FF5C5B57';
const WASH = 'FFF4F4F2';
const LINE = 'FFD5D8DE';
const WHITE = 'FFFFFFFF';

// Колонки листа: A — операция (в сводке и списке сервисов — степень или сервис), B — сервис,
// с C — диапазоны по 10% (в сводке и списке сервисов — числа)
const FIRST_VALUE_COLUMN = 3;


/**
 * Собрать файл и отдать его браузеру на скачивание: «Деградации_2026-10-01_2026-10-31.xlsx».
 *   data — данные с сервера за загруженный период; period — выбранный период (period.js);
 *   productId — выбранный продукт ('' — все); serviceBounds — свои границы сервисов (App.jsx)
 */
export async function exportToExcel(data, period, productId, serviceBounds) {
    const { default: ExcelJS } = await import('exceljs');
    const workbook = buildWorkbook(ExcelJS, data, period, productId, serviceBounds);
    const buffer = await workbook.xlsx.writeBuffer();
    download(buffer, `Деградации_${data.from}_${data.to}.xlsx`);
}

/** Книга из двух листов. ExcelJS приходит параметром — его загружает exportToExcel */
export function buildWorkbook(ExcelJS, data, period, productId, serviceBounds) {
    const workbook = new ExcelJS.Workbook();
    const rows = rowsOfProduct(data.rows, productId);
    const heading = [
        `Период: ${periodTitle(data, period)}`,
        `Продукт: ${productTitle(data.products, productId)}`,
    ];

    // лист 1: свои границы не учитываем — пустой serviceBounds, у всех сервисов границы по умолчанию
    const defaultBounds = getStepenRanges().map(function (range) {
        return `${range.name.toLowerCase()} ${formatRange(range)}`;
    });
    const plain = addSheet(workbook, 'Без изменений', data.buckets.length);
    let r = writeHeading(plain, [...heading, `Границы степеней у всех сервисов по умолчанию: ${defaultBounds.join(', ')}`]);
    writeMetrics(plain, r, data, rows, {});

    // лист 2: как на странице — со своими границами у тех сервисов, которым их задали
    const customRows = rows.filter(function (row) { return hasOwnBounds(serviceBounds, row.service_id); });
    const changed = addSheet(workbook, 'С изменениями', data.buckets.length);
    const boundsNote = customRows.length > 0
        ? `Сервисов со своими границами степеней: ${customRows.length} (таблица ниже), у остальных границы по умолчанию`
        : 'Свои границы степеней не заданы — данные совпадают с листом «Без изменений»';
    r = writeHeading(changed, [...heading, boundsNote]);
    if (customRows.length > 0) {
        r = writeCustomBounds(changed, r, customRows, serviceBounds);
    }
    writeMetrics(changed, r, data, rows, serviceBounds);

    return workbook;
}


// ============================================================================
// Шапка листа
// ============================================================================

/**
 * Период для шапки: «Октябрь 2026 (01.10.2026 – 31.10.2026)», «2026 год (01.01.2026 – 31.12.2026)» или для диапазона
 * просто «01.10.2026 – 10.10.2026». Даты — те, за которые загружены данные (data.from, data.to): если новый период
 * ещё грузится или не загрузился, в файл попадёт то, что сейчас на странице, и подписан он будет честно
 */
function periodTitle(data, period) {
    const dates = `${formatDate(data.from)} – ${formatDate(data.to)}`;
    const selected = periodDates(period);
    const isLoaded = selected.from === data.from && selected.to === data.to;
    if (isLoaded && period.type === 'month') {
        return `${formatMonth(period.month)} (${dates})`;
    }
    if (isLoaded && period.type === 'year') {
        return `${period.year} год (${dates})`;
    }
    return dates;
}

/** Название выбранного продукта: '' — «Все» */
function productTitle(products, productId) {
    const product = products.find(function (item) { return String(item.id) === productId; });
    return product !== undefined ? product.name : 'Все';
}

/** Новый лист: без сетки Excel (у таблиц свои рамки), ширина колонок и альбомная печать на ширину страницы */
function addSheet(workbook, title, bucketCount) {
    const sheet = workbook.addWorksheet(title, {
        views: [{ showGridLines: false }],
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    sheet.getColumn(1).width = 34;
    sheet.getColumn(2).width = 32;
    for (let i = 0; i < bucketCount; i++) {
        sheet.getColumn(FIRST_VALUE_COLUMN + i).width = 13;
    }
    return sheet;
}

/** Заголовок листа и строки под ним (период, продукт, границы). Возвращает номер первой свободной строки */
function writeHeading(sheet, lines) {
    put(sheet, 1, 1, 'Деградация сервисов', { bold: true, size: 14 });
    for (let i = 0; i < lines.length; i++) {
        put(sheet, 2 + i, 1, lines[i]);
    }
    return lines.length + 3;   // заголовок, строки и одна пустая
}

/** Таблица своих границ: сервис и диапазон каждой степени («31–60%» или «отключена») */
function writeCustomBounds(sheet, r, customRows, serviceBounds) {
    put(sheet, r, 1, 'Свои границы степеней', { bold: true });
    r++;
    put(sheet, r, 1, 'Сервис', GRAY);
    for (let k = 0; k < 4; k++) {
        put(sheet, r, 2 + k, STEPEN_NAMES[k], stepenHeader(k));
    }
    r++;

    for (const row of customRows) {
        put(sheet, r, 1, row.service, { border: true });
        const ranges = getStepenRanges(boundsOf(serviceBounds, row.service_id));
        for (let k = 0; k < 4; k++) {
            const isOff = ranges[k].unused;
            put(sheet, r, 2 + k, isOff ? 'отключена' : formatRange(ranges[k]), {
                align: 'center', border: true, color: isOff ? TEXT_2 : TEXT,
            });
        }
        r++;
    }
    return r + 1;
}


// ============================================================================
// Блок метрики: сводка, сервисы и детализация — друг под другом
// ============================================================================

/** Блоки всех метрик подряд, начиная со строки r */
function writeMetrics(sheet, r, data, rows, serviceBounds) {
    const lastColumn = FIRST_VALUE_COLUMN + data.buckets.length - 1;
    for (const metric of data.metrics) {
        // название метрики — серой полосой на всю ширину детализации
        putMerged(sheet, r, 1, r, lastColumn, metric.label, { bold: true, size: 13, fill: WASH });
        r += 2;
        const stats = buildServiceStats(rows, metric, data.buckets, serviceBounds);
        r = writeSummary(sheet, r, stats);
        r = writeServices(sheet, r, stats);
        r = writeDetail(sheet, r, metric, data.buckets, rows, serviceBounds);
        r++;
    }
}

/** Сводка — то, что на кольце и в легенде: сколько аварий каждой степени и какая это доля */
function writeSummary(sheet, r, stats) {
    put(sheet, r, 1, 'Сводка по степеням', { bold: true });
    r++;
    const titles = ['Степень', 'Диапазон', 'Аварий', 'Доля'];
    for (let i = 0; i < titles.length; i++) {
        put(sheet, r, 1 + i, titles[i], GRAY);
    }
    r++;

    const counts = [0, 0, 0, 0];
    for (const item of stats) {
        for (let k = 0; k < 4; k++) {
            counts[k] = counts[k] + item.stepenCounts[k];
        }
    }
    const total = sum(counts);
    // доля — числом, а в ячейке видно «34%»; аварий нет вообще — долю не посчитать
    function share(count) {
        return total > 0 ? count / total : '—';
    }

    const ranges = getStepenRanges();   // подписи диапазонов — по умолчанию, как в легенде на странице
    for (let k = 0; k < 4; k++) {
        put(sheet, r, 1, ranges[k].name, stepenHeader(k));
        put(sheet, r, 2, formatRange(ranges[k]), { border: true });
        put(sheet, r, 3, counts[k], { align: 'right', border: true });
        put(sheet, r, 4, share(counts[k]), { align: 'right', border: true, numFmt: '0%' });
        r++;
    }
    put(sheet, r, 1, 'Всего', GRAY);
    put(sheet, r, 2, '', GRAY);
    put(sheet, r, 3, total, { ...GRAY, align: 'right' });
    put(sheet, r, 4, share(total), { ...GRAY, align: 'right', numFmt: '0%' });
    return r + 2;
}

/** Сервисы — то, что на полосах под кольцом: только сервисы с авариями, от большего к меньшему */
function writeServices(sheet, r, stats) {
    put(sheet, r, 1, 'Сервисы', { bold: true });
    r++;

    const services = stats.filter(function (item) { return sum(item.stepenCounts) > 0; });
    services.sort(function (a, b) { return sum(b.stepenCounts) - sum(a.stepenCounts); });
    if (services.length === 0) {
        put(sheet, r, 1, 'Аварий нет', { color: TEXT_2 });
        return r + 2;
    }

    put(sheet, r, 1, 'Сервис', GRAY);
    put(sheet, r, 2, 'Всего', { ...GRAY, align: 'right' });
    for (let k = 0; k < 4; k++) {
        put(sheet, r, 3 + k, STEPEN_NAMES[k], stepenHeader(k));
    }
    r++;

    for (const item of services) {
        put(sheet, r, 1, item.name, { border: true });
        put(sheet, r, 2, sum(item.stepenCounts), { bold: true, align: 'right', border: true });
        for (let k = 0; k < 4; k++) {
            const count = item.stepenCounts[k];
            put(sheet, r, 3 + k, count, { align: 'center', border: true, color: count ? TEXT : TEXT_2 });
        }
        r++;
    }
    return r + 1;
}

/**
 * Детализация — таблица «как в Excel» с той же раскраской, что на странице: шапка со степенями над колонками
 * диапазонов, строка «Всего», продукты с подытогом, в них операции и сервисы. Ячейка сервиса красится цветом
 * его степени (у сервиса со своими границами — по ним), а сам сервис со своими границами — в чёрной рамке
 */
function writeDetail(sheet, r, metric, buckets, rows, serviceBounds) {
    put(sheet, r, 1, 'Детализация', { bold: true });
    r++;

    const columns = buildTableColumns(buckets);
    const spans = stepenColumnSpans(columns);   // сколько колонок под каждой степенью: [2, 3, 3, 2]

    // шапка в две строки: «Операция» и «Сервис» на обе, названия степеней над их колонками, под ними — диапазоны
    putMerged(sheet, r, 1, r + 1, 1, 'Операция', GRAY);
    putMerged(sheet, r, 2, r + 1, 2, 'Сервис', GRAY);
    let c = FIRST_VALUE_COLUMN;
    for (let k = 0; k < 4; k++) {
        putMerged(sheet, r, c, r, c + spans[k] - 1, STEPEN_NAMES[k], { ...stepenHeader(k), align: 'center' });
        c = c + spans[k];
    }
    for (let i = 0; i < columns.length; i++) {
        const fill = excelColor(STEPEN_COLORS[columns[i].stepen].emptyCellBackground);
        put(sheet, r + 1, FIRST_VALUE_COLUMN + i, `${columnTitle(columns[i])}%`, { align: 'center', fill: fill, border: true });
    }
    r += 2;

    r = writeStepenTotals(sheet, r, 'Всего', sumByStepen(rows, metric, buckets, serviceBounds), spans, true);

    for (const productRows of groupBy(rows, function (row) { return row.product_id; })) {
        const productTotals = sumByStepen(productRows, metric, buckets, serviceBounds);
        r = writeStepenTotals(sheet, r, productRows[0].product, productTotals, spans, false);

        for (const operationRows of groupBy(productRows, function (row) { return row.operation_id; })) {
            // название операции — один раз, в ячейку высотой во все её сервисы
            putMerged(sheet, r, 1, r + operationRows.length - 1, 1, operationRows[0].operation, { border: true, wrap: true });

            for (const row of operationRows) {
                const bounds = boundsOf(serviceBounds, row.service_id);
                put(sheet, r, 2, row.service, {
                    fill: WASH, wrap: true, border: hasOwnBounds(serviceBounds, row.service_id) ? CUSTOM_BORDER : true,
                });
                const counts = row.counts[metric.id];
                for (let i = 0; i < counts.length; i++) {
                    const colors = STEPEN_COLORS[stepenOf(columns[i].to, bounds)];
                    // есть аварии — цвет степени и жирное число; нет — бледный оттенок и серый ноль
                    const style = counts[i]
                        ? { bold: true, fill: excelColor(colors.cellBackground) }
                        : { color: TEXT_2, fill: excelColor(colors.emptyCellBackground) };
                    put(sheet, r, FIRST_VALUE_COLUMN + i, counts[i], { ...style, align: 'center', border: true });
                }
                r++;
            }
        }
    }
    return r + 1;
}

/**
 * Строка итога («Всего» или продукт): название на две колонки и по объединённой ячейке на степень.
 * isColored — у «Всего» ячейки бледного цвета степени, у продукта — серые, как на странице
 */
function writeStepenTotals(sheet, r, title, stepenCounts, spans, isColored) {
    putMerged(sheet, r, 1, r, 2, title, GRAY);
    let c = FIRST_VALUE_COLUMN;
    for (let k = 0; k < 4; k++) {
        const fill = isColored ? excelColor(STEPEN_COLORS[k].totalBackground) : WASH;
        putMerged(sheet, r, c, r, c + spans[k] - 1, stepenCounts[k], { ...GRAY, fill: fill, align: 'center' });
        c = c + spans[k];
    }
    return r + 1;
}


// ============================================================================
// Ячейки и оформление
// ============================================================================

// Готовые наборы оформления для put
const GRAY = { bold: true, fill: WASH, border: true };   // заголовки колонок, строки «Всего» и продуктов
const CUSTOM_BORDER = allSides({ style: 'medium', color: { argb: TEXT } });   // сервис со своими границами

/** Заголовок степени: её цвет, белый жирный текст — как шапка таблицы на странице */
function stepenHeader(k) {
    return { bold: true, color: WHITE, fill: excelColor(STEPEN_COLORS[k].color), border: true };
}

/**
 * Записать значение в ячейку (row, col) и оформить её. style:
 *   bold, size — жирный и размер шрифта; color — цвет текста; fill — фон; align — 'left' | 'center' | 'right';
 *   wrap — переносить длинный текст; numFmt — формат числа ('0%'); border — true (тонкая серая рамка) или своя рамка
 */
function put(sheet, row, col, value, style = {}) {
    const cell = sheet.getCell(row, col);
    cell.value = value;
    cell.font = { bold: style.bold === true, size: style.size || 11, color: { argb: style.color || TEXT } };
    cell.alignment = { horizontal: style.align || 'left', vertical: 'middle', wrapText: style.wrap === true };
    if (style.fill) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } };
    }
    if (style.numFmt) {
        cell.numFmt = style.numFmt;
    }
    if (style.border === true) {
        cell.border = allSides({ style: 'thin', color: { argb: LINE } });
    } else if (style.border) {
        cell.border = style.border;
    }
}

/**
 * То же, но в объединённую ячейку от (top, left) до (bottom, right). Сначала оформляем первую ячейку, потом
 * объединяем: ExcelJS раздаёт её оформление остальным, и рамка с фоном ложатся на всю объединённую ячейку
 */
function putMerged(sheet, top, left, bottom, right, value, style) {
    put(sheet, top, left, value, style);
    if (bottom > top || right > left) {
        sheet.mergeCells(top, left, bottom, right);
    }
}

/** Одинаковая линия со всех четырёх сторон ячейки */
function allSides(line) {
    return { top: line, left: line, bottom: line, right: line };
}

/**
 * Цвет со страницы → цвет для Excel: '#2fc35a' → 'FF2FC35A'. Прозрачность Excel не понимает, поэтому
 * 'rgba(47, 195, 90, 0.12)' смешиваем с белым фоном — получается тот же бледный оттенок, что на странице
 */
function excelColor(color) {
    if (color.startsWith('#')) {
        return `FF${color.slice(1)}`.toUpperCase();
    }
    const [red, green, blue, alpha] = color.match(/[\d.]+/g).map(Number);
    let hex = 'FF';
    for (const channel of [red, green, blue]) {
        const mixed = Math.round(channel * alpha + 255 * (1 - alpha));
        hex = hex + mixed.toString(16).padStart(2, '0');
    }
    return hex.toUpperCase();
}

/** Отдать файл браузеру на скачивание: ссылка на файл в памяти и «нажатие» на неё */
function download(buffer, fileName) {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    // файл в памяти больше не нужен — освобождаем чуть позже, когда скачивание уже началось
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
