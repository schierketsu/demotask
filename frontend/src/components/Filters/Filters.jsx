// Filters.jsx — панель фильтров над страницей, одной строкой в рамке:
//   переключатель «Месяц | Год | Диапазон» → навигатор периода «‹ [Октябрь 2026 ⌄] ›»
//   (в режиме «Диапазон» — кнопка «[01.10.2026 – 10.10.2026 ⌄]») → «Продукт [Все ⌄]»
// Нажатие на название периода открывает календарь: сетку месяцев с годом наверху, сетку годов
// или (для диапазона) сетку дней месяца. Нажатие на продукт раскрывает список продуктов.
// Выбранное в панели — белая «таблетка» с тенью.

import { useEffect, useRef, useState } from 'react';
import { MONTH_SHORT_NAMES } from '../../config.js';
import { formatDate, formatMonth } from '../../period.js';
import { classNames } from '../../helpers.js';
import './Filters.scss';   // стили этого компонента

// Способы выбора периода: значение для period.type и подпись на переключателе
const PERIOD_TYPES = [
    { value: 'month', label: 'Месяц' },
    { value: 'year', label: 'Год' },
    { value: 'range', label: 'Диапазон' },
];

// Дни недели в календаре диапазона — неделя начинается с понедельника
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// С какого числа продуктов в списке появляется поиск: пока их немного, поиск только мешает
const PRODUCT_SEARCH_FROM = 7;

/**
 * Панель фильтров.
 *   data — данные с сервера: months (месяцы, где есть данные, по порядку), minDate, maxDate, products
 *   period — выбранный период ({ type, month, year, rangeFrom, rangeTo }, см. period.js)
 *   onPeriodChange(changes) — поменяли что-то в периоде: { type: 'year' }, { month: '2026-09' }, …
 *   productId, onProductChange(id) — выбранный продукт ('' — все)
 */
export default function Filters({ data, period, onPeriodChange, productId, onProductChange }) {
    // панель из двух половин с разделителем ровно посередине: слева — период, справа — продукт
    return (
        <div className="toolbar">
            <div className="toolbar-half">
                {/* способ выбора периода — сегментный переключатель: выбранный вариант — белая «таблетка» */}
                <div className="segmented" role="radiogroup" aria-label="Период">
                    {PERIOD_TYPES.map(function (type) {
                        return (
                            <button
                                key={type.value} type="button" role="radio" aria-checked={period.type === type.value}
                                onClick={function () { onPeriodChange({ type: type.value }); }}
                            >{type.label}</button>
                        );
                    })}
                </div>

                <span className="toolbar-divider" />

                {/* key — при смене способа (месяц ↔ год) навигатор создаётся заново, и открытый календарь закрывается */}
                {period.type === 'range'
                    ? <RangeField data={data} period={period} onPeriodChange={onPeriodChange} />
                    : <PeriodNavigator key={period.type} data={data} period={period} onPeriodChange={onPeriodChange} />}
            </div>

            <span className="toolbar-divider" />

            {/* продукт — кнопка с выбранным продуктом, по нажатию — список всех продуктов */}
            <div className="toolbar-group">
                <span className="toolbar-label" id="product-label">Продукт</span>
                <ProductSelect products={data.products} productId={productId} onProductChange={onProductChange} />
            </div>
        </div>
    );
}

/**
 * Выбор продукта: кнопка «[Все ⌄]» — такая же белая «таблетка», как название периода; по нажатию раскрывается
 * список: «Все» и все продукты, выбранный — жирным. Продуктов может стать много, поэтому список
 * прокручивается, а с PRODUCT_SEARCH_FROM продуктов сверху появляется поиск по названию.
 *   products — продукты с сервера [{ id, name }]; productId — выбранный ('' — все); onProductChange(id) — выбрали
 */
