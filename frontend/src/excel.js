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

// Колонки листа — общие для всех таблиц, поэтому таблицы стоят ровно друг под другом:
// A — операция, B — сервис, с C — диапазоны по 10% (над ними — степени: минимальная над 0–10% и 11–20% и т.д.),
// сразу за диапазонами — «Всего» (в сводке и списке сервисов). Сводка, сервисы и свои границы ставят каждую степень
// в те же колонки, что и шапка детализации (stepenPlaces)
const FIRST_VALUE_COLUMN = 3;
const OPERATION_WIDTH = 30;
const SERVICE_WIDTH = 38;
const VALUE_WIDTH = 11;

// Высота строк в пунктах: у Excel по умолчанию 15 — таблицы выходят тесными. Пустые строки-отступы остаются 15
const TITLE_HEIGHT = 28;
const BAND_HEIGHT = 26;
const ROW_HEIGHT = 20;
const LINE_HEIGHT = 15;   // одна строка текста — для ячеек, где длинное название переносится


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
    const places = stepenPlaces(data.buckets);
    // строки шапки листа: [название, значение]
    const heading = [
        ['Период', periodTitle(data, period)],
        ['Продукт', productTitle(data.products, productId)],
    ];

    // лист 1: свои границы не учитываем — пустой serviceBounds, у всех сервисов границы по умолчанию
    const defaultBounds = getStepenRanges().map(function (range) {
        return `${range.name.toLowerCase()} ${formatRange(range)}`;
    });
    const plain = addSheet(workbook, 'Без изменений', data.buckets.length);
    let r = writeHeading(plain, [...heading, ['Границы степеней', `у всех сервисов по умолчанию: ${defaultBounds.join(', ')}`]]);
    writeMetrics(plain, r, data, rows, {}, places);
    setRowHeights(plain);

    // лист 2: как на странице — со своими границами у тех сервисов, которым их задали
    const customRows = rows.filter(function (row) { return hasOwnBounds(serviceBounds, row.service_id); });
    const changed = addSheet(workbook, 'С изменениями', data.buckets.length);
    const boundsNote = customRows.length > 0
        ? `свои у сервисов: ${customRows.length} (таблица ниже), у остальных — по умолчанию`
        : 'свои не заданы — данные совпадают с листом «Без изменений»';
    r = writeHeading(changed, [...heading, ['Границы степеней', boundsNote]]);
    if (customRows.length > 0) {
        r = writeCustomBounds(changed, r, customRows, serviceBounds, places);
    }
    writeMetrics(changed, r, data, rows, serviceBounds, places);
    setRowHeights(changed);

    return workbook;
}

/**
 * Где на листе колонки каждой степени — как в шапке детализации: [{ first: 3, last: 4 }, { first: 5, last: 7 }, …]
 * (минимальная над 0–10% и 11–20%, частичная над 21–30% … 41–50% и т.д.)
 */
function stepenPlaces(buckets) {
    const spans = stepenColumnSpans(buildTableColumns(buckets));   // сколько колонок под каждой степенью: [2, 3, 3, 2]
    const places = [];
    let c = FIRST_VALUE_COLUMN;
    for (const span of spans) {
        places.push({ first: c, last: c + span - 1 });
        c = c + span;
    }
    return places;
}

