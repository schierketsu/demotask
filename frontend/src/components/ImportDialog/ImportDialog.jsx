// ImportDialog.jsx — окно «Импорт из CSV» (кнопка «Импорт» в панели, только роль editor).
//
// Шаги:
//   1. файл — перетащить на широкую пунктирную панель или нажать на неё и выбрать. Формат —
//      как db/seed/degradation_case.csv: service_id, metric_id, bucket_id, case_date;
//   2. проверка на сервере (POST /api/cases/import?dry_run=true, в базу ничего не пишется): сколько записей
//      добавится в какой сервис в каком месяце — таблица «сервис × месяц»; строки с ошибками — списком;
//   3. «Принять изменения» — сервер проверяет файл ещё раз и записывает все строки одной транзакцией.
//      Файл с ошибками принять нельзя: исправьте строки и выберите файл снова.
// После записи App загружает данные дашборда заново.
//
// Окно — стандартный <dialog>, как окно сервиса: Esc, клик по затемнению, крестик и «Отмена» закрывают его.

import { useEffect, useRef, useState } from 'react';
import { commitImport, previewImport } from '../../api.js';
import { MONTH_SHORT_NAMES } from '../../config.js';
import { classNames, numberFormat } from '../../helpers.js';
import '../../styles/dialog.scss';   // оболочка окна: шапка, подвал, кнопки — общая с ServiceDialog
import './ImportDialog.scss';        // стили этого компонента

// Файл больше не примет сервер (backend/app/main.py) — проверяем заранее, не отправляя
const MAX_FILE_BYTES = 1024 * 1024;

/** '2026-10' → { month: 'Окт', year: '2026' } — для шапки таблицы и сводки */
function monthParts(month) {
    return { month: MONTH_SHORT_NAMES[Number(month.slice(5)) - 1], year: month.slice(0, 4) };
}

/** '2026-10' → «окт 2026» */
function monthLabel(month) {
    const parts = monthParts(month);
    return `${parts.month.toLowerCase()} ${parts.year}`;
}

/**
 * Окно импорта.
 *   onImported() — записи добавлены: App загрузит данные заново
 *   onClose() — окно закрылось
 */