function ProductSelect({ products, productId, onProductChange }) {
    const [isOpen, setOpen] = useState(false);
    const [query, setQuery] = useState('');   // что ввели в поиске
    const box = useRef(null);
    useCloseOnOutside(isOpen, setOpen, box);

    // варианты: первым — «Все» (id ''); id храним текстом, как и выбранный продукт
    const choices = [{ id: '', name: 'Все' }].concat(products.map(function (product) {
        return { id: String(product.id), name: product.name };
    }));
    const selected = choices.find(function (choice) { return choice.id === productId; }) || choices[0];

    // поиск — без учёта регистра: «карта» найдёт «Кредитная карта»
    const search = query.trim().toLowerCase();
    const visible = choices.filter(function (choice) {
        return search === '' || choice.name.toLowerCase().includes(search);
    });

    function choose(id) {
        onProductChange(id);
        setOpen(false);
        setQuery('');
    }

    return (
        <div className="period-picker-box" ref={box}>
            <button
                type="button" className="period-title product-title" aria-haspopup="listbox" aria-expanded={isOpen}
                aria-labelledby="product-label product-value"
                onClick={function () { setOpen(!isOpen); }}
            ><span id="product-value" className="title-text">{selected.name}</span></button>

            {isOpen && (
                <div className="picker product-picker">
                    {products.length >= PRODUCT_SEARCH_FROM && (
                        <input
                            type="search" className="picker-search" placeholder="Найти продукт" aria-label="Найти продукт"
                            value={query} autoFocus
                            onChange={function (event) { setQuery(event.target.value); }}
                        />
                    )}
                    <div className="option-list" role="listbox" aria-label="Продукт">
                        {visible.map(function (choice) {
                            return (
                                <button
                                    key={choice.id} type="button" role="option" className="option"
                                    aria-selected={choice.id === productId}
                                    onClick={function () { choose(choice.id); }}
                                >{choice.name}</button>
                            );
                        })}
                        {visible.length === 0 && <p className="option-empty">Ничего не найдено</p>}
                    </div>
                </div>
            )}
        </div>
    );
}

/** Годы из списка месяцев, по порядку и без повторов: ['2025-09', …, '2026-10'] → ['2025', '2026'] */
function yearsOf(months) {
    const years = [];
    for (const month of months) {
        const year = month.slice(0, 4);
        if (!years.includes(year)) {
            years.push(year);
        }
    }
    return years;
}

/**
 * Закрывать открытый календарь нажатием мимо него и клавишей Esc.
 *   isOpen — открыт ли; setOpen — функция из useState, которая открывает и закрывает;
 *   box — ссылка (useRef) на кнопку с календарём: нажатие внутри неё календарь не закрывает.
 * Слушатели вешаем на всю страницу, только пока календарь открыт, и снимаем, когда закрылся
 * (функция, которую возвращает useEffect)
 */
