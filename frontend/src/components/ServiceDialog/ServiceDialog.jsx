// ServiceDialog.jsx — окно сервиса: у отдельного сервиса можно задать свои границы степеней
// вместо общих (по умолчанию у всех: минимальная до 20%, частичная до 50%, значительная до 80%).
//
// Из чего состоит окно, сверху вниз:
//   заголовок — название сервиса и крестик;
//   «Распределение инцидентов» — по оси на каждую метрику: бледные цветные зоны степеней и кружки посередине
//                    диапазонов, где есть аварии (в кружке — сколько их, цвет — степень при границах из окна);
//   «Границы деградации» — шкала-ползунок: цветные отрезки степеней и ручки на границах между ними. Ручку можно
//                    тянуть мышью (или стрелками клавиатуры), над ней — плашка с числом и стрелками ⌃⌄ (шаг 10%).
//                    Ниже — карточки степеней: тумблер включает и отключает степень (её проценты забирает соседняя),
//                    под ним — диапазон степени; у последней включённой — замок: она всегда до 100%.
//                    Как именно двигаются границы — в bounds.js;
//   подвал — «Вернуть по умолчанию», «Отмена», «Сохранить».
//
// Как это работает:
//   нажали на чип сервиса в таблице → App открывает это окно
//   включаем и отключаем степени, двигаем границы → в окне сразу видно, к какой степени отнесутся аварии сервиса
//   «Сохранить» → onSave(границы) → App запоминает их в serviceBounds → страница перерисовывается,
//                 у чипа сервиса появляется чёрная обводка; если границы по умолчанию — свои границы убираются
//
// Всё это — только на странице: на сервер ничего не уходит, после перезагрузки страницы границы сбрасываются.
//
// Окно — стандартный элемент <dialog>: браузер сам затемняет страницу под ним,
// держит фокус внутри окна и закрывает его по Esc.

import { Fragment, useEffect, useRef, useState } from 'react';
import lockIcon from '@admiral-ds/icons/build/security/LockOutline.svg';
import { STEPEN_BOUNDS, STEPEN_COLORS, STEPEN_NAMES } from '../../config.js';
import { getStepenRanges, stepenOf } from '../../calc.js';
import { BOUND_STEP, enabledStepens, sameBounds, setBound, toggleStepen } from '../../bounds.js';
import { accidentsWord, classNames } from '../../helpers.js';
import { stepenVar } from '../../theme.js';
import Icon from '../Icon/Icon.jsx';
import { useTooltip } from '../Tooltip/Tooltip.jsx';
import '../../styles/dialog.scss';   // оболочка окна: шапка, подвал, кнопки — общая с ImportDialog
import './ServiceDialog.scss';   // стили этого компонента

// Подписи процентов под шкалами — каждые 20%: 0, 20, 40, 60, 80, 100 (белые отсечки на шкалах — каждые BOUND_STEP)
const AXIS_STEP = 20;

/** Числа от from до to с шагом step: steps(10, 90, 10) → [10, 20, …, 90] */
function steps(from, to, step) {
    const result = [];
    for (let value = from; value <= to; value += step) {
        result.push(value);
    }
    return result;
}

/** Диапазон степени для карточки: { from: 21, to: 50 } → «21 – 50%» */
function rangeText(range) {
    return `${range.from} – ${range.to}%`;
}

/**
 * Окно границ сервиса.
 *   service — строка сервиса из data.rows: название, аварии по диапазонам (counts)
 *   metrics, buckets — метрики и диапазоны с сервера
 *   savedBounds — границы, которые у сервиса сохранены сейчас (свои или по умолчанию)
 *   onSave(bounds) — нажали «Сохранить»: массив [30, 60, 90] — свои границы, null — границы по умолчанию
 *   onClose() — окно закрылось (крестик, «Отмена», Esc, клик по затемнению или после «Сохранить»)
 */