export default function ImportDialog({ onImported, onClose }) {
    const dialog = useRef(null);
    // шаг: 'choose' — ждём файл, 'checking' — сервер проверяет, 'preview' — показываем, что добавится,
    // 'saving' — записываем, 'done' — записано
    const [step, setStep] = useState('choose');
    const [file, setFile] = useState(null);         // выбранный файл: { name, size, text }
    const [preview, setPreview] = useState(null);   // ответ сервера на проверку (api.js, previewImport)
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

    /** Выбрали файл (на панели или в окне выбора): прочитать и отдать серверу на проверку */
    async function chooseFile(chosen) {
        if (chosen === undefined) {
            return;
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
        setStep('checking');
        try {
            setPreview(await previewImport(text));
            setStep('preview');
        } catch (checkError) {
            setStep('choose');
            setError(checkError.message);
        }
    }

    /** «Принять изменения»: записать все строки файла */
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

    // перетаскивание на панель: подсветка, пока файл над ней; дочерние элементы панели подсветку не снимают
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

    const isBusy = step === 'checking' || step === 'saving';
    const canAccept = step === 'preview' && preview !== null && preview.errorCount === 0 && preview.total > 0;

    return (
        <dialog
            className="dialog import-dialog" ref={dialog} aria-labelledby="import-dialog-title" onClick={closeOnBackdrop}
            // файл, брошенный мимо панели, браузер не должен открывать вместо страницы
            onDragOver={function (event) { event.preventDefault(); }}
            onDrop={function (event) { event.preventDefault(); }}
        >
            <div className="dialog-body">
                <div className="dialog-head">
                    <h2 id="import-dialog-title" className="dialog-title">Импорт из CSV</h2>
                    <button type="button" className="dialog-close" aria-label="Закрыть" onClick={close} />
                </div>

                {step === 'done' ? (
                    <p className="import-done" role="status">
                        Добавлено записей: <strong>{numberFormat.format(added)}</strong>. Дашборд обновлён.
                    </p>
                ) : (
                    <>
                        {/* панель для файла: пока файла нет — широкая, с подсказкой; потом — узкая, с именем файла */}
                        <label
                            className={classNames('drop-zone', file !== null && 'compact', isDragOver && 'drag-over', isBusy && 'busy')}
                            {...dropHandlers}
                        >
                            <input
                                type="file" accept=".csv,text/csv" className="drop-input" disabled={isBusy}
                                onChange={function (event) {
                                    chooseFile(event.target.files[0]);
                                    event.target.value = '';   // чтобы тот же файл можно было выбрать снова
                                }}
                            />
                            <svg
                                className="drop-icon" viewBox="0 0 16 16" aria-hidden="true"
                                fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
                            >
                                <path d="M8 10.5V2.5M4.5 6 8 2.5 11.5 6M2.5 13.5h11" />
                            </svg>
                            {file === null ? (
                                <span className="drop-text">
                                    <strong>Перетащите CSV-файл сюда</strong>
                                    <span>или нажмите, чтобы выбрать</span>
                                    <span>Формат: service_id, metric_id, bucket_id, case_date</span>
                                </span>
                            ) : (
                                <span className="drop-text">
                                    <strong>{file.name}</strong>
                                    <small>
                                        {Math.max(1, Math.round(file.size / 1024))} КБ · перетащите другой файл
                                        или нажмите, чтобы выбрать
                                    </small>
                                </span>
                            )}
                        </label>

                        {step === 'checking' && <p className="muted" role="status">Проверяем файл…</p>}
                        {error !== '' && <p className="error" role="alert">{error}</p>}
                        {preview !== null && step !== 'checking' && <ImportPreview preview={preview} />}
                    </>
                )}
            </div>

            <div className="dialog-foot">
                <span className="spacer" />
                {step === 'done' ? (
                    <button type="button" className="btn primary" onClick={close}>Готово</button>
                ) : (
                    <>
                        <button type="button" className="btn" onClick={close}>Отмена</button>
                        <button type="button" className="btn primary" disabled={!canAccept} onClick={accept}>
                            {step === 'saving' ? 'Сохраняем…' : 'Принять изменения'}
                        </button>
                    </>
                )}
            </div>
        </dialog>
    );
}

/**
 * Что добавится: сводка одной строкой, ошибки (если есть) и таблица «сервис × месяц» — сколько записей
 * добавится в каждый сервис в каждом месяце.
 *   preview — ответ сервера на проверку (api.js, previewImport)
 */
function ImportPreview({ preview }) {
    // итоги по месяцам — для нижней строки таблицы
    const monthTotals = preview.months.map(function (month, i) {
        let total = 0;
        for (const service of preview.services) {
            total = total + service.counts[i];
        }
        return total;
    });
    const firstMonth = preview.months[0];
    const lastMonth = preview.months[preview.months.length - 1];

    return (
        <section className="import-preview">
            {preview.total > 0 && (
                <p className="import-summary">
                    Записей к добавлению: <strong>{numberFormat.format(preview.total)}</strong>
                    {' · '}сервисов: <strong>{preview.services.length}</strong>
                    {' · '}{firstMonth === lastMonth ? monthLabel(firstMonth) : `${monthLabel(firstMonth)} — ${monthLabel(lastMonth)}`}
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

            {preview.total > 0 && (
                <div className="import-table-wrap">
                    <table className="import-table">
                        <thead>
                            <tr>
                                <th className="service-col">Сервис</th>
                                {preview.months.map(function (month) {
                                    const parts = monthParts(month);
                                    return <th key={month}>{parts.month}<span className="muted">{parts.year}</span></th>;
                                })}
                                <th>Всего</th>
                            </tr>
                        </thead>
                        <tbody>
                            {preview.services.map(function (service) {
                                return (
                                    <tr key={service.service_id}>
                                        <th className="service-col" scope="row">
                                            {service.service}
                                            <span className="muted">{service.product} · {service.operation}</span>
                                        </th>
                                        {/* пустая ячейка — в этот месяц записей для сервиса нет */}
                                        {service.counts.map(function (count, i) {
                                            return <td key={i}>{count > 0 ? numberFormat.format(count) : ''}</td>;
                                        })}
                                        <td className="total">{numberFormat.format(service.total)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr>
                                <th className="service-col" scope="row">Всего</th>
                                {monthTotals.map(function (total, i) {
                                    return <td key={i}>{total > 0 ? numberFormat.format(total) : ''}</td>;
                                })}
                                <td className="total">{numberFormat.format(preview.total)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </section>
    );
}
