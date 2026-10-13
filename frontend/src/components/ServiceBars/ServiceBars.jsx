// ServiceBars.jsx — полосы по сервисам: у каждого сервиса полоса из цветных кусков —
// сколько у него аварий каждой степени.

import { STEPEN_COLORS, STEPEN_NAMES } from '../../config.js';
import { shownCount } from '../../calc.js';
import { numberFormat } from '../../helpers.js';
import { useTooltip } from '../Tooltip/Tooltip.jsx';
import './ServiceBars.scss';   // стили этого компонента

/**
 * Полосы по сервисам.
 *   stats — статистика из buildServiceStats: [{ name: 'Сервис 4', stepenCounts: [5, 6, 1, 0] }]
 *   maxCount — самое большое значение среди всех карточек: от него считается длина полос,
 *         поэтому полосы в разных карточках можно сравнивать
 *   selectedStepen — выбранная степень или null
 * Если степень выбрана — на полосах только она. Сервисы без аварий не показываем, остальные — от большего к меньшему.
 */
export default function ServiceBars({ stats, maxCount, selectedStepen }) {
    const tooltipProps = useTooltip();

    // сколько аварий показываем у каждого сервиса: все, или только выбранной степени
    const visibleServices = [];
    for (const item of stats) {
        const count = shownCount(item.stepenCounts, selectedStepen);
        if (count > 0) {
            visibleServices.push({ name: item.name, stepenCounts: item.stepenCounts, shownCount: count });
        }
    }
    // от большего к меньшему; у сервисов с равным значением сохраняется исходный порядок
    visibleServices.sort(function (a, b) {
        return b.shownCount - a.shownCount;
    });

    if (visibleServices.length === 0) {
        return <p className="empty">Аварий нет</p>;
    }

    return (
        <div className="bars">
            {visibleServices.map(function (service) {
                return (
                    <div className="bars-row" key={service.name}>
                        <div>{service.name}</div>
                        <div className="bar-line">
                            {/* длина полосы — доля от самого большого значения; 3em оставляем под число справа от полосы */}
                            <div className="bar" style={{ width: `calc((100% - 3em) * ${service.shownCount / maxCount})` }}>
                                {/* куски полосы: по одному на степень, длина — по количеству аварий;
                                    у степени нет аварий или выбрана другая степень — куска нет */}
                                {service.stepenCounts.map(function (count, i) {
                                    if (!count || (selectedStepen !== null && selectedStepen !== i)) {
                                        return null;
                                    }
                                    const color = STEPEN_COLORS[i].color;
                                    return (
                                        <span
                                            key={i} style={{ flexGrow: count, background: color }}
                                            {...tooltipProps(function () {
                                                return { title: service.name, rows: [{ value: count, label: STEPEN_NAMES[i].toLowerCase(), color: color }] };
                                            })}
                                        />
                                    );
                                })}
                            </div>
                            <span className="bar-value">{numberFormat.format(service.shownCount)}</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