export default function ServiceDialog({ service, metrics, buckets, savedBounds, onSave, onClose }) {
    const dialog = useRef(null);   // ссылка на <dialog> на странице
    // границы, выставленные в окне, — ещё не сохранены: например [20, 50, 80].
    // Начинаем с тех, что у сервиса сейчас
    const [draft, setDraft] = useState(savedBounds);

    // окно появилось на странице — показываем его поверх всего; закрылось (в том числе по Esc) — сообщаем App.
    // useEffect выполняется после того, как React вставил окно в страницу
    useEffect(function () {
        const element = dialog.current;
        if (!element.open) {
            element.showModal();
        }
        element.addEventListener('close', onClose);
        return function () {
            element.removeEventListener('close', onClose);   // окно убрали со страницы — обработчик больше не нужен
        };
    }, [onClose]);

    function close() {
        dialog.current.close();   // браузер закроет окно и пошлёт событие close → onClose
    }

    // Клик по затемнению вокруг окна закрывает окно. Клик внутри окна попадает во внутренние блоки,
    // а по затемнению — в сам <dialog>, поэтому их можно различить
    function closeOnBackdrop(event) {
        if (event.target === dialog.current) {
            close();
        }
    }

    function save() {
        // границы по умолчанию — значит, своих границ у сервиса нет
        onSave(sameBounds(draft, STEPEN_BOUNDS) ? null : draft);
        close();
    }

    const ranges = getStepenRanges(draft);                 // диапазоны степеней при границах из окна
    const hasChanges = !sameBounds(draft, savedBounds);    // границы в окне отличаются от сохранённых

    return (
        <dialog className="dialog" ref={dialog} aria-labelledby="service-dialog-title" onClick={closeOnBackdrop}>
            <div className="dialog-body">
                {/* заголовок: название сервиса и крестик */}
                <div className="dialog-head">
                    <h2 id="service-dialog-title" className="dialog-title">{service.service}</h2>
                    <button type="button" className="dialog-close" aria-label="Закрыть" onClick={close} />
                </div>

                <section className="dialog-panel">
                    <h3 className="panel-title">Распределение инцидентов</h3>
                    <CaseTracks service={service} metrics={metrics} buckets={buckets} draft={draft} ranges={ranges} />
                </section>

                <section className="dialog-panel">
                    <h3 className="panel-title">Границы деградации</h3>
                    <BoundsSlider draft={draft} ranges={ranges} onChange={setDraft} />
                    <StepenCards draft={draft} ranges={ranges} onChange={setDraft} />
                </section>
            </div>

            {/* подвал: «Вернуть по умолчанию» — только если границы не по умолчанию (сохранятся они только
                по «Сохранить»); «Сохранить» — только если границы в окне отличаются от сохранённых */}
            <div className="dialog-foot">
                <button
                    type="button" className="btn" disabled={sameBounds(draft, STEPEN_BOUNDS)}
                    onClick={function () { setDraft(STEPEN_BOUNDS); }}
                >Вернуть по умолчанию</button>
                <span className="spacer" />
                <button type="button" className="btn" onClick={close}>Отмена</button>
                <button type="button" className="btn primary" disabled={!hasChanges} onClick={save}>Сохранить</button>
            </div>
        </dialog>
    );
}

/**
 * «Распределение инцидентов»: по оси на каждую метрику — слева название метрики, справа бледные цветные зоны
 * степеней (сразу видно, где кончается одна степень и начинается другая), на них кружки посередине диапазонов,
 * где есть аварии (в кружке — сколько их, цвет — степень диапазона при границах из окна; число всегда белое).
 * У нижнего края зон — короткие белые отсечки каждые 10%, под осями — подписи 0%, 20%, … 100%.
 */
