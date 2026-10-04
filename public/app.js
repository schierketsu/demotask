import { el, renderColumns, renderHeatmaps, renderKpis, renderLegend, renderServiceBars } from './charts.js';

const $ = (id) => document.getElementById(id);
const state = { meta: null, data: null, series: [], labels: [] };

async function api(path) {
    const res = await fetch(`/api/${path}`, { headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
}

/** «Деградация (без учета 5 минут)» -> «Без учета 5 минут» */
function shortName(name) {
    const inner = /\(([^)]+)\)/.exec(name)?.[1] ?? name;
    return inner.charAt(0).toUpperCase() + inner.slice(1);
}

function showError(message) {
    $('error').textContent = message ? `Не удалось загрузить данные: ${message}` : '';
    $('error').hidden = !message;
}

function renderDistribution() {
    const { data, series, labels, meta } = state;
    const value = (metricId, bucketId) =>
        data.by_bucket.find((b) => b.metric_id === metricId && b.bucket_id === bucketId)?.cnt ?? 0;
    renderColumns($('chart-dist'), {
        labels,
        axisTitle: 'Глубина деградации, %',
        series: series.map((s) => ({ ...s, values: meta.buckets.map((b) => value(s.id, b.id)) })),
    });
}

function render() {
    const { data, series, labels } = state;
    renderKpis($('kpis'), series, data);
    renderLegend($('legend-dist'), series);
    renderDistribution();
    renderLegend($('legend-svc'), series);
    renderServiceBars($('chart-svc'), data.rows, series);
    renderHeatmaps($('heatmaps'), $('scale'), data.rows, labels, series);
}

async function loadDashboard() {
    const category = $('category').value;
    const url = new URL(location.href);
    category ? url.searchParams.set('category', category) : url.searchParams.delete('category');
    history.replaceState(null, '', url);

    // при перезагрузке держим прежнюю отрисовку полупрозрачной, без скачков макета
    $('dashboard').classList.add('loading');
    try {
        state.data = await api('dashboard' + (category ? `?category=${encodeURIComponent(category)}` : ''));
        showError(null);
        render();
    } catch (e) {
        showError(e.message);
    } finally {
        $('dashboard').classList.remove('loading');
    }
}

async function init() {
    try {
        state.meta = await api('meta');
    } catch (e) {
        showError(e.message);
        return;
    }
    const { meta } = state;
    state.series = meta.metrics.map((m, i) => ({ id: m.id, label: shortName(m.name), cls: `s${i + 1}` }));
    state.labels = meta.buckets.map((b) => `${b.pct_from}–${b.pct_to}`);

    const select = $('category');
    for (const c of meta.categories) el('option', { value: c.id }, select, c.name);
    const wanted = new URLSearchParams(location.search).get('category');
    if (wanted && meta.categories.some((c) => String(c.id) === wanted)) select.value = wanted;
    select.addEventListener('change', loadDashboard);

    // столбчатая диаграмма рисуется в пикселях контейнера — перерисовываем при смене ширины
    let width = 0;
    new ResizeObserver(([entry]) => {
        const w = Math.round(entry.contentRect.width);
        if (state.data && w !== width) {
            width = w;
            renderDistribution();
        }
    }).observe($('chart-dist'));

    await loadDashboard();
}

init();
