// DetailTable.jsx — таблица одной метрики «как в Excel»: строка «Всего», под ней продукты с подытогом,
// в каждом продукте — его операции и сервисы.

import { Fragment, useLayoutEffect, useRef } from 'react';
import { STEPEN_COLORS, STEPEN_NAMES } from '../config.js';
import {
    boundsOf, formatRange, getStepenRanges, hasOwnBounds, stepenColumnSpans, stepenOf, sum, sumByStepen,
} from '../calc.js';
import { classNames, groupBy, numberFormat } from '../helpers.js';
import { stepenTooltip, useTooltip } from './Tooltip.jsx';

// Самая узкая допустимая колонка диапазона, в пикселях: чтобы в объединённую ячейку степени
// шириной в две колонки влезало её название («Минимальная», «Полная»)
const MIN_RANGE_COLUMN_WIDTH = 56;

/**
 * Таблица одной метрики. Над колонками диапазонов — объединённые ячейки степеней («Минимальная» над 0–10 и 11–20 и т.д.).
 * В строках сервисов — число аварий в каждом диапазоне; в строках «Всего» и продуктов — итог по каждой степени
 * в такой же объединённой ячейке, с учётом своих границ у отдельных сервисов.
 *   metric — метрика, для которой строим таблицу
 *   rows — сервисы (с учётом фильтра «Продукт»); rows[].counts[id метрики] — сколько аварий в каждом диапазоне
 *   columns — колонки диапазонов [{ from: 21, to: 30, stepen: 1 }], stepen — номер степени колонки по умолчанию.
 *             Колонки общие для всех метрик, поэтому таблицы разных метрик совпадают столбец в столбец
 *   buckets — диапазоны с сервера; serviceBounds — свои границы сервисов
 *   selectedStepen, onToggleStepen — выбранная степень и клик по названию степени в шапке
 *   onOpenService(id) — нажали на сервис: открыть его окно
 *   isOpen — раскрыта ли карточка: скрытую таблицу не измерить, выравниваем колонки, когда её видно
 */
