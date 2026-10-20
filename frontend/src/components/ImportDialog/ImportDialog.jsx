// ImportDialog.jsx — окно «Импорт из CSV» (кнопка «Импорт» в панели, только роль editor).
//
// Шаги:
//   1. файл — перетащить на широкую пунктирную панель или нажать на неё и выбрать. Формат —
//      как db/seed/degradation_case.csv: service_id, metric_id, bucket_id, case_date;
//   2. проверка на сервере (POST /api/cases/import?dry_run=true, в базу ничего не пишется). Окно показывает:
//      карточку файла — имя, сколько в нём записей и кнопка «Заменить» (другой файл можно и перетащить на неё), —
//      с какой по какую дату записи, строки с ошибками и сами записи
//      по страницам: дата, сервис, метрика, диапазон;
//   3. «Импортировать N записей» — сервер проверяет файл ещё раз и записывает все строки одной транзакцией.
//      Файл с ошибками принять нельзя: исправьте строки и выберите файл снова.
// После записи App загружает данные дашборда заново.
//
// Окно — стандартный <dialog>, как окно сервиса: Esc, клик по затемнению и «Отмена» закрывают его
// (заголовка и крестика нет).

import { useEffect, useRef, useState } from 'react';
import { commitImport, previewImport } from '../../api.js';
import { stepenOf } from '../../calc.js';
import { classNames, numberFormat, recordsWord } from '../../helpers.js';
import { formatDate } from '../../period.js';
import { stepenVar } from '../../theme.js';
import { useCloseOnOutside } from '../Filters/Filters.jsx';   // и стили кнопки со списком — как у «Продукт»
import '../../styles/dialog.scss';   // оболочка окна: шапка, подвал, кнопки — общая с ServiceDialog
import './ImportDialog.scss';        // стили этого компонента

// Файл больше не примет сервер (backend/app/main.py) — проверяем заранее, не отправляя
const MAX_FILE_BYTES = 1024 * 1024;

// Сколько записей на странице: варианты для выбора, первый — по умолчанию
const PAGE_SIZES = [10, 25, 50, 100];

// Иконки 16×16 линиями цвета текста — в стиле иконок кнопок панели (Filters.jsx)
const ICONS = {
    upload: <path d="M8 10.5V2.5M4.5 6 8 2.5 11.5 6M2.5 13.5h11" />,
    file: <path d="M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5zM9.5 1.5V5H13M5.5 8.5h5M5.5 11h5" />,
    calendar: <path d="M3.5 3h9A1.5 1.5 0 0 1 14 4.5v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-8A1.5 1.5 0 0 1 3.5 3zM2 6.5h12M5 1.5v3M11 1.5v3" />,
};

/** Иконка из ICONS по имени; className — для размера и цвета */
function Icon({ name, className }) {
    return (
        <svg
            className={className} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"
            fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        >
            {ICONS[name]}
        </svg>
    );
}

/**
 * Окно импорта.
 *   metrics, buckets — метрики и диапазоны с сервера (data в App): названия метрик и диапазоны для таблицы записей
 *   onImported() — записи добавлены: App загрузит данные заново
 *   onClose() — окно закрылось
 */
