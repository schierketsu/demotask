// App.jsx — вся страница: её состояние, загрузка данных и сборка из частей (components/).
//
// Как это работает:
//   при открытии страницы загружаем данные за последний месяц → они в состоянии data → React рисует страницу
//   пользователь выбирает продукт или степень → состояние меняется → React перерисовывает то, что изменилось
//   пользователь выбирает период (месяц, год или диапазон дат) → превращаем его в две даты «с … по …» (period.js),
//     загружаем данные за этот период → data заменяется → страница обновилась
//   пользователь нажимает на чип сервиса → окно сервиса (ServiceDialog) → сохранил границы → serviceBounds меняется
//   пользователь нажимает «Экспорт» → файл Excel за этот период и продукт (excel.js) скачивается
//   editor нажимает «Импорт» → окно ImportDialog: CSV → проверка → «Принять изменения» → данные загружаются заново
//
// App рисуется только после входа (main.jsx): кто вошёл и есть ли у него роль editor — currentUser() из auth.js.

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadData } from './api.js';
import { currentUser } from './auth.js';
import { buildServiceStats, buildTableColumns, getStepenRanges, maxShownCount, rowsOfProduct, boundsOf } from './calc.js';
import { initialPeriod, periodDates, periodLabel } from './period.js';
import { exportToExcel } from './excel.js';
import Filters from './components/Filters/Filters.jsx';
import ImportDialog from './components/ImportDialog/ImportDialog.jsx';
import MetricBlock from './components/MetricBlock/MetricBlock.jsx';
import ServiceDialog from './components/ServiceDialog/ServiceDialog.jsx';
import UserBar from './components/UserBar/UserBar.jsx';

