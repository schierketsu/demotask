// Tooltip.jsx — всплывающая подсказка возле курсора: одна на всю страницу.
//
// TooltipProvider оборачивает всю страницу (main.jsx) и хранит, что сейчас показать.
// Компонент, которому нужна подсказка, берёт useTooltip() и вешает на элемент обработчики:
//   const tooltipProps = useTooltip();
//   <path {...tooltipProps(() => ({ title: 'Частичная', rows: [{ value: 3, label: 'аварии', color: '#fbc22c' }] }))} />

import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import { accidentsWord, numberFormat, percentFormat } from '../helpers.js';

// Контекст — способ передать значение всем компонентам внутри провайдера без передачи через каждый уровень.
// Здесь передаём функцию setTip: показать подсказку ({ title, rows, note, x, y }) или убрать (null)
const TooltipContext = createContext(null);

/** Обёртка над страницей: хранит подсказку и рисует её поверх всего */
export function TooltipProvider({ children }) {
    const [tip, setTip] = useState(null);   // что показать: { title, rows, note, x, y } или null — ничего

    // при движении мыши меняется только tip — children (сама страница) при этом не перерисовываются
    return (
        <TooltipContext.Provider value={setTip}>
            {children}
            {tip !== null && <TooltipBox tip={tip} />}
        </TooltipContext.Provider>
    );
}

/**
 * Подсказка для элементов: возвращает функцию, которая по getContent() даёт обработчики для элемента.
 * getContent() вызывается при каждом движении мыши и возвращает { title, rows, note }:
 *   rows — строки подсказки: [{ value: 3, label: 'аварии · 10 %', color: '#ff7d2e' }];
 *          value можно не указывать — тогда в строке только цветная метка и подпись
 *   note — пояснение мелким серым текстом внизу (необязательно): «Нажмите, чтобы изменить»
 * tooltipProps.hide() — убрать подсказку сразу (например, когда по нажатию открывается окно)
 */
export function useTooltip() {
    const setTip = useContext(TooltipContext);
    function tooltipProps(getContent) {
        return {
            onPointerMove(event) {
                setTip({ ...getContent(), x: event.clientX, y: event.clientY });
            },
            onPointerLeave() {
                setTip(null);
            },
        };
    }
    tooltipProps.hide = function () {
        setTip(null);
    };
    return tooltipProps;
}

/**
 * Подсказка степени — одна и та же у сектора кольца, строки легенды и названия степени в шапке таблицы:
 * «Частичная · 21–50%» и строка «10 аварий · 34 %».
 *   part — { name, rangeLabel, count, color }; total — всего аварий (0 — долю не посчитать, её не пишем)
 */
export function stepenTooltip(part, total) {
    const share = total > 0 ? ` · ${percentFormat.format(part.count / total)}` : '';
    return {
        title: `${part.name} · ${part.rangeLabel}`,
        rows: [{ value: part.count, label: accidentsWord(part.count) + share, color: part.color }],
    };
}

/** Сама подсказка: правее и ниже курсора, но не вылезая за края окна */
function TooltipBox({ tip }) {
    const box = useRef(null);   // ссылка на элемент на странице — чтобы узнать его размер

    // useLayoutEffect выполняется, когда подсказка уже на странице, но ещё не показана на экране:
    // меряем её и ставим на место — без мигания в старой позиции
    useLayoutEffect(function () {
        const element = box.current;
        // подсказка — popover: showPopover() поднимает её в «верхний слой» браузера, поэтому она видна
        // и над открытым окном сервиса (<dialog> тоже в верхнем слое, и обычный z-index его не перекроет)
        if (!element.matches(':popover-open')) {
            element.showPopover();
        }
        const width = element.offsetWidth;
        const height = element.offsetHeight;

        let left = tip.x + 14;
        if (left > innerWidth - width - 8) {
            left = innerWidth - width - 8;   // упёрлись в правый край
        }
        if (left < 8) {
            left = 8;                        // упёрлись в левый край
        }

        // ниже курсора; если снизу не помещается — над курсором
        const fitsBelow = tip.y + 14 + height <= innerHeight - 8;
        const top = fitsBelow ? tip.y + 14 : tip.y - height - 10;

        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
    });

    return (
        <div className="tooltip" role="tooltip" popover="manual" ref={box}>
            <div className="tooltip-title">{tip.title}</div>
            {tip.rows.map(function (row, i) {
                return (
                    <div className="tooltip-row" key={i}>
                        {/* цветная метка, число (если есть) и подпись */}
                        <span className="tooltip-key" style={{ background: row.color }} />
                        {row.value !== undefined && <span>{numberFormat.format(row.value)}</span>}
                        <span className="tooltip-label">{row.label}</span>
                    </div>
                );
            })}
            {tip.note && <div className="tooltip-note">{tip.note}</div>}
        </div>
    );
}