export default function ImportDialog({ metrics, buckets, onImported, onClose }) {
    const dialog = useRef(null);
    // шаг: 'choose' — ждём файл, 'checking' — сервер проверяет, 'preview' — показываем, что добавится,
    // 'saving' — записываем, 'done' — записано
    const [step, setStep] = useState('choose');
    const [file, setFile] = useState(null);         // выбранный файл: { name, size, text }
    const [preview, setPreview] = useState(null);   // ответ сервера на проверку (api.js, previewImport)
    // номер проверки: у нового файла записи снова показываются с первой страницы (key у ImportPreview)
    const [checkNumber, setCheckNumber] = useState(0);
    const [added, setAdded] = useState(0);          // сколько записей добавлено
    const [error, setError] = useState('');         // ошибка файла целиком или ответа сервера
    const [isDragOver, setDragOver] = useState(false);

    // окно появилось — показываем поверх страницы; закрылось (в том числе по Esc) — сообщаем App
    useEffect(function () {
        const element = dialog.current;
        if (!element.open) {
            element.showModal();
        }
        element.addEventListener('close', onClose);
        return function () {
            element.removeEventListener('close', onClose);
        };
    }, [onClose]);

    function close() {
        dialog.current.close();
    }

    function closeOnBackdrop(event) {
        if (event.target === dialog.current) {
            close();
        }
    }

    const isBusy = step === 'checking' || step === 'saving';

    /** Выбрали файл (на панели, карточке или в окне выбора): прочитать и отдать серверу на проверку */
    async function chooseFile(chosen) {
        if (chosen === undefined || isBusy) {
            return;   // пока идёт проверка или запись, другой файл не берём — иначе сводка и файл могли бы разойтись
        }
        setError('');
        setPreview(null);
        if (chosen.size > MAX_FILE_BYTES) {
            setFile(null);
            setStep('choose');
            setError('Файл больше 1 МБ — разбейте его на части');
            return;
        }
        const text = await chosen.text();
        setFile({ name: chosen.name, size: chosen.size, text: text });
        setCheckNumber(checkNumber + 1);
        setStep('checking');
        try {
            setPreview(await previewImport(text));
            setStep('preview');
        } catch (checkError) {
            setStep('choose');
            setError(checkError.message);
        }
    }

    /** «Импортировать»: записать все строки файла */
    async function accept() {
        setStep('saving');
        setError('');
        try {
            const result = await commitImport(file.text);
            setAdded(result.added);
            setStep('done');
            onImported();
        } catch (saveError) {
            setStep('preview');
            setError(saveError.message);
        }
    }

    /** Поле выбора файла: выбрали — проверяем; значение сбрасываем, чтобы тот же файл можно было выбрать снова */
    function onFileInput(event) {
        chooseFile(event.target.files[0]);
        event.target.value = '';
    }

    // перетаскивание на панель или карточку файла: подсветка, пока файл над ней; дочерние элементы подсветку не снимают
    const dropHandlers = {
        onDragOver(event) {
            event.preventDefault();   // иначе браузер не даст бросить файл сюда
            setDragOver(true);
        },
        onDragLeave(event) {
            if (!event.currentTarget.contains(event.relatedTarget)) {
                setDragOver(false);
            }
        },
        onDrop(event) {
            event.preventDefault();   // иначе браузер откроет файл вместо страницы
            setDragOver(false);
            chooseFile(event.dataTransfer.files[0]);
        },
    };

    const canAccept = step === 'preview' && preview !== null && preview.errorCount === 0 && preview.total > 0;
    let acceptLabel = 'Импортировать';
    if (step === 'saving') {
        acceptLabel = 'Импортируем…';
    } else if (canAccept) {
        acceptLabel = `Импортировать ${numberFormat.format(preview.total)} ${recordsWord(preview.total)}`;
    }

    return (
        <dialog
            // заголовка на экране нет — название окна только для экранного диктора
            className="dialog import-dialog" ref={dialog} aria-label="Импорт из CSV" onClick={closeOnBackdrop}
            // файл, брошенный мимо панели, браузер не должен открывать вместо страницы
            onDragOver={function (event) { event.preventDefault(); }}
            onDrop={function (event) { event.preventDefault(); }}
        >
            <div className="dialog-body">

                {step === 'done' ? (
                    <p className="import-done" role="status">
                        Добавлено записей: <strong>{numberFormat.format(added)}</strong>. Дашборд обновлён.
                    </p>
                ) : (
                    <>
                        {file === null ? (
                            /* файла ещё нет — широкая пунктирная панель с подсказкой; нажатие открывает выбор файла */
                            <label className={classNames('drop-zone', isDragOver && 'drag-over')} {...dropHandlers}>
                                <input type="file" accept=".csv,text/csv" className="drop-input" onChange={onFileInput} />
                                <Icon name="upload" className="drop-icon" />
                                <span className="drop-text">
                                    <strong>Перетащите CSV-файл сюда</strong>
                                    <span>или нажмите, чтобы выбрать</span>
                                    <span>Формат: service_id, metric_id, bucket_id, case_date</span>
                                </span>
                            </label>
                        ) : (
                            /* файл выбран — карточка: имя, сколько в нём записей (когда сервер его проверил) и «Заменить»;
                               другой файл можно бросить прямо на неё */
                            <div className={classNames('import-file', isDragOver && 'drag-over')} {...dropHandlers}>
                                <span className="import-file-icon"><Icon name="file" /></span>
                                <span className="import-file-text">
                                    <strong>{file.name}</strong>
                                    {/* все строки с данными, и с ошибками тоже — как в «Строк с ошибками: 3 из 4» */}
                                    {preview !== null && (
                                        <small>{numberFormat.format(preview.rowCount)} {recordsWord(preview.rowCount)}</small>
                                    )}
                                </span>
                                <label className={classNames('btn', 'import-replace', isBusy && 'busy')}>
                                    <input
                                        type="file" accept=".csv,text/csv" className="drop-input" disabled={isBusy}
                                        onChange={onFileInput}
                                    />
                                    Заменить
                                </label>
                            </div>
                        )}

                        {step === 'checking' && <p className="muted" role="status">Проверяем файл…</p>}
                        {error !== '' && <p className="error" role="alert">{error}</p>}
                        {preview !== null && step !== 'checking' && (
                            <ImportPreview key={checkNumber} preview={preview} metrics={metrics} buckets={buckets} />
                        )}
                    </>
                )}
            </div>

            <div className="dialog-foot">
                {step === 'done' ? (
                    <>
                        <span className="spacer" />
                        <button type="button" className="btn primary" onClick={close}>Готово</button>
                    </>
                ) : (
                    <>
                        <span className="spacer" />
                        <button type="button" className="btn" onClick={close}>Отмена</button>
                        <button type="button" className="btn primary" disabled={!canAccept} onClick={accept}>
                            {acceptLabel}
                        </button>
                    </>
                )}
            </div>
        </dialog>
    );
}

