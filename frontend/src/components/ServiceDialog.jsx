// ServiceDialog.jsx — окно «Индивидуальные границы деградации»: у отдельного сервиса можно задать свои границы
// степеней вместо общих (по умолчанию у всех: минимальная до 20%, частичная до 50%, значительная до 80%).
//
// Из чего состоит окно, сверху вниз:
//   заголовок — название сервиса;
//   аварии сервиса — по оси на каждую метрику: кружок посередине диапазона, в нём сколько аварий в диапазоне,
//                    цвет — степень при границах из окна; под кружками — бледные цветные зоны степеней;
//   «Границы деградации, %» — четыре колонки степеней. Название степени — кнопка: нажали — степень отключена
//                    (её проценты забирает соседняя), нажали ещё раз — включена снова. Под каждой включённой
//                    степенью — поле «до скольких процентов она действует» со стрелками ▲▼ (шаг 10%); у последней
//                    включённой поля нет — она всегда до 100%. Как именно двигаются границы — в bounds.js;
//   кнопки «Сбросить» (включить все степени и вернуть границы по умолчанию), «Отмена», «Сохранить».
//
// Как это работает:
//   нажали на чип сервиса в таблице → App открывает это окно
//   включаем и отключаем степени, меняем числа → в окне сразу видно, к какой степени отнесутся аварии сервиса
//   «Сохранить» → onSave(границы) → App запоминает их в serviceBounds → страница перерисовывается,
//                 у чипа сервиса появляется чёрная обводка; если в полях границы по умолчанию — свои границы убираются
//
// Всё это — только на странице: на сервер ничего не уходит, после перезагрузки страницы границы сбрасываются.
//
// Окно — стандартный элемент <dialog>: браузер сам затемняет страницу под ним,
// держит фокус внутри окна и закрывает его по Esc.

import { useEffect, useRef, useState } from 'react';
import { STEPEN_BOUNDS, STEPEN_COLORS, STEPEN_NAMES } from '../config.js';
import { formatRange, getStepenRanges, stepenOf } from '../calc.js';
import { BOUND_STEP, enabledStepens, sameBounds, setBound, toggleStepen } from '../bounds.js';
import { classNames } from '../helpers.js';

// Подписи процентов под осями с авариями — каждые 20%: 0, 20, 40, 60, 80, 100 (отсечки — чаще, каждые BOUND_STEP)
const AXIS_STEP = 20;

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
        // в полях границы по умолчанию — значит, своих границ у сервиса нет
        onSave(sameBounds(draft, STEPEN_BOUNDS) ? null : draft);
        close();
    }

    const ranges = getStepenRanges(draft);   // диапазоны степеней при границах из окна

    return (
        <dialog className="dialog" ref={dialog} aria-labelledby="service-dialog-title" onClick={closeOnBackdrop}>
            <div className="dialog-body">
                {/* заголовок: название сервиса, подзаголовок и крестик */}
                <div className="dialog-head">
                    <div>
                        <h2 id="service-dialog-title" className="dialog-title">{service.service}</h2>
                        <p className="muted">Индивидуальные границы деградации</p>
                    </div>
                    <button type="button" className="dialog-close" aria-label="Закрыть" onClick={close} />
                </div>

                <CaseTracks service={service} metrics={metrics} buckets={buckets} draft={draft} ranges={ranges} />

                <h3 className="dialog-section-title">Границы деградации, %</h3>
                <BoundsColumns draft={draft} ranges={ranges} onChange={setDraft} />
            </div>

            {/* кнопки: в подвале окна, под линией на всю ширину.
                «Сбросить» — только если в полях не границы по умолчанию (сохранятся они только по «Сохранить»);
                «Сохранить» — только если границы в окне отличаются от сохранённых */}
            <div className="dialog-foot">
                <button
                    type="button" className="btn" disabled={sameBounds(draft, STEPEN_BOUNDS)}
                    onClick={function () { setDraft(STEPEN_BOUNDS); }}
                >Сбросить</button>
                <span className="spacer" />
                <button type="button" className="btn" onClick={close}>Отмена</button>
                <button type="button" className="btn primary" disabled={sameBounds(draft, savedBounds)} onClick={save}>Сохранить</button>
            </div>
        </dialog>
    );
}

/**
 * Аварии сервиса по осям: слева название метрики, справа ось — бледные цветные зоны степеней (сразу видно, где
 * кончается одна степень и начинается другая), на ней кружки посередине диапазонов, где есть аварии
 * (в кружке — сколько их, цвет — степень диапазона при границах из окна). Под осями — подписи 0%, 20%, … 100%;
 * у нижнего края фона — короткие белые отсечки каждые 10%.
 */