function useCloseOnOutside(isOpen, setOpen, box) {
    useEffect(function () {
        if (!isOpen) {
            return undefined;
        }
        function closeOnOutside(event) {
            if (!box.current.contains(event.target)) {
                setOpen(false);
            }
        }
        function closeOnEscape(event) {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        }
        document.addEventListener('pointerdown', closeOnOutside);
        document.addEventListener('keydown', closeOnEscape);
        return function () {
            document.removeEventListener('pointerdown', closeOnOutside);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [isOpen, setOpen, box]);
}

/**
 * Навигатор периода для месяца и года: «‹ [Октябрь 2026 ⌄] ›».
 * Стрелки листают на месяц (год) назад и вперёд — только по тем, где есть данные; на краях стрелка недоступна.
 * Нажатие на название открывает календарь (PeriodPicker)
 */
function PeriodNavigator({ data, period, onPeriodChange }) {
    const isMonth = period.type === 'month';
    const [isPickerOpen, setPickerOpen] = useState(false);
    const box = useRef(null);   // название с календарём — чтобы понять, что нажали мимо них
    useCloseOnOutside(isPickerOpen, setPickerOpen, box);

    // что листаем: месяцы '2025-09' … '2026-10' или годы '2025', '2026'
    const items = isMonth ? data.months : yearsOf(data.months);
    const current = isMonth ? period.month : period.year;
    const index = items.indexOf(current);
    const previous = index > 0 ? items[index - 1] : null;
    const next = index < items.length - 1 ? items[index + 1] : null;

    /** Перейти на месяц или год value */
    function go(value) {
        onPeriodChange(isMonth ? { month: value } : { year: value });
    }

    const unit = isMonth ? 'месяц' : 'год';

    return (
        <div className="period-nav">
            <button
                type="button" className="nav-arrow nav-prev" aria-label={`Предыдущий ${unit}`} disabled={previous === null}
                onClick={function () { go(previous); }}
            />
            <div className="period-picker-box" ref={box}>
                <button
                    type="button" className="period-title" aria-haspopup="dialog" aria-expanded={isPickerOpen}
                    onClick={function () { setPickerOpen(!isPickerOpen); }}
                >{isMonth ? formatMonth(current) : current}</button>
                {isPickerOpen && (
                    <PeriodPicker
                        isMonth={isMonth} months={data.months} selected={current}
                        onPick={function (value) {
                            go(value);
                            setPickerOpen(false);
                        }}
                    />
                )}
            </div>
            <button
                type="button" className="nav-arrow nav-next" aria-label={`Следующий ${unit}`} disabled={next === null}
                onClick={function () { go(next); }}
            />
        </div>
    );
}

/**
 * Календарь под названием периода.
 * Месяц: наверху год со стрелками «‹ 2026 ›», ниже сетка 3×4 месяцев («Янв» … «Дек»); выбранный — белый
 * с тенью, месяцы без данных недоступны. Год: сетка годов, где есть данные.
 *   months — месяцы, где есть данные ('2025-09' …); selected — выбранный месяц или год; onPick(value) — выбрали
 */
function PeriodPicker({ isMonth, months, selected, onPick }) {
    const years = yearsOf(months);
    // какой год показан в сетке месяцев — сначала год выбранного месяца; стрелки «‹ ›» листают его
    const [shownYear, setShownYear] = useState(selected.slice(0, 4));
    const yearIndex = years.indexOf(shownYear);

    return (
        <div className="picker" role="dialog" aria-label={isMonth ? 'Выбор месяца' : 'Выбор года'}>
            {isMonth && (
                <div className="picker-head">
                    <button
                        type="button" className="nav-arrow nav-prev plain" aria-label="Предыдущий год"
                        disabled={yearIndex <= 0} onClick={function () { setShownYear(years[yearIndex - 1]); }}
                    />
                    <span className="picker-year">{shownYear}</span>
                    <button
                        type="button" className="nav-arrow nav-next plain" aria-label="Следующий год"
                        disabled={yearIndex >= years.length - 1} onClick={function () { setShownYear(years[yearIndex + 1]); }}
                    />
                </div>
            )}

            <div className="picker-grid">
                {isMonth
                    ? MONTH_SHORT_NAMES.map(function (label, i) {
                        const value = `${shownYear}-${String(i + 1).padStart(2, '0')}`;   // 'Июл' в 2026 → '2026-07'
                        return (
                            <button
                                key={value} type="button" aria-pressed={value === selected}
                                disabled={!months.includes(value)}   // за этот месяц данных нет
                                onClick={function () { onPick(value); }}
                            >{label}</button>
                        );
                    })
                    : years.map(function (year) {
                        return (
                            <button
                                key={year} type="button" aria-pressed={year === selected}
                                onClick={function () { onPick(year); }}
                            >{year}</button>
                        );
                    })}
            </div>
        </div>
    );
}

/**
 * Режим «Диапазон»: кнопка «01.10.2026 – 10.10.2026 ⌄» — такая же белая «таблетка», как название месяца;
 * нажатие открывает календарь дней (RangePicker). Выбрали начало и конец — диапазон применяется, календарь закрывается
 */
function RangeField({ data, period, onPeriodChange }) {
    const [isPickerOpen, setPickerOpen] = useState(false);
    const box = useRef(null);
    useCloseOnOutside(isPickerOpen, setPickerOpen, box);

    return (
        <div className="period-picker-box" ref={box}>
            <button
                type="button" className="period-title" aria-haspopup="dialog" aria-expanded={isPickerOpen}
                onClick={function () { setPickerOpen(!isPickerOpen); }}
            >{formatDate(period.rangeFrom)} – {formatDate(period.rangeTo)}</button>
            {isPickerOpen && (
                <RangePicker
                    minDate={data.minDate} maxDate={data.maxDate} from={period.rangeFrom} to={period.rangeTo}
                    onPick={function (from, to) {
                        onPeriodChange({ rangeFrom: from, rangeTo: to });   // обе даты сразу — данные загрузятся один раз
                        setPickerOpen(false);
                    }}
                />
            )}
        </div>
    );
}

/** Месяц через delta месяцев: addMonths('2026-10', -1) → '2026-09', addMonths('2026-12', 1) → '2027-01' */
function addMonths(month, delta) {
    const [year, monthNumber] = month.split('-').map(Number);
    const date = new Date(year, monthNumber - 1 + delta, 1);   // Date сам переносит год: 13-й месяц → январь следующего
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Календарь дней для диапазона: наверху месяц со стрелками «‹ Октябрь 2026 ›», ниже дни недели «Пн … Вс»
 * и сетка дней месяца. Первое нажатие — начало диапазона, второе — конец (если он раньше начала,
 * даты меняются местами); пока конец не выбран, будущий диапазон подсвечивается под курсором.
 * Края диапазона — белые с тенью, дни между ними — серой полосой; дни, за которые нет данных, недоступны.
 *   minDate, maxDate — первая и последняя дата случаев; from, to — выбранный сейчас диапазон;
 *   onPick(from, to) — выбрали новый диапазон
 */
function RangePicker({ minDate, maxDate, from, to, onPick }) {
    const [shownMonth, setShownMonth] = useState(from.slice(0, 7));   // какой месяц показан: сначала месяц начала
    const [start, setStart] = useState(null);       // начало, пока конец ещё не выбран; null — ждём первое нажатие
    const [hovered, setHovered] = useState(null);   // день под курсором — для подсветки будущего диапазона

    // какие дни подсвечены: пока выбирают — от начала до дня под курсором, иначе — выбранный диапазон.
    // Строки ГГГГ-ММ-ДД сравниваются как даты
    let low = from;
    let high = to;
    if (start !== null) {
        const other = hovered !== null ? hovered : start;
        low = start < other ? start : other;
        high = start < other ? other : start;
    }

    // сетка месяца: сначала пустые клетки до первого числа (неделя начинается с понедельника), потом дни
    const [year, month] = shownMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();               // день 0 следующего месяца — последний день
    const emptyCells = (new Date(year, month - 1, 1).getDay() + 6) % 7;   // getDay: 0 — вс, 1 — пн; сдвигаем к пн = 0
    const days = [];
    for (let day = 1; day <= daysInMonth; day++) {
        days.push(`${shownMonth}-${String(day).padStart(2, '0')}`);
    }

    function pick(day) {
        if (start === null) {
            setStart(day);   // первое нажатие — начало
            return;
        }
        onPick(start < day ? start : day, start < day ? day : start);   // второе — конец
    }

    return (
        <div className="picker range-picker" role="dialog" aria-label="Выбор диапазона дат">
            <div className="picker-head">
                <button
                    type="button" className="nav-arrow nav-prev plain" aria-label="Предыдущий месяц"
                    disabled={shownMonth <= minDate.slice(0, 7)} onClick={function () { setShownMonth(addMonths(shownMonth, -1)); }}
                />
                <span className="picker-year">{formatMonth(shownMonth)}</span>
                <button
                    type="button" className="nav-arrow nav-next plain" aria-label="Следующий месяц"
                    disabled={shownMonth >= maxDate.slice(0, 7)} onClick={function () { setShownMonth(addMonths(shownMonth, 1)); }}
                />
            </div>

            <div className="weekdays">
                {WEEKDAYS.map(function (name) {
                    return <span key={name}>{name}</span>;
                })}
            </div>
            <div className="day-grid" onPointerLeave={function () { setHovered(null); }}>
                {Array.from({ length: emptyCells }, function (_, i) {
                    return <span key={`empty-${i}`} />;
                })}
                {days.map(function (day) {
                    const isEdge = day === low || day === high;
                    const isInside = day > low && day < high;
                    return (
                        <button
                            key={day} type="button" aria-label={formatDate(day)} aria-pressed={isEdge}
                            className={classNames('day', isInside && 'in-range', isEdge && 'edge')}
                            disabled={day < minDate || day > maxDate}   // за этот день данных нет
                            onPointerEnter={function () { setHovered(day); }}
                            onClick={function () { pick(day); }}
                        >{Number(day.slice(8))}</button>
                    );
                })}
            </div>
        </div>
    );
}