/**
 * Что добавится: с какой по какую дату записи, ошибки (если есть) и сами записи.
 *   preview — ответ сервера на проверку (api.js, previewImport); metrics, buckets — с сервера (data в App)
 */
function ImportPreview({ preview, metrics, buckets }) {
    // первая и последняя дата записей: строки ГГГГ-ММ-ДД сравниваются как даты
    let firstDate = null;
    let lastDate = null;
    for (const record of preview.records) {
        if (firstDate === null || record.case_date < firstDate) {
            firstDate = record.case_date;
        }
        if (lastDate === null || record.case_date > lastDate) {
            lastDate = record.case_date;
        }
    }

    return (
        <section className="import-preview">
            {preview.total > 0 && (
                <p className="import-period">
                    <Icon name="calendar" />
                    {firstDate === lastDate ? formatDate(firstDate) : `${formatDate(firstDate)} — ${formatDate(lastDate)}`}
                </p>
            )}

            {/* ошибки: файл с ними не примется — сервер пишет либо все строки, либо ни одной */}
            {preview.errorCount > 0 && (
                <div className="import-errors" role="alert">
                    <strong>
                        Строк с ошибками: {numberFormat.format(preview.errorCount)} из {numberFormat.format(preview.rowCount)}.
                        Исправьте их и выберите файл снова — принять файл с ошибками нельзя.
                    </strong>
                    <ul>
                        {preview.errors.map(function (item) {
                            return <li key={item.line}>Строка {item.line}: {item.error}</li>;
                        })}
                    </ul>
                    {preview.errorCount > preview.errors.length && (
                        <span className="muted">…и ещё {numberFormat.format(preview.errorCount - preview.errors.length)}</span>
                    )}
                </div>
            )}

            {preview.total > 0 && <RecordsTable preview={preview} metrics={metrics} buckets={buckets} />}
        </section>
    );
}

/**
 * Записи: строки файла по страницам — дата, сервис (под ним операция), метрика и диапазон. Диапазон — плашка
 * бледного цвета степени, как пустые ячейки таблицы на дашборде (степень — по границам
 * по умолчанию). Только для просмотра: импортируется весь файл.
 *   preview — ответ сервера на проверку: records — строки файла, services — названия их сервисов
 */
