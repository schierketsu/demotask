// Donut.jsx — кольцевая диаграмма с легендой: сколько аварий каждой степени.
// Клик по сектору или строке легенды выбирает степень (остальные приглушаются), повторный — снимает выбор.

import { sum } from '../calc.js';
import { accidentsWord, classNames, numberFormat, percentFormat } from '../helpers.js';
import { stepenTooltip, useTooltip } from './Tooltip.jsx';

// Размеры кольца в пикселях
const DONUT_SIZE = 180;                  // ширина и высота рисунка
const DONUT_CENTER = DONUT_SIZE / 2;     // центр кольца (и по x, и по y)
const OUTER_RADIUS = 86;                 // внешний край кольца
const INNER_RADIUS = 56;                 // внутренний край — «дырка» в центре
const MIN_ANGLE_FOR_LETTER = 0.35;       // буква на секторе — только если он не уже ~20° (угол в радианах)

/** Точка на окружности радиуса radius под углом angle (в радианах; 0 — сверху, дальше по часовой): «x,y» */
function pointOnCircle(radius, angle) {
    const x = DONUT_CENTER + radius * Math.sin(angle);
    const y = DONUT_CENTER - radius * Math.cos(angle);
    return `${x},${y}`;
}

/**
 * Контур сектора кольца от угла startAngle до endAngle — строка для атрибута d у SVG-элемента <path>.
 * Порядок: M — встать на внешний край, A — дуга по внешнему краю, L — линия к внутреннему краю,
 * A — дуга по внутреннему краю обратно, Z — замкнуть контур.
 */
function sectorPath(startAngle, endAngle) {
    // дугу больше половины круга SVG нужно явно пометить как «большую», иначе он нарисует короткую
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    return `M${pointOnCircle(OUTER_RADIUS, startAngle)}`
        + `A${OUTER_RADIUS},${OUTER_RADIUS} 0 ${largeArc} 1 ${pointOnCircle(OUTER_RADIUS, endAngle)}`
        + `L${pointOnCircle(INNER_RADIUS, endAngle)}`
        + `A${INNER_RADIUS},${INNER_RADIUS} 0 ${largeArc} 0 ${pointOnCircle(INNER_RADIUS, startAngle)}`
        + 'Z';
}

/**
 * Секторы кольца: по одному на каждую степень, где есть аварии. Только считает — рисует Donut.
 * Возвращает [{ index, path, isWholeRing, letterX, letterY }]; letterX = null — сектор узкий, буквы нет
 */
function buildSectors(parts, total) {
    const sectors = [];
    let startAngle = 0;   // секторы идут по часовой стрелке, начиная сверху

    for (let i = 0; i < parts.length; i++) {
        if (!parts[i].count) {
            continue;   // у степени нет аварий — сектора нет
        }
        // доля аварий → доля круга (полный круг — 2π радиан)
        const endAngle = startAngle + (parts[i].count / total) * 2 * Math.PI;
        const isWholeRing = parts[i].count === total;

        // буква степени посередине сектора — чтобы степени различались не только цветом
        let letterX = null;
        let letterY = null;
        if (endAngle - startAngle >= MIN_ANGLE_FOR_LETTER) {
            const middleAngle = (startAngle + endAngle) / 2;
            const middleRadius = (OUTER_RADIUS + INNER_RADIUS) / 2;
            letterX = DONUT_CENTER + middleRadius * Math.sin(middleAngle);
            letterY = DONUT_CENTER - middleRadius * Math.cos(middleAngle) + 4;   // +4 — опустить на полвысоты буквы
        }

        sectors.push({
            index: i,
            // если все аварии одной степени — сектор на весь круг. Дугу ровно в 360° SVG не рисует
            // (начало совпадает с концом), поэтому рисуем две половины
            path: isWholeRing ? sectorPath(0, Math.PI) + sectorPath(Math.PI, 2 * Math.PI) : sectorPath(startAngle, endAngle),
            isWholeRing: isWholeRing,
            letterX: letterX,
            letterY: letterY,
        });
        startAngle = endAngle;   // следующий сектор начинается там, где закончился этот
    }
    return sectors;
}