function CaseTracks({ service, metrics, buckets, draft, ranges }) {
    const tooltipProps = useTooltip();

    return (
        <div className="case-tracks">
            {metrics.map(function (metric) {
                const bucketCounts = service.counts[metric.id];   // сколько аварий в каждом диапазоне: [5, 0, 5, 1, …]
                return (
                    <Fragment key={metric.id}>
                        <div className="case-label">{metric.label}</div>
                        <div className="case-track">
                            {/* зоны степеней — первыми, чтобы отсечки и кружки легли поверх них;
                                у отключённой степени ширина 0 — её не видно */}
                            {ranges.map(function (range, i) {
                                return (
                                    <span
                                        key={`zone-${i}`} className="case-zone"
                                        style={{
                                            background: stepenVar(i, 'empty'),   // бледный цвет степени, как у пустой ячейки таблицы
                                            left: `${range.start}%`,
                                            width: `${range.end - range.start}%`,
                                        }}
                                    />
                                );
                            })}
                            {/* у 0% и 100% отсечек нет: там край зоны, белая отсечка слилась бы с белым окном */}
                            {steps(BOUND_STEP, 100 - BOUND_STEP, BOUND_STEP).map(function (value) {
                                return <span key={`tick-${value}`} className="scale-tick" style={{ left: `${value}%` }} />;
                            })}
                            {buckets.map(function (bucket, i) {
                                const count = bucketCounts[i];
                                if (count === 0) {
                                    return null;   // в диапазоне аварий нет — кружка нет
                                }
                                const stepen = stepenOf(bucket.pct_to, draft);
                                const color = STEPEN_COLORS[stepen].color;
                                // середина диапазона на оси: 0–10% → 5%, 21–30% → 25%
                                return (
                                    <span
                                        key={`bubble-${bucket.id}`} className="case-bubble"
                                        style={{ left: `${bucket.pct_to - BOUND_STEP / 2}%`, background: color }}
                                        {...tooltipProps(function () {
                                            const label = `${accidentsWord(count)} · ${STEPEN_NAMES[stepen].toLowerCase()}`;
                                            return { title: `Диапазон ${bucket.label}`, rows: [{ value: count, label: label, color: color }] };
                                        })}
                                    >{count}</span>
                                );
                            })}
                        </div>
                    </Fragment>
                );
            })}

            {/* подписи под осями (слева пустая ячейка — под названиями метрик) */}
            <div />
            <ScaleAxis />
        </div>
    );
}

/** Подписи шкалы 0%, 20%, … 100% с короткими серыми отсечками над ними */
function ScaleAxis() {
    return (
        <div className="scale-axis">
            {steps(0, 100, AXIS_STEP).map(function (value) {
                return <span key={value} style={{ left: `${value}%` }}>{value}%</span>;
            })}
        </div>
    );
}

/**
 * Как поставить плашки над ручками, чтобы соседние не налезали друг на друга: [40, 50, 80] → ['end', 'start', 'center'].
 * Обычно плашка по центру над ручкой ('center'). Если соседняя ручка всего в шаге — плашки расходятся:
 * левая встаёт левее своей ручки ('end'), правая — правее ('start')
 */
function chipAlignments(values) {
    return values.map(function (value, j) {
        const closeToLeft = j > 0 && value - values[j - 1] <= BOUND_STEP;
        const closeToRight = j < values.length - 1 && values[j + 1] - value <= BOUND_STEP;
        if (closeToLeft && !closeToRight) {
            return 'start';
        }
        if (closeToRight && !closeToLeft) {
            return 'end';
        }
        return 'center';
    });
}

/**
 * Шкала-ползунок «Границы деградации»: цветные отрезки включённых степеней, на границах между ними — ручки.
 * Ручку тянут мышью (или пальцем); нажатие на шкалу мимо ручки переносит туда ближайшую ручку.
 * С клавиатуры: Tab — на ручку, стрелки — на шаг 10%. Над каждой ручкой — плашка с числом и стрелками ⌃⌄,
 * от плашки к ручке — линия цвета степени, которая на этой границе кончается.
 *   draft — границы из окна, ranges — диапазоны степеней при них,
 *   onChange — setDraft окна: принимает новые границы или функцию «прежние границы → новые»
 */