export default function App() {
    const user = currentUser();   // кто вошёл: имя и есть ли роль editor — из токена Keycloak

    // Состояние страницы — всё, что она «помнит». useState возвращает значение и функцию, которая его меняет;
    // после такой замены React сам перерисует страницу
    const [data, setData] = useState(null);                    // данные с сервера (ответ /api/data); null — ещё не пришли
    const [error, setError] = useState('');                    // текст ошибки над страницей; '' — ошибки нет
    const [period, setPeriod] = useState(null);                // выбранный период (period.js); null — до первой загрузки
    const [productId, setProductId] = useState('');            // выбранный продукт; '' — все продукты
    const [selectedStepen, setSelectedStepen] = useState(null); // выбранная степень: 0..3, или null — «все»
    // какие блоки метрик раскрыты: { id метрики: true }. Сразу после загрузки раскрыт первый — «Без учета 5 минут»
    const [openMetrics, setOpenMetrics] = useState({});
    // свои границы степеней у сервисов, заданные в окне сервиса: { id сервиса: [30, 60, 90] };
    // сервиса здесь нет — у него границы по умолчанию. Живут только на странице: на сервер не уходят,
    // при смене периода сохраняются, после перезагрузки страницы сбрасываются
    const [serviceBounds, setServiceBounds] = useState({});
    const [dialogServiceId, setDialogServiceId] = useState(null);   // чьё окно открыто; null — никакое
    const [isExporting, setExporting] = useState(false);            // собирается файл Excel — кнопка Export недоступна
    const [isImportOpen, setImportOpen] = useState(false);          // открыто окно импорта (только editor)

    // период последнего запроса «2026-01-01|2026-03-31» — чтобы не показать устаревший ответ (см. changePeriod).
    // useRef — значение, которое живёт между перерисовками, но его изменение страницу не перерисовывает
    const requestedPeriod = useRef('');

    // Первая загрузка — один раз, когда страница появилась (пустой список [] в конце: ни от чего не зависит)
    useEffect(function () {
        let isCancelled = false;   // страницу успели убрать, пока ждали ответ, — ответ уже не нужен
        async function start() {
            try {
                const first = await loadData('', '');   // период не указываем — сервер отдаст последний месяц
                if (!isCancelled) {
                    requestedPeriod.current = `${first.from}|${first.to}`;
                    setData(first);
                    setPeriod(initialPeriod(first));
                    // по умолчанию раскрыт блок первой метрики — «Без учета 5 минут» (метрики идут по порядку id)
                    setOpenMetrics({ [first.metrics[0].id]: true });
                }
            } catch (loadError) {
                if (!isCancelled) {
                    setError(`Не удалось загрузить данные: ${loadError.message}`);
                }
            }
        }
        start();
        return function () {
            isCancelled = true;
        };
    }, []);

    /**
     * Поменялся период (способ выбора, месяц, год или дата диапазона): загрузить его данные.
     * changes — что поменялось: { type: 'year' }, { month: '2026-09' }, … Выбранные продукт, степень
     * и свои границы сервисов сохраняются
     */
    async function changePeriod(changes) {
        const next = { ...period, ...changes };   // новый период: прежний, в котором заменили то, что поменялось
        setPeriod(next);

        const { from, to } = periodDates(next);
        if (from === '' || to === '') {
            return;   // в диапазоне стёрли дату — ждём, пока введут обе
        }
        if (from > to) {   // строки ГГГГ-ММ-ДД сравниваются как даты
            setError('Начало периода позже его конца');
            return;
        }

        const key = `${from}|${to}`;
        requestedPeriod.current = key;
        let loaded;
        try {
            loaded = await loadData(from, to);
        } catch (loadError) {
            // страница остаётся с данными прошлого периода, сверху — сообщение
            setError(`Не удалось загрузить данные за ${periodLabel(next)}: ${loadError.message}`);
            return;
        }

        // пока ждали ответ, могли успеть выбрать другой период — тогда этот ответ уже не нужен
        if (requestedPeriod.current !== key) {
            return;
        }
        setData(loaded);
        setError('');
    }

    /**
     * Нажали «Экспорт»: файл Excel за загруженный период и выбранный продукт — лист без своих границ сервисов
     * и лист с ними (excel.js). Выбранная степень на файл не влияет — в нём все степени
     */
    async function exportExcel() {
        setExporting(true);
        try {
            await exportToExcel(data, period, productId, serviceBounds);
        } catch (exportError) {
            setError(`Не удалось выгрузить Excel: ${exportError.message}`);
        } finally {
            setExporting(false);
        }
    }

    /** Клик по названию степени в шапке таблицы, сектору кольца или строке легенды: выбрать степень; повторный — снять */
    function toggleStepen(stepen) {
        setSelectedStepen(selectedStepen === stepen ? null : stepen);
    }

    /** Окно сервиса сохранило границы: массив — свои границы, null — границы по умолчанию (запись убираем) */
    function saveServiceBounds(serviceId, bounds) {
        const next = { ...serviceBounds };   // копия: состояние в React заменяют целиком, а не меняют на месте
        if (bounds === null) {
            delete next[serviceId];
        } else {
            next[serviceId] = bounds;
        }
        setServiceBounds(next);
    }

    // окно закрылось. useCallback — одна и та же функция при каждой перерисовке: окно подписывается на неё
    // в своём useEffect и не должно переподписываться заново
    const closeDialog = useCallback(function () {
        setDialogServiceId(null);
    }, []);

    const closeImport = useCallback(function () {
        setImportOpen(false);
    }, []);

    if (data === null) {
        // данные ещё не пришли: шапка (чтобы можно было выйти — например, при 403 без роли) и ошибка, если она есть
        return (
            <>
                <UserBar user={user} />
                {error !== '' && <p className="error" role="alert">{error}</p>}
            </>
        );
    }

    // всё, что зависит от данных и выбора, считаем при каждой перерисовке (calc.js)
    const ranges = getStepenRanges();
    const rows = rowsOfProduct(data.rows, productId);
    // для каждой метрики — сколько аварий каждой степени у каждого сервиса
    const statsByMetric = data.metrics.map(function (metric) {
        return buildServiceStats(rows, metric, data.buckets, serviceBounds);
    });
    // общий масштаб полос — самое большое значение среди всех метрик (не меньше 1)
    const maxCount = maxShownCount(statsByMetric, selectedStepen);
    // колонки таблиц — диапазоны по 10%, одинаковые для всех метрик
    const columns = buildTableColumns(data.buckets);

    // строка сервиса, чьё окно открыто
    const dialogService = data.rows.find(function (row) { return row.service_id === dialogServiceId; });

    return (
        <>
            <UserBar user={user} />

            <Filters
                data={data} period={period} onPeriodChange={changePeriod}
                productId={productId} onProductChange={setProductId}
                onImport={function () { setImportOpen(true); }} canImport={user.canWrite}
                onExport={exportExcel} isExporting={isExporting}
            />

            {error !== '' && <p className="error" role="alert">{error}</p>}

            {/* по раскрывающемуся блоку на метрику: кольцо с полосами сервисов и таблица */}
            <main>
                <div className="metric-rows">
                    {data.metrics.map(function (metric, i) {
                        return (
                            <MetricBlock
                                key={metric.id} metric={metric}
                                isOpen={openMetrics[metric.id] === true}
                                onOpenChange={function (open) { setOpenMetrics({ ...openMetrics, [metric.id]: open }); }}
                                stats={statsByMetric[i]} maxCount={maxCount} ranges={ranges}
                                rows={rows} columns={columns} buckets={data.buckets} serviceBounds={serviceBounds}
                                selectedStepen={selectedStepen} onToggleStepen={toggleStepen}
                                onOpenService={setDialogServiceId}
                            />
                        );
                    })}
                </div>
            </main>

            {/* окно сервиса — на странице, только пока открыто; key — для другого сервиса окно создаётся заново */}
            {dialogService !== undefined && (
                <ServiceDialog
                    key={dialogService.service_id}
                    service={dialogService} metrics={data.metrics} buckets={data.buckets}
                    savedBounds={boundsOf(serviceBounds, dialogService.service_id)}
                    onSave={function (bounds) { saveServiceBounds(dialogService.service_id, bounds); }}
                    onClose={closeDialog}
                />
            )}

            {/* окно импорта из CSV; записали — загружаем данные выбранного периода заново */}
            {isImportOpen && <ImportDialog onImported={function () { changePeriod({}); }} onClose={closeImport} />}
        </>
    );
}
