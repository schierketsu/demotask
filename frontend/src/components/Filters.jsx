// Filters.jsx — верхняя строка фильтров: «Период» (месяц, год или диапазон дат) и «Продукт».

import { formatMonth } from '../period.js';

/**
 * Фильтры над страницей.
 *   data — данные с сервера: months (месяцы для выбора), minDate, maxDate, products
 *   period — выбранный период ({ type, month, year, rangeFrom, rangeTo }, см. period.js)
 *   onPeriodChange(changes) — поменяли что-то в периоде: { type: 'year' }, { month: '2026-09' }, …
 *   productId, onProductChange(id) — выбранный продукт ('' — все)
 */
export default function Filters({ data, period, onPeriodChange, productId, onProductChange }) {
    // месяцы и годы — свежие сверху; годы — из списка месяцев ('2026-10' → '2026'), без повторов
    const months = data.months.slice().reverse();   // slice — копия: reverse меняет список на месте
    const years = [];
    for (const month of months) {
        const year = month.slice(0, 4);
        if (!years.includes(year)) {
            years.push(year);
        }
    }

    return (
        <div className="filters">
            {/* период: сначала способ выбора, рядом — поле этого способа */}
            <label>Период
                <select value={period.type} onChange={function (event) { onPeriodChange({ type: event.target.value }); }}>
                    <option value="month">Месяц</option>
                    <option value="year">Год</option>
                    <option value="range">Диапазон дат</option>
                </select>
            </label>

            {period.type === 'month' && (
                <label>Месяц
                    <select value={period.month} onChange={function (event) { onPeriodChange({ month: event.target.value }); }}>
                        {months.map(function (month) {
                            return <option key={month} value={month}>{formatMonth(month)}</option>;
                        })}
                    </select>
                </label>
            )}

            {period.type === 'year' && (
                <label>Год
                    <select value={period.year} onChange={function (event) { onPeriodChange({ year: event.target.value }); }}>
                        {years.map(function (year) {
                            return <option key={year} value={year}>{year}</option>;
                        })}
                    </select>
                </label>
            )}

            {/* диапазон дат «с … по …»: календарь можно листать только в пределах дат, за которые есть случаи */}
            {period.type === 'range' && (
                <div className="range-field">
                    <label>с <input
                        type="date" min={data.minDate} max={data.maxDate} value={period.rangeFrom}
                        onChange={function (event) { onPeriodChange({ rangeFrom: event.target.value }); }}
                    /></label>
                    <label>по <input
                        type="date" min={data.minDate} max={data.maxDate} value={period.rangeTo}
                        onChange={function (event) { onPeriodChange({ rangeTo: event.target.value }); }}
                    /></label>
                </div>
            )}

            <label>Продукт
                <select value={productId} onChange={function (event) { onProductChange(event.target.value); }}>
                    <option value="">Все</option>
                    {data.products.map(function (product) {
                        return <option key={product.id} value={product.id}>{product.name}</option>;
                    })}
                </select>
            </label>
        </div>
    );
}