function BoundsSlider({ draft, ranges, onChange }) {
    const bar = useRef(null);        // шкала на странице — чтобы перевести положение мыши в проценты
    const dragging = useRef(null);   // какую степень сейчас тянут (номер), null — ничего не тянут

    // ручки — на конце каждой включённой степени, кроме последней (она всегда до 100%)
    const enabled = enabledStepens(draft);
    const handles = enabled.slice(0, -1).map(function (stepen) {
        return { stepen: stepen, value: draft[stepen], color: STEPEN_COLORS[stepen].color };
    });
    const alignments = chipAlignments(handles.map(function (handle) { return handle.value; }));

    /**
     * Поставить границу степени stepen на value процентов (bounds.js округлит до шага и подвинет соседей).
     * В onChange — не готовые границы, а функция от прежних: при быстрых движениях мыши React может применить
     * несколько изменений подряд, и каждое должно считаться от предыдущего, а не от уже устаревшего draft.
     * Если границы не изменились — возвращаем прежние: тогда React даже не перерисовывает окно
     */
    function moveBound(stepen, value) {
        onChange(function (previous) {
            const next = setBound(previous, stepen, value);
            return sameBounds(next, previous) ? previous : next;
        });
    }

    /** Сколько процентов шкалы под курсором: левый край — 0, правый — 100 */
    function percentAt(clientX) {
        const rect = bar.current.getBoundingClientRect();
        return ((clientX - rect.left) / rect.width) * 100;
    }

    function startDrag(event) {
        if (handles.length === 0) {
            return;   // включена одна степень — двигать нечего
        }
        // какую ручку тянуть: ту, на которую нажали, иначе ближайшую к месту нажатия
        const value = percentAt(event.clientX);
        let nearest = handles[0];
        for (const handle of handles) {
            if (Math.abs(handle.value - value) < Math.abs(nearest.value - value)) {
                nearest = handle;
            }
        }
        const pressed = event.target.dataset.stepen;   // у ручки есть data-stepen
        dragging.current = pressed !== undefined ? Number(pressed) : nearest.stepen;
        // захват: все следующие движения мыши достаются шкале, даже если курсор ушёл за её край
        event.currentTarget.setPointerCapture(event.pointerId);
        if (pressed === undefined) {
            moveBound(dragging.current, value);
        }
    }

    function drag(event) {
        if (dragging.current !== null) {
            moveBound(dragging.current, percentAt(event.clientX));
        }
    }

    function stopDrag() {
        dragging.current = null;
    }

    return (
        <div className="slider">
            {/* плашки над ручками */}
            <div className="slider-chips">
                {handles.map(function (handle, j) {
                    return (
                        <BoundChip
                            key={handle.stepen} stepen={handle.stepen} value={handle.value} align={alignments[j]}
                            onCommit={function (value) { moveBound(handle.stepen, value); }}
                        />
                    );
                })}
            </div>

            <div
                className="slider-bar" ref={bar}
                onPointerDown={startDrag} onPointerMove={drag} onPointerUp={stopDrag} onPointerCancel={stopDrag}
            >
                {/* цветные отрезки степеней и белые отсечки каждые 10% — внутри дорожки со скруглёнными краями */}
                <div className="slider-track">
                    {ranges.map(function (range, i) {
                        return (
                            <span
                                key={i} className="slider-zone"
                                style={{
                                    left: `${range.start}%`,
                                    width: `${range.end - range.start}%`,
                                    // цвет степени, наполовину разбавленный фоном окна (в светлой теме — белым) —
                                    // ярче зон над ним, но не кричащий
                                    background: `color-mix(in srgb, ${STEPEN_COLORS[i].color} 50%, var(--bg))`,
                                }}
                            />
                        );
                    })}
                    {steps(BOUND_STEP, 100 - BOUND_STEP, BOUND_STEP).map(function (value) {
                        return <span key={value} className="scale-tick" style={{ left: `${value}%` }} />;
                    })}
                </div>

                {/* линии от плашек и ручки — поверх дорожки; ручка — кружок цвета степени в белом ободке */}
                {handles.map(function (handle) {
                    return (
                        <Fragment key={handle.stepen}>
                            <span className="slider-line" style={{ left: `${handle.value}%`, background: handle.color }} />
                            <span
                                className="slider-handle" data-stepen={handle.stepen}
                                style={{ left: `${handle.value}%`, '--handle-color': handle.color }}
                                role="slider" tabIndex={0}
                                aria-label={`${STEPEN_NAMES[handle.stepen]}: до скольких процентов`}
                                aria-valuemin={0} aria-valuemax={100} aria-valuenow={handle.value} aria-valuetext={`${handle.value}%`}
                                onKeyDown={function (event) {
                                    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                                        moveBound(handle.stepen, handle.value - BOUND_STEP);
                                        event.preventDefault();   // стрелка не должна прокручивать окно
                                    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                                        moveBound(handle.stepen, handle.value + BOUND_STEP);
                                        event.preventDefault();
                                    }
                                }}
                            />
                        </Fragment>
                    );
                })}
            </div>

            <ScaleAxis />
        </div>
    );
}

/**
 * Плашка над ручкой: граница степени stepen числом и стрелки ⌃⌄ на шаг 10%.
 *   value — граница сейчас; align — как стоять над ручкой (см. chipAlignments); onCommit(число) — новое значение
 * Число применяется, когда его ввели целиком (Enter или ушли из поля), а не на каждой цифре:
 * пока печатают, введённое хранится в text
 */