/** Колонка «Всего» — сразу за последней степенью */
function totalColumnOf(places) {
    return places[places.length - 1].last + 1;
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

/**
 * Новый лист: без сетки Excel (у таблиц свои рамки), ширина колонок и альбомная печать на ширину страницы
 * с узкими полями, по центру листа
 */
function addSheet(workbook, title, bucketCount) {
    const sheet = workbook.addWorksheet(title, {
        views: [{ showGridLines: false }],
        pageSetup: {
            orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
            margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
        },
    });
    sheet.getColumn(1).width = OPERATION_WIDTH;
    sheet.getColumn(2).width = SERVICE_WIDTH;
    // диапазоны и «Всего» за ними — одной ширины
    for (let i = 0; i <= bucketCount; i++) {
        sheet.getColumn(FIRST_VALUE_COLUMN + i).width = VALUE_WIDTH;
    }
    return sheet;
}

/**
 * Заголовок листа и под ним строки «название — значение» (период, продукт, границы): название серым в колонке A,
 * значение жирным с колонки B. Возвращает номер первой свободной строки
 */
function writeHeading(sheet, lines) {
    put(sheet, 1, 1, 'Деградация сервисов', { bold: true, size: 16 });
    sheet.getRow(1).height = TITLE_HEIGHT;
    for (let i = 0; i < lines.length; i++) {
        put(sheet, 2 + i, 1, lines[i][0], { color: TEXT_2 });
        put(sheet, 2 + i, 2, lines[i][1], { bold: true });   // длинное значение уходит в пустые ячейки правее
    }
    return lines.length + 3;   // заголовок, строки и одна пустая
}

/** Таблица своих границ: операция, сервис и диапазон каждой степени («31–60%» или «отключена») под её колонками */
function writeCustomBounds(sheet, r, customRows, serviceBounds, places) {
    put(sheet, r, 1, 'Свои границы степеней', SECTION);
    r++;
    put(sheet, r, 1, 'Операция', GRAY);
    put(sheet, r, 2, 'Сервис', GRAY);
    for (let k = 0; k < 4; k++) {
        putMerged(sheet, r, places[k].first, r, places[k].last, STEPEN_NAMES[k], stepenHeader(k));
    }
    r++;

    for (const row of customRows) {
        putName(sheet, r, 1, row.operation, OPERATION_WIDTH, { border: true });
        putName(sheet, r, 2, row.service, SERVICE_WIDTH, { border: true });
        const ranges = getStepenRanges(boundsOf(serviceBounds, row.service_id));
        for (let k = 0; k < 4; k++) {
            const isOff = ranges[k].unused;
            putMerged(sheet, r, places[k].first, r, places[k].last, isOff ? 'отключена' : formatRange(ranges[k]), {
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

/** Блоки всех метрик подряд, начиная со строки r. При печати каждая следующая метрика начинается с новой страницы */
function writeMetrics(sheet, r, data, rows, serviceBounds, places) {
    let lastRow = 0;   // последняя строка таблиц предыдущей метрики
    for (let m = 0; m < data.metrics.length; m++) {
        const metric = data.metrics[m];
        if (m > 0) {
            // разрыв — сразу под таблицей, а не под отступом перед полосой метрики: если таблица заняла страницу
            // целиком, пустые строки-отступы ушли бы на отдельную пустую страницу
            sheet.getRow(lastRow).addPageBreak();
        }
        // название метрики — серой полосой на всю ширину таблиц, вместе с «Всего»
        putMerged(sheet, r, 1, r, totalColumnOf(places), metric.label, { bold: true, size: 13, fill: WASH });
        sheet.getRow(r).height = BAND_HEIGHT;
        r += 2;
        // по строке на сервис, в том же порядке, что rows
        const stats = buildServiceStats(rows, metric, data.buckets, serviceBounds);
        r = writeSummary(sheet, r, stats, places);
        r = writeServices(sheet, r, rows, stats, places);
        r = writeDetail(sheet, r, metric, data.buckets, rows, serviceBounds, places);
        lastRow = r - 2;   // writeDetail вернула строку после пустой строки-отступа
        r++;
    }
}

/**
 * Сводка — то, что на кольце и в легенде: по колонке на степень (под её колонками в детализации) и «Всего» справа;
 * строки — диапазон степени, сколько аварий и какая это доля
 */
function writeSummary(sheet, r, stats, places) {
    put(sheet, r, 1, 'Сводка по степеням', SECTION);
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
    const totalColumn = totalColumnOf(places);
    const center = { align: 'center', border: true };

    putMerged(sheet, r, 1, r, 2, 'Степень', GRAY);
    for (let k = 0; k < 4; k++) {
        putMerged(sheet, r, places[k].first, r, places[k].last, ranges[k].name, stepenHeader(k));
    }
    put(sheet, r, totalColumn, 'Всего', { ...GRAY, align: 'center' });
    r++;

    putMerged(sheet, r, 1, r, 2, 'Диапазон', GRAY);
    for (let k = 0; k < 4; k++) {
        putMerged(sheet, r, places[k].first, r, places[k].last, formatRange(ranges[k]), { ...center, color: TEXT_2 });
    }
    put(sheet, r, totalColumn, '', GRAY);
    r++;

    // число аварий — на бледном цвете степени, как строка «Всего» в детализации
    putMerged(sheet, r, 1, r, 2, 'Аварий', GRAY);
    for (let k = 0; k < 4; k++) {
        const fill = excelColor(STEPEN_COLORS[k].totalBackground);
        putMerged(sheet, r, places[k].first, r, places[k].last, counts[k], { ...center, bold: true, fill: fill });
    }
    put(sheet, r, totalColumn, total, { ...GRAY, align: 'center' });
    r++;

    putMerged(sheet, r, 1, r, 2, 'Доля', GRAY);
    for (let k = 0; k < 4; k++) {
        putMerged(sheet, r, places[k].first, r, places[k].last, share(counts[k]), { ...center, numFmt: '0%' });
    }
    put(sheet, r, totalColumn, share(total), { ...GRAY, align: 'center', numFmt: '0%' });
    return r + 2;
}

/**
 * Сервисы — то, что на полосах под кольцом: только сервисы с авариями, от большего к меньшему. Число аварий
 * каждой степени — под колонками степени, раскрашено как в детализации; «Всего» — справа.
 *   rows — сервисы, stats — их статистика из buildServiceStats (по строке на сервис, в том же порядке)
 */
function writeServices(sheet, r, rows, stats, places) {
    put(sheet, r, 1, 'Сервисы', SECTION);
    r++;

    const services = [];
    for (let i = 0; i < rows.length; i++) {
        const total = sum(stats[i].stepenCounts);
        if (total > 0) {
            services.push({ row: rows[i], stepenCounts: stats[i].stepenCounts, total: total });
        }
    }
    // от большего к меньшему; у сервисов с равным числом сохраняется порядок таблицы
    services.sort(function (a, b) { return b.total - a.total; });
    if (services.length === 0) {
        put(sheet, r, 1, 'Аварий нет', { color: TEXT_2 });
        return r + 2;
    }

    const totalColumn = totalColumnOf(places);
    put(sheet, r, 1, 'Операция', GRAY);
    put(sheet, r, 2, 'Сервис', GRAY);
    for (let k = 0; k < 4; k++) {
        putMerged(sheet, r, places[k].first, r, places[k].last, STEPEN_NAMES[k], stepenHeader(k));
    }
    put(sheet, r, totalColumn, 'Всего', { ...GRAY, align: 'center' });
    r++;

    for (const item of services) {
        putName(sheet, r, 1, item.row.operation, OPERATION_WIDTH, { border: true });
        putName(sheet, r, 2, item.row.service, SERVICE_WIDTH, { fill: WASH, border: true });
        for (let k = 0; k < 4; k++) {
            const count = item.stepenCounts[k];
            putMerged(sheet, r, places[k].first, r, places[k].last, count, { ...countStyle(count, k), align: 'center', border: true });
        }
        put(sheet, r, totalColumn, item.total, { ...GRAY, align: 'center' });
        r++;
    }
    return r + 1;
}

/**
 * Детализация — таблица «как в Excel» с той же раскраской, что на странице: шапка со степенями над колонками
 * диапазонов, строка «Всего», продукты с подытогом, в них операции и сервисы. Ячейка сервиса красится цветом
 * его степени (у сервиса со своими границами — по ним), а сам сервис со своими границами — в чёрной рамке
 */
function writeDetail(sheet, r, metric, buckets, rows, serviceBounds, places) {
    put(sheet, r, 1, 'Детализация', SECTION);
    r++;

    const columns = buildTableColumns(buckets);

    // шапка в две строки: «Операция» и «Сервис» на обе, названия степеней над их колонками, под ними — диапазоны
    putMerged(sheet, r, 1, r + 1, 1, 'Операция', GRAY);
    putMerged(sheet, r, 2, r + 1, 2, 'Сервис', GRAY);
    for (let k = 0; k < 4; k++) {
        putMerged(sheet, r, places[k].first, r, places[k].last, STEPEN_NAMES[k], stepenHeader(k));
    }
    for (let i = 0; i < columns.length; i++) {
        const fill = excelColor(STEPEN_COLORS[columns[i].stepen].emptyCellBackground);
        put(sheet, r + 1, FIRST_VALUE_COLUMN + i, `${columnTitle(columns[i])}%`, { align: 'center', fill: fill, border: true });
    }
    r += 2;

    r = writeStepenTotals(sheet, r, 'Всего', sumByStepen(rows, metric, buckets, serviceBounds), places, true);

    for (const productRows of groupBy(rows, function (row) { return row.product_id; })) {
        const productTotals = sumByStepen(productRows, metric, buckets, serviceBounds);
        r = writeStepenTotals(sheet, r, productRows[0].product, productTotals, places, false);

        for (const operationRows of groupBy(productRows, function (row) { return row.operation_id; })) {
            // название операции — один раз, в ячейку высотой во все её сервисы
            const operation = operationRows[0].operation;
            putMerged(sheet, r, 1, r + operationRows.length - 1, 1, operation, { border: true, wrap: true });
            if (operationRows.length === 1) {
                fitHeight(sheet, r, operation, OPERATION_WIDTH);   // у ячейки в одну строку высоты может не хватить
            }

            for (const row of operationRows) {
                const bounds = boundsOf(serviceBounds, row.service_id);
                putName(sheet, r, 2, row.service, SERVICE_WIDTH, {
                    fill: WASH, border: hasOwnBounds(serviceBounds, row.service_id) ? CUSTOM_BORDER : true,
                });
                const counts = row.counts[metric.id];
                for (let i = 0; i < counts.length; i++) {
                    const style = countStyle(counts[i], stepenOf(columns[i].to, bounds));
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
function writeStepenTotals(sheet, r, title, stepenCounts, places, isColored) {
    putMerged(sheet, r, 1, r, 2, title, GRAY);
    for (let k = 0; k < 4; k++) {
        const fill = isColored ? excelColor(STEPEN_COLORS[k].totalBackground) : WASH;
        putMerged(sheet, r, places[k].first, r, places[k].last, stepenCounts[k], { ...GRAY, fill: fill, align: 'center' });
    }
    return r + 1;
}


// ============================================================================
// Ячейки и оформление
// ============================================================================

// Готовые наборы оформления для put
const GRAY = { bold: true, fill: WASH, border: true };   // заголовки колонок, строки «Всего» и продуктов
const SECTION = { bold: true, size: 12 };                // подзаголовки: «Сводка по степеням», «Сервисы», …
const CUSTOM_BORDER = allSides({ style: 'medium', color: { argb: TEXT } });   // сервис со своими границами

/** Заголовок степени: её цвет, белый жирный текст по центру — как шапка таблицы на странице */
function stepenHeader(k) {
    return { bold: true, color: WHITE, fill: excelColor(STEPEN_COLORS[k].color), border: true, align: 'center' };
}

/**
 * Раскраска числа аварий степени k — как в таблице на странице: есть аварии — цвет степени и жирное число;
 * нет — бледный оттенок и серый ноль
 */
function countStyle(count, k) {
    const colors = STEPEN_COLORS[k];
    return count
        ? { bold: true, fill: excelColor(colors.cellBackground) }
        : { color: TEXT_2, fill: excelColor(colors.emptyCellBackground) };
}

/** Название операции или сервиса в колонку шириной width: длинное переносится, и строка становится выше */
function putName(sheet, row, col, text, width, style) {
    put(sheet, row, col, text, { ...style, wrap: true });
    fitHeight(sheet, row, text, width);
}

/**
 * Сделать строку row выше, если text не влезает в колонку шириной width одной строкой. Excel сам высоту строки
 * под перенесённый текст не подбирает, если она задана (а её задаём всем строкам — setRowHeights)
 */
function fitHeight(sheet, row, text, width) {
    // ширина колонки в Excel — в цифрах «0»; кириллица шире, плюс отступы по краям — влезает примерно width − 4 букв
    const lines = Math.ceil(String(text).length / (width - 4));
    if (lines > 1) {
        const sheetRow = sheet.getRow(row);
        sheetRow.height = Math.max(sheetRow.height || ROW_HEIGHT, lines * LINE_HEIGHT + 5);
    }
}

/** Всем строкам с содержимым, кроме тех, кому высоту уже задали, — ROW_HEIGHT; пустые строки-отступы остаются ниже */
function setRowHeights(sheet) {
    sheet.eachRow(function (row) {
        if (!row.height) {
            row.height = ROW_HEIGHT;
        }
    });
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