/**
 * Кольцевая диаграмма с легендой справа.
 *   parts — части кольца, по одной на степень:
 *           [{ name: 'Частичная', letter: 'Ч', rangeLabel: '21–50%', count: 10, color: '#fbc22c' }, …]
 *           name — название (для подсказок), letter — буква на секторе (всегда белая), rangeLabel — диапазон,
 *           count — сколько аварий, color — цвет сектора
 *   selectedStepen — выбранная степень (0..3) или null; onToggleStepen(i) — клик по степени
 */
export default function Donut({ parts, selectedStepen, onToggleStepen }) {
    const tooltipProps = useTooltip();
    const total = sum(parts.map(function (part) { return part.count; }));   // всего аварий

    /** Приглушать ли степень i: да, если выбрана какая-то другая степень */
    function isDimmed(i) {
        return selectedStepen !== null && selectedStepen !== i;
    }

    // подпись в центре. Ничего не выбрано — всего аварий: «29» и «аварий».
    // Выбрана степень — сколько аварий этой степени и какая это доля: «10» и «34 %»
    const centerValue = selectedStepen === null ? total : parts[selectedStepen].count;
    const centerShare = total > 0 ? percentFormat.format(centerValue / total) : '';   // аварий нет вообще — долю не посчитать
    const centerCaption = selectedStepen === null ? accidentsWord(total) : centerShare;

    return (
        <div className="donut">
            <svg
                viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} width={DONUT_SIZE} height={DONUT_SIZE}
                role="img" aria-label="Доли аварий по степеням деградации"
            >
                {/* аварий нет — пустое серое кольцо: круг посередине между краями кольца с обводкой толщиной во всё кольцо */}
                {total === 0 && (
                    <circle
                        cx={DONUT_CENTER} cy={DONUT_CENTER} r={(OUTER_RADIUS + INNER_RADIUS) / 2}
                        fill="none" stroke="var(--line)" strokeWidth={OUTER_RADIUS - INNER_RADIUS}
                    />
                )}

                {buildSectors(parts, total).map(function (sector) {
                    const part = parts[sector.index];
                    // наведение — подсказка «Частичная · 21–50%: 10 аварий · 34 %»
                    const tooltip = tooltipProps(function () { return stepenTooltip(part, total); });
                    return (
                        <g key={sector.index}>
                            <path
                                d={sector.path} fill={part.color}
                                className={classNames('slice', sector.isWholeRing && 'full', isDimmed(sector.index) && 'dimmed')}
                                onClick={function () { onToggleStepen(sector.index); }}
                                {...tooltip}
                            />
                            {/* цвет буквы — белый, задан в style.css (.slice-letter) */}
                            {sector.letterX !== null && (
                                <text
                                    x={sector.letterX} y={sector.letterY}
                                    className={classNames('slice-letter', isDimmed(sector.index) && 'dimmed')}
                                >{part.letter}</text>
                            )}
                        </g>
                    );
                })}

                <text x={DONUT_CENTER} y={DONUT_CENTER + 4} className="donut-value">{numberFormat.format(centerValue)}</text>
                <text x={DONUT_CENTER} y={DONUT_CENTER + 24} className="donut-label">{centerCaption}</text>
            </svg>

            {/* легенда справа от кольца: по строке на степень — цвет, сколько аварий и какая это доля */}
            <div className="donut-legend">
                {parts.map(function (part, i) {
                    const share = total > 0 ? percentFormat.format(part.count / total) : '—';   // аварий нет вообще — долю не посчитать
                    // название и диапазон степени в строке не пишем — они во всплывающей подсказке (такой же,
                    // как у сектора кольца) и для экранного диктора
                    return (
                        <button
                            key={i} type="button"
                            className={classNames('legend-row', isDimmed(i) && 'dimmed')}
                            aria-pressed={selectedStepen === i}
                            aria-label={`${part.name}, ${part.rangeLabel}: ${numberFormat.format(part.count)}, ${share}`}
                            onClick={function () { onToggleStepen(i); }}
                            {...tooltipProps(function () { return stepenTooltip(part, total); })}
                        >
                            <span className="color-key" style={{ background: part.color }} />
                            <span className="legend-value">{numberFormat.format(part.count)}</span>
                            <span className="muted legend-percent">{share}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