export default function DetailTable({
    metric, rows, columns, buckets, serviceBounds, selectedStepen, onToggleStepen, onOpenService, isOpen,
}) {
    const table = useRef(null);   // ссылка на <table> на странице — для equalizeColumns
    const tooltipProps = useTooltip();

    // после каждой перерисовки, пока таблицу видно, выравниваем колонки диапазонов —
    // до того, как браузер покажет её на экране (поэтому useLayoutEffect, а не useEffect)
    useLayoutEffect(function () {
        if (isOpen) {
            equalizeColumns(table.current);
        }
    });

    const spans = stepenColumnSpans(columns);   // сколько колонок под каждой степенью: [2, 3, 3, 2]
    const ranges = getStepenRanges();           // диапазоны степеней по умолчанию — для подсказки «0–20%» в шапке
    // сколько аварий каждой степени у всех показанных сервисов — для строки «Всего» и подсказок в шапке
    const totalCounts = sumByStepen(rows, metric, buckets, serviceBounds);
    const total = sum(totalCounts);

    /** Приглушать ли степень k: да, если выбрана какая-то другая степень */
    function isDimmed(k) {
        return selectedStepen !== null && selectedStepen !== k;
    }

    /**
     * Ячейки строки итога («Всего» или продукт): по одной объединённой ячейке на степень, шириной во все её колонки.
     * isColored — красить ли ячейки цветами степеней: у «Всего» да, у продукта нет — его строка целиком
     * такая же, как ячейка с названием продукта (фон и цвет текста — в style.css, tr.product)
     */
    function stepenCells(stepenCounts, isColored) {
        return stepenCounts.map(function (count, k) {
            const paint = isColored ? cellPaint(count, STEPEN_COLORS[k]) : { className: '', style: {} };
            return (
                <td key={k} colSpan={spans[k]} className={classNames(paint.className, isDimmed(k) && 'dimmed')} style={paint.style}>
                    {numberFormat.format(count)}
                </td>
            );
        });
    }

    /**
     * Ячейки строки сервиса: counts[i] — сколько аварий в колонке i. bounds — границы степеней сервиса:
     * у сервиса со своими границами колонка может относиться не к той степени, что в заголовке, —
     * тогда ячейка красится цветом его степени. Подписей диапазонов в заголовке нет — диапазон виден в подсказке
     */
    function valueCells(counts, bounds) {
        return counts.map(function (count, i) {
            const stepen = stepenOf(columns[i].to, bounds);
            const paint = cellPaint(count, STEPEN_COLORS[stepen]);
            return (
                <td
                    key={i} title={`${columnTitle(columns[i])}%`}
                    className={classNames(paint.className, isDimmed(stepen) && 'dimmed')} style={paint.style}
                >
                    {numberFormat.format(count)}
                </td>
            );
        });
    }

    return (
        <table className="grid" ref={table}>
            {/* описание колонок: три колонки названий и все колонки диапазонов. Ширину им потом задаст equalizeColumns */}
            <colgroup>
                <col className="name-col" />
                <col className="name-col" />
                <col className="name-col" />
                <col span={columns.length} className="range-cols" />
            </colgroup>

            {/* шапка: «№ / Операция / Сервис» и над колонками диапазонов — названия степеней на их цвете.
                Название степени — кнопка: клик выбирает степень (остальные приглушаются), повторный клик снимает выбор.
                Подсказка — как у сектора кольца: «Частичная · 21–50%» и «10 аварий · 34 %» */}
            <thead>
                <tr>
                    <th className="name">№</th>
                    <th className="name">Операция</th>
                    <th className="name">Сервис</th>
                    {spans.map(function (span, k) {
                        const part = { name: STEPEN_NAMES[k], rangeLabel: formatRange(ranges[k]), count: totalCounts[k], color: STEPEN_COLORS[k].color };
                        return (
                            <th
                                key={k} colSpan={span} className={classNames('stepen-head', isDimmed(k) && 'dimmed')}
                                style={{ backgroundColor: STEPEN_COLORS[k].color }}   // текст на нём — белый (style.css, .stepen-head)
                                {...tooltipProps(function () { return stepenTooltip(part, total); })}
                            >
                                <button
                                    type="button"
                                    aria-pressed={selectedStepen === k}   // выбрана ли эта степень — для экранного диктора
                                    onClick={function () { onToggleStepen(k); }}
                                >{STEPEN_NAMES[k]}</button>
                            </th>
                        );
                    })}
                </tr>
            </thead>

            <tbody>
                {/* строка «Всего» — по всем показанным сервисам */}
                <tr className="sum">
                    <td colSpan={3} className="name">Всего</td>
                    {stepenCells(totalCounts, true)}
                </tr>

                {groupBy(rows, function (row) { return row.product_id; }).map(function (productRows) {
                    // Fragment — несколько строк таблицы без лишней обёртки вокруг них
                    return (
                        <Fragment key={productRows[0].product_id}>
                            {/* строка продукта с подытогом по его сервисам — целиком серая, как ячейка с названием продукта */}
                            <tr className="sum product">
                                <td colSpan={3} className="name">{productRows[0].product}</td>
                                {stepenCells(sumByStepen(productRows, metric, buckets, serviceBounds), false)}
                            </tr>

                            {/* сервисы продукта. Номер и название операции пишем один раз —
                                в ячейку высотой во все её сервисы (rowSpan) */}
                            {groupBy(productRows, function (row) { return row.operation_id; }).map(function (operationRows) {
                                return operationRows.map(function (row, i) {
                                    const isCustom = hasOwnBounds(serviceBounds, row.service_id);
                                    return (
                                        <tr key={row.service_id}>
                                            {i === 0 && <td rowSpan={operationRows.length}>{row.operation_num}</td>}
                                            {i === 0 && <td rowSpan={operationRows.length} className="name">{row.operation}</td>}
                                            <ServiceCell
                                                name={row.service} isCustom={isCustom}
                                                bounds={boundsOf(serviceBounds, row.service_id)}
                                                onOpen={function () { onOpenService(row.service_id); }}
                                            />
                                            {valueCells(row.counts[metric.id], boundsOf(serviceBounds, row.service_id))}
                                        </tr>
                                    );
                                });
                            })}
                        </Fragment>
                    );
                })}
            </tbody>
        </table>
    );
}

/**
 * Чип сервиса — ячейка с названием сервиса, кнопкой внутри: по нажатию открывается окно его степеней деградации.
 * У чипа пунктирная обводка — его можно нажать; у сервиса со своими границами степеней она сплошная чёрная
 * (класс custom) — видно, что он изменён.
 * Нажатие ловим на всей ячейке, а не только на кнопке: в высокой строке кнопка занимает лишь середину ячейки.
 * С клавиатуры тоже работает — Enter на кнопке «всплывает» до ячейки.
 * Подсказка — границы степеней сервиса (свои или по умолчанию; отключённые — «отключена») и что будет по нажатию.
 *   bounds — границы степеней сервиса
 */