function BoundChip({ stepen, value, align, onCommit }) {
    const [text, setText] = useState(String(value));

    // граница поменялась (ручкой, стрелкой, тумблером) — показываем новое число
    useEffect(function () {
        setText(String(value));
    }, [value]);

    function commit() {
        onCommit(Number(text));
        // если граница от этого не изменилась (ввели 37 — округлилось до тех же 40, или ввели не число),
        // эффект выше не сработает — возвращаем в поле текущее число сами
        setText(String(value));
    }

    return (
        <div className={`slider-chip ${align}`} style={{ left: `${value}%` }}>
            <input
                type="number" step={BOUND_STEP} min={0} max={100}
                aria-label={`${STEPEN_NAMES[stepen]}: до скольких процентов, %`}
                value={text}
                onChange={function (event) { setText(event.target.value); }}
                onBlur={commit}
                onKeyDown={function (event) {
                    if (event.key === 'Enter') {
                        commit();
                    }
                }}
            />
            <span className="chip-unit">%</span>
            {/* свои стрелки ⌃⌄ вместо стандартных: на шаг 10% вверх или вниз */}
            <span className="chip-arrows">
                <button type="button" className="chip-up" aria-label="Больше на 10%" onClick={function () { onCommit(value + BOUND_STEP); }} />
                <button type="button" className="chip-down" aria-label="Меньше на 10%" onClick={function () { onCommit(value - BOUND_STEP); }} />
            </span>
        </div>
    );
}

/**
 * Карточки степеней: цветная точка степени, тумблер (включить или отключить степень), под ними — диапазон степени
 * («21 – 50%» или «отключена»). У последней включённой степени — замок: она всегда до 100%.
 * Последнюю оставшуюся степень отключить нельзя: её тумблер помечен aria-disabled, а не disabled —
 * заблокированная кнопка не получает событий мыши, и подсказка «отключить нельзя» не появилась бы.
 *   draft — границы из окна, ranges — диапазоны степеней при них,
 *   onChange — setDraft окна: принимает новые границы или функцию «прежние границы → новые»
 */
function StepenCards({ draft, ranges, onChange }) {
    const tooltipProps = useTooltip();
    const enabled = enabledStepens(draft);
    const lastEnabled = enabled[enabled.length - 1];

    return (
        <div className="stepen-cards">
            {ranges.map(function (range, i) {
                const isOn = !range.unused;
                const isOnlyOne = isOn && enabled.length === 1;
                let note = isOn ? 'Нажмите, чтобы отключить степень' : 'Нажмите, чтобы включить степень';
                if (isOnlyOne) {
                    note = 'Последнюю степень отключить нельзя';
                }

                return (
                    <div key={i} className={classNames('stepen-card', !isOn && 'off')}>
                        {/* названия степени в карточке нет — только её цветная точка; название — в подсказке
                            на тумблере и для экранного диктора (aria-label) */}
                        <div className="stepen-card-head">
                            <span className="stepen-dot" style={{ background: STEPEN_COLORS[i].color }} />
                            <button
                                type="button" className="switch" role="switch"
                                aria-checked={isOn} aria-disabled={isOnlyOne} aria-label={STEPEN_NAMES[i]}
                                onClick={function () {
                                    tooltipProps.hide();   // подсказка про прежнее состояние степени больше не верна
                                    // функция от прежних границ (как в moveBound); для последней степени они не изменятся
                                    onChange(function (previous) { return toggleStepen(previous, i); });
                                }}
                                {...tooltipProps(function () {
                                    return { title: `${STEPEN_NAMES[i]} · ${isOn ? rangeText(range) : 'отключена'}`, rows: [], note: note };
                                })}
                            />
                        </div>
                        <div className="stepen-card-range">
                            {isOn ? rangeText(range) : 'отключена'}
                            {i === lastEnabled && (
                                <LockIcon {...tooltipProps(function () {
                                    return {
                                        title: `${STEPEN_NAMES[i]} · всегда до 100%`,
                                        rows: [],
                                        note: 'Последняя включённая степень действует до конца шкалы',
                                    };
                                })} />
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/** Значок замка (иконка Admiral); props — обработчики подсказки */
function LockIcon(props) {
    return <Icon src={lockIcon} size={18} label="Всегда до 100%" className="lock-icon" {...props} />;
}
