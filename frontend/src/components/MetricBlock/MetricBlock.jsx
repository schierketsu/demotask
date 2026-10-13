// MetricBlock.jsx — раскрывающийся блок одной метрики: надпись («Без учета 5 минут») и под ней карточка —
// слева сводка (кольцо, легенда, полосы сервисов), справа таблица.

import { formatRange } from '../../calc.js';
import DetailTable from '../DetailTable/DetailTable.jsx';
import Donut from '../Donut/Donut.jsx';
import ServiceBars from '../ServiceBars/ServiceBars.jsx';
import './MetricBlock.scss';   // стили этого компонента

/**
 * Блок метрики на стандартных <details>/<summary>: браузер сам раскрывает и скрывает карточку по нажатию
 * на надпись (и с клавиатуры). Раскрыт ли блок, хранит App (openMetrics) — иначе при смене периода данные
 * приходят заново, и блоки снова скрывались бы.
 *   metric — метрика ({ id, name, label }); isOpen, onOpenChange(open) — раскрыт ли блок
 *   stats — статистика её сервисов из buildServiceStats; maxCount — общий масштаб полос;
 *   ranges — диапазоны степеней по умолчанию; остальное — для таблицы (см. DetailTable)
 */
export default function MetricBlock({
    metric, isOpen, onOpenChange, stats, maxCount, ranges,
    rows, columns, buckets, serviceBounds, selectedStepen, onToggleStepen, onOpenService,
}) {
    // кольцо: сколько всего аварий каждой степени
    const donutParts = ranges.map(function (range, stepen) {
        let total = 0;
        for (const item of stats) {
            total = total + item.stepenCounts[stepen];
        }
        return { name: range.name, letter: range.letter, rangeLabel: formatRange(range), count: total, color: range.color };
    });

    // заголовок над полосами: «Сервисы» или, если выбрана степень, «Сервисы · частичная деградация»
    const barsTitle = selectedStepen === null ? 'Сервисы' : `Сервисы · ${ranges[selectedStepen].name.toLowerCase()} деградация`;

    return (
        <details
            className="metric-block" open={isOpen}
            onToggle={function (event) { onOpenChange(event.currentTarget.open); }}
        >
            <summary>{metric.label}</summary>

            <section className="card metric-card">
                {/* слева: сводка. Название метрики не здесь, а в надписи над карточкой */}
                <div className="metric-summary">
                    <Donut parts={donutParts} selectedStepen={selectedStepen} onToggleStepen={onToggleStepen} />
                    <h3>{barsTitle}</h3>
                    <ServiceBars stats={stats} maxCount={maxCount} selectedStepen={selectedStepen} />
                </div>

                {/* справа: детализация (таблица) */}
                <div className="metric-detail">
                    <h3 className="detail-title">Детализация</h3>
                    <div className="table-wrap">
                        <DetailTable
                            metric={metric} rows={rows} columns={columns} buckets={buckets} serviceBounds={serviceBounds}
                            selectedStepen={selectedStepen} onToggleStepen={onToggleStepen} onOpenService={onOpenService}
                            isOpen={isOpen}
                        />
                    </div>
                </div>
            </section>
        </details>
    );
}