function CaseTracks({ service, metrics, buckets, draft, ranges }) {
    // короткие белые отсечки — каждые 10%: 10, 20, … 90 (подписи под осью — только у 20, 40, …).
    // У 0% и 100% не рисуем: там край фона, белая отсечка слилась бы с белым окном
    const ticks = [];
    for (let value = BOUND_STEP; value < 100; value += BOUND_STEP) {
        ticks.push(value);
    }
    const axisLabels = [];
    for (let value = 0; value <= 100; value += AXIS_STEP) {
        axisLabels.push(value);
    }

    return (
        <div className="case-tracks">
            {metrics.map(function (metric) {
                const bucketCounts = service.counts[metric.id];   // сколько аварий в каждом диапазоне: [5, 0, 5, 1, …]
                return [
                    <div key={`${metric.id}-label`}>{metric.label}</div>,
                    <div key={`${metric.id}-track`} className="case-track">
                        {/* зоны степеней — первыми, чтобы отсечки и кружки легли поверх них;
                            у отключённой степени ширина 0 — её не видно */}
                        {ranges.map(function (range, i) {
                            return (
                                <span
                                    key={`zone-${i}`} className="case-zone"
                                    style={{
                                        background: STEPEN_COLORS[i].emptyCellBackground,   // цвет степени с прозрачностью 16 %
                                        left: `${range.start}%`,
                                        width: `${range.end - range.start}%`,
                                    }}
                                />
                            );
                        })}
                        {ticks.map(function (value) {
                            return <span key={`tick-${value}`} className="case-tick" style={{ left: `${value}%` }} />;
                        })}
                        {buckets.map(function (bucket, i) {
                            if (bucketCounts[i] === 0) {
                                return null;   // в диапазоне аварий нет — кружка нет
                            }
                            // середина диапазона на оси: 0–10% → 5%, 21–30% → 25%;
                            // число в кружке всегда белое (style.css, .case-bubble)
                            return (
                                <span
                                    key={`bubble-${bucket.id}`} className="case-bubble" title={`${bucket.label} — ${bucketCounts[i]}`}
                                    style={{
                                        left: `${bucket.pct_to - BOUND_STEP / 2}%`,
                                        background: STEPEN_COLORS[stepenOf(bucket.pct_to, draft)].color,
                                    }}
                                >{bucketCounts[i]}</span>
                            );
                        })}
                    </div>,
                ];
            })}

            {/* подписи под осями: 0%, 20%, … 100% (слева пустая ячейка — под названиями метрик) */}
            <div />
            <div className="case-axis small muted">
                {axisLabels.map(function (value) {
                    return <span key={value} style={{ left: `${value}%` }}>{value}%</span>;
                })}
            </div>
        </div>
    );
}

/**
 * «Границы деградации, %»: четыре колонки. В каждой — кнопка с точкой и названием степени (включить или отключить),
 * диапазон («21–50%» или «отключена») и поле «до … %»: у включённой степени — число со стрелками,
 * у последней включённой — надпись «до 100 %», у отключённой поля не видно (колонка бледнеет).
 * Последнюю оставшуюся степень отключить нельзя.
 *   draft — границы из окна, ranges — диапазоны степеней при них, onChange(новые границы)
 */
function BoundsColumns({ draft, ranges, onChange }) {
    const enabled = enabledStepens(draft);
    const lastEnabled = enabled[enabled.length - 1];

    return (
        <div className="bounds-columns">
            {ranges.map(function (range, i) {
                const isOn = !range.unused;
                const isOnlyOne = isOn && enabled.length === 1;
                let title = isOn ? 'Отключить степень' : 'Включить степень';
                if (isOnlyOne) {
                    title = 'Последнюю степень отключить нельзя';
                }
                // у полной поля нет никогда: включённая полная всегда последняя,
                // а где она начинается, задаёт поле степени перед ней
                const hasField = i !== lastEnabled && i < 3;

                return (
                    <div key={i} className={classNames('bounds-column', !isOn && 'off')}>
                        {/* название степени — кнопка-переключатель: aria-pressed="true" — включена */}
                        <button
                            type="button" className="bounds-toggle" aria-pressed={isOn} disabled={isOnlyOne} title={title}
                            onClick={function () { onChange(toggleStepen(draft, i)); }}
                        >
                            <span className="stepen-dot" style={{ background: STEPEN_COLORS[i].color }} />
                            {STEPEN_NAMES[i]}
                        </button>
                        <div className="muted">{isOn ? formatRange(range) : 'отключена'}</div>
                        <div className="bounds-field">
                            <span className="muted">до</span>
                            {hasField
                                ? <BoundStepper stepen={i} value={draft[i]} onCommit={function (value) { onChange(setBound(draft, i, value)); }} />
                                : <span className="bounds-fixed">100</span>}
                            <span className="muted">%</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * Поле степени stepen — до скольких процентов она действует — со своими стрелками ▲▼ на шаг 10%.
 *   value — граница сейчас; onCommit(число) — ввели новое число или нажали стрелку
 * Число применяется, когда его ввели целиком (Enter или ушли из поля), а не на каждой цифре:
 * пока печатают, введённое хранится в text
 */
function BoundStepper({ stepen, value, onCommit }) {
    const [text, setText] = useState(String(value));

    // граница поменялась (стрелкой, соседним полем, кнопкой степени) — показываем новое число
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
        <div className="stepper">
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
            {/* свои стрелки ▲▼ вместо стандартных: на шаг 10% вверх или вниз */}
            <div className="stepper-arrows">
                <button type="button" className="stepper-up" aria-label="Больше на 10%" onClick={function () { onCommit(value + BOUND_STEP); }} />
                <button type="button" className="stepper-down" aria-label="Меньше на 10%" onClick={function () { onCommit(value - BOUND_STEP); }} />
            </div>
        </div>
    );
}