function ServiceCell({ name, isCustom, bounds, onOpen }) {
    const tooltipProps = useTooltip();
    const tooltip = tooltipProps(function () {
        const rows = getStepenRanges(bounds).map(function (range) {
            return { label: `${range.name} · ${range.unused ? 'отключена' : formatRange(range)}`, color: range.color };
        });
        return {
            title: isCustom ? 'Свои границы степеней' : 'Границы степеней по умолчанию',
            rows: rows,
            note: isCustom ? 'Нажмите, чтобы изменить' : 'Нажмите, чтобы задать свои границы',
        };
    });

    function open() {
        tooltipProps.hide();   // откроется окно — подсказка над ним не нужна
        onOpen();
    }

    return (
        <td className={classNames('name service-cell', isCustom && 'custom')} onClick={open} {...tooltip}>
            <button
                type="button" className={classNames('service-chip', isCustom && 'custom')} aria-haspopup="dialog"
            >{name}</button>
        </td>
    );
}

/** Подпись колонки: «21–30», а если колонка шириной в один процент — просто «31» */
function columnTitle(column) {
    return column.from === column.to ? String(column.from) : `${column.from}–${column.to}`;
}

/**
 * Как покрасить ячейку цветом степени её колонки (colors — набор цветов степени из STEPEN_COLORS):
 * есть аварии — чуть высветленный цвет и жирное белое число, нет — бледный оттенок и серый ноль.
 * Возвращает { className, style } для ячейки
 */
function cellPaint(count, colors) {
    if (count) {
        return { className: 'has-accidents', style: { backgroundColor: colors.cellBackground } };
    }
    return { className: '', style: { backgroundColor: colors.emptyCellBackground, color: 'var(--text-2)' } };
}

/**
 * Сделать колонки диапазонов строго одинаковой ширины.
 * В обычной раскладке браузер раздаёт свободное место пропорционально содержимому, и колонка
 * с длинной подписью («91–100») выходит шире остальных. Поэтому:
 *   0. сбрасываем прошлое выравнивание — React не пересоздаёт таблицу, а обновляет ту же;
 *   1. берём ширину колонок №, операции и сервиса такой, какой её только что посчитал браузер (по содержимому);
 *   2. закрепляем её;
 *   3. переключаем таблицу на фиксированную раскладку — там остаток ширины делится между колонками поровну.
 * Если места меньше, чем MIN_RANGE_COLUMN_WIDTH на колонку, таблица не сжимается, а прокручивается.
 * Вызывать, когда таблица уже на странице и её видно — иначе мерить нечего.
 */
function equalizeColumns(table) {
    const nameColumns = table.querySelectorAll('col.name-col');

    // 0. обычная раскладка, как до выравнивания
    table.style.tableLayout = '';
    table.style.minWidth = '';
    for (const col of nameColumns) {
        col.style.width = '';
    }

    // 1. ширина колонок с названиями
    const nameWidths = [];
    for (const th of table.querySelectorAll('thead th.name')) {
        nameWidths.push(th.getBoundingClientRect().width);
    }

    // 2. закрепляем её у описаний колонок
    for (let i = 0; i < nameColumns.length; i++) {
        nameColumns[i].style.width = `${nameWidths[i]}px`;
    }

    // таблица не уже, чем названия + колонки диапазонов по MIN_RANGE_COLUMN_WIDTH + промежутки между ячейками
    // (промежутков на один больше, чем колонок: колонок диапазонов valueCount и ещё 3 колонки названий).
    // Сколько колонок диапазонов — берём из их описания <col span="10">: заголовки над ними объединены по степеням
    const valueCount = table.querySelector('col.range-cols').span;
    const cssSpacing = parseFloat(getComputedStyle(table).borderSpacing);   // промежуток между ячейками из CSS
    const spacing = Number.isNaN(cssSpacing) ? 0 : cssSpacing;
    table.style.minWidth = `${sum(nameWidths) + valueCount * MIN_RANGE_COLUMN_WIDTH + (valueCount + 4) * spacing}px`;

    // 3. фиксированная раскладка
    table.style.tableLayout = 'fixed';
}