function RecordsTable({ preview, metrics, buckets }) {
    const [page, setPage] = useState(0);                   // номер страницы, с нуля
    const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);

    const services = new Map(preview.services.map(function (service) { return [service.service_id, service]; }));
    const metricLabels = new Map(metrics.map(function (metric) { return [metric.id, metric.label]; }));
    const bucketsById = new Map(buckets.map(function (bucket) { return [bucket.id, bucket]; }));

    const total = preview.records.length;
    const pageCount = Math.ceil(total / pageSize);
    const start = page * pageSize;
    const shown = preview.records.slice(start, start + pageSize);

    return (
        <div className="records">
            <div className="import-table-wrap">
                <table className="records-table">
                    <thead>
                        <tr>
                            <th className="date-col">Дата</th>
                            <th className="name-col">Сервис</th>
                            <th className="metric-col">Метрика</th>
                            <th className="range-col">Диапазон</th>
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map(function (record, i) {
                            const service = services.get(record.service_id);
                            const bucket = bucketsById.get(record.bucket_id);
                            return (
                                <tr key={start + i}>
                                    <td className="date-col">{formatDate(record.case_date)}</td>
                                    <td className="name-col">
                                        <strong>{service.service}</strong>
                                        <span className="muted">{service.operation}</span>
                                    </td>
                                    <td className="metric-col">{metricLabels.get(record.metric_id) || `Метрика ${record.metric_id}`}</td>
                                    <td className="range-col">
                                        {bucket !== undefined ? <RangeBadge bucket={bucket} /> : `Диапазон ${record.bucket_id}`}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* записей больше, чем помещается на самую короткую страницу, — страницы и выбор их длины */}
            {total > PAGE_SIZES[0] && (
                <div className="pager">
                    <span className="muted">
                        Показаны {numberFormat.format(start + 1)}–{numberFormat.format(start + shown.length)} из {numberFormat.format(total)}
                    </span>
                    <nav className="pager-nav" aria-label="Страницы записей">
                        <button
                            type="button" className="pager-arrow pager-prev" aria-label="Предыдущая страница"
                            disabled={page === 0} onClick={function () { setPage(page - 1); }}
                        />
                        <div className="pager-pages">
                            {pageNumbers(page, pageCount).map(function (number, i) {
                                if (number === null) {
                                    return <span key={`gap-${i}`} className="pager-gap">…</span>;
                                }
                                return (
                                    <button
                                        key={number} type="button" aria-current={number === page ? 'page' : undefined}
                                        aria-label={`Страница ${number + 1}`}
                                        onClick={function () { setPage(number); }}
                                    >{number + 1}</button>
                                );
                            })}
                        </div>
                        <button
                            type="button" className="pager-arrow pager-next" aria-label="Следующая страница"
                            disabled={page === pageCount - 1} onClick={function () { setPage(page + 1); }}
                        />
                    </nav>
                    <PageSizeSelect
                        value={pageSize}
                        onChange={function (size) {
                            setPageSize(size);
                            setPage(0);   // другая длина страницы — с первой страницы
                        }}
                    />
                </div>
            )}
        </div>
    );
}

/**
 * «по [10 ⌄]» — сколько записей на странице. Кнопка и список — такие же, как выбор продукта в панели фильтров
 * (Filters.jsx, ProductSelect; классы period-title, picker, option — из Filters.scss): по нажатию раскрывается
 * список вариантов, выбранный — жирным. Закрывается так же: нажатием мимо или Esc — Esc при этом закрывает
 * только список, а не всё окно.
 *   value — выбранная длина; onChange(число) — выбрали другую
 */
function PageSizeSelect({ value, onChange }) {
    const [isOpen, setOpen] = useState(false);
    const box = useRef(null);
    useCloseOnOutside(isOpen, setOpen, box);

    function choose(size) {
        onChange(size);
        setOpen(false);
    }

    return (
        <div className="pager-size">
            <span id="page-size-label" className="muted">по</span>
            <div
                className="period-picker-box" ref={box}
                onKeyDown={function (event) {
                    if (event.key === 'Escape' && isOpen) {
                        event.preventDefault();   // иначе браузер закроет и окно импорта (<dialog> закрывается по Esc)
                    }
                }}
            >
                <button
                    type="button" className="period-title page-size-title" aria-haspopup="listbox" aria-expanded={isOpen}
                    aria-labelledby="page-size-label page-size-value"
                    onClick={function () { setOpen(!isOpen); }}
                ><span id="page-size-value">{value}</span></button>

                {isOpen && (
                    <div className="picker page-size-picker">
                        <div className="option-list" role="listbox" aria-label="Записей на странице">
                            {PAGE_SIZES.map(function (size) {
                                return (
                                    <button
                                        key={size} type="button" role="option" className="option"
                                        aria-selected={size === value}
                                        onClick={function () { choose(size); }}
                                    >{size}</button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Номера страниц для переключателя (с нуля), null — многоточие: всегда первая и последняя, рядом с открытой — соседние.
 * Всего не больше семи мест, чтобы переключатель не прыгал: [0, 1, 2, 3, 4, null, 13], [0, null, 5, 6, 7, null, 13]
 */
function pageNumbers(page, pageCount) {
    const all = Array.from({ length: pageCount }, function (_, i) { return i; });
    if (pageCount <= 7) {
        return all;
    }
    if (page < 4) {
        return [...all.slice(0, 5), null, pageCount - 1];
    }
    if (page > pageCount - 5) {
        return [0, null, ...all.slice(pageCount - 5)];
    }
    return [0, null, page - 1, page, page + 1, null, pageCount - 1];
}

/** Диапазон записи «21–30%» — на бледном цвете его степени */
function RangeBadge({ bucket }) {
    const stepen = stepenOf(bucket.pct_to);
    return (
        <span className="range-badge" style={{ background: stepenVar(stepen, 'empty') }}>
            {bucket.pct_from}–{bucket.pct_to}%
        </span>
    );
}
