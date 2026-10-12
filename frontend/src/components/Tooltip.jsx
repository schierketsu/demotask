// Tooltip.jsx — всплывающая подсказка возле курсора: одна на всю страницу.
//
// TooltipProvider оборачивает всю страницу (main.jsx) и хранит, что сейчас показать.
// Компонент, которому нужна подсказка, берёт useTooltip() и вешает на элемент обработчики:
//   const tooltipProps = useTooltip();
//   <path {...tooltipProps(() => ({ title: 'Частичная', rows: [{ value: 3, label: 'аварии', color: '#fbc22c' }] }))} />

import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import { numberFormat } from '../helpers.js';

// Контекст — способ передать значение всем компонентам внутри провайдера без передачи через каждый уровень.
// Здесь передаём функцию setTip: показать подсказку ({ title, rows, x, y }) или убрать (null)
const TooltipContext = createContext(null);

/** Обёртка над страницей: хранит подсказку и рисует её поверх всего */
export function TooltipProvider({ children }) {
    const [tip, setTip] = useState(null);   // что показать: { title, rows, x, y } или null — ничего

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
 * getContent() вызывается при каждом движении мыши и возвращает { title, rows }:
 *   rows — строки подсказки: [{ value: 3, label: 'аварии · 10 %', color: '#ff7d2e' }]
 */
export function useTooltip() {
    const setTip = useContext(TooltipContext);
    return function tooltipProps(getContent) {
        return {
            onPointerMove(event) {
                setTip({ ...getContent(), x: event.clientX, y: event.clientY });
            },
            onPointerLeave() {
                setTip(null);
            },
        };
    };
}

/** Сама подсказка: правее и ниже курсора, но не вылезая за края окна */
function TooltipBox({ tip }) {
    const box = useRef(null);   // ссылка на элемент на странице — чтобы узнать его размер

    // useLayoutEffect выполняется, когда подсказка уже на странице, но ещё не показана на экране:
    // меряем её и ставим на место — без мигания в старой позиции
    useLayoutEffect(function () {
        const element = box.current;
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
        <div className="tooltip" role="tooltip" ref={box}>
            <div className="tooltip-title">{tip.title}</div>
            {tip.rows.map(function (row, i) {
                return (
                    <div className="tooltip-row" key={i}>
                        {/* цветная метка, число и подпись */}
                        <span className="tooltip-key" style={{ background: row.color }} />
                        <span>{numberFormat.format(row.value)}</span>
                        <span className="tooltip-label">{row.label}</span>
                    </div>
                );
            })}
        </div>
    );
}
