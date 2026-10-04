import { el, inkFor, renderDonut, renderServiceBars, renderTable, sum } from './charts.js';

// Категории аварий по глубине деградации — границы как цветовые зоны в исходном Excel:
// 1 — 0–20%, 2 — 21–50%, 3 — 51–80%, 4 — 81–100%. Цвета: лаймовый и красный из фирменной палитры,
// жёлтый и оранжевый подобраны между ними так, чтобы соседние категории различались.
// bounds — верхние границы категорий 1–3 (шаг 10%: данные сгруппированы по 10%).
const DEFAULTS = { bounds: [20, 50, 80], colors: ['#a8f000', '#ffc400', '#ff8420', '#ef3124'] };
const STORAGE_KEY = 'demotask.severity.v2';

const $ = (id) => document.getElementById(id);
const state = { data: null, metrics: [], opcat: '', selected: null, settings: loadSettings(), controls: null };

// ---------- настройки категорий (сохраняются в браузере) ----------

function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
        const ok = s?.bounds?.length === 3 && s.bounds.every((b, i) => b % 10 === 0 && b > (s.bounds[i - 1] ?? 0) && b < 100)
            && s.colors?.length === 4 && s.colors.every((c) => /^#[0-9a-f]{6}$/i.test(c));
        if (ok) return s;
    } catch { /* нет доступа к хранилищу или битые данные */ }
    return structuredClone(DEFAULTS);
}

function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    } catch { /* не критично */ }
}

/** Ставит границу i и сдвигает соседние так, чтобы в каждой категории остался хотя бы один диапазон */
function setBound(i, value) {
    const b = state.settings.bounds;
    b[i] = Math.min(Math.max(Math.round(value / 10) * 10, 10 * (i + 1)), 100 - 10 * (3 - i));
    for (let j = i + 1; j < 3; j++) b[j] = Math.max(b[j], b[j - 1] + 10);
    for (let j = i - 1; j >= 0; j--) b[j] = Math.min(b[j], b[j + 1] - 10);
}

function severities() {
    const { bounds, colors } = state.settings;
    return colors.map((color, i) => ({
        name: `Категория ${i + 1}`,
        from: i === 0 ? 0 : bounds[i - 1] + 1,
        to: i < 3 ? bounds[i] : 100,
        color,
    }));
}

const rangeText = (s) => `${s.from}–${s.to}%`;

// ---------- панель настройки: ползунки, числа, цвета ----------

function buildControls() {
    const sliders = [0, 1, 2].map((i) => {
        const input = el('input', { type: 'range', min: 0, max: 100, step: 10, 'aria-label': `Граница между категориями ${i + 1} и ${i + 2}, %` }, $('range'));
        input.addEventListener('input', () => { setBound(i, Number(input.value)); apply(); });
        return input;
    });
    const segments = [0, 1, 2, 3].map(() => el('span', {}, $('range-track')));
    for (let v = 0; v <= 100; v += 10) el('span', { style: `left: ${v}%` }, $('range-scale'), String(v));

    const tiles = [0, 1, 2, 3].map((i) => {
        const tile = el('div', { class: 'sev-tile' }, $('sev-tiles'));
        const color = el('input', { type: 'color', 'aria-label': `Цвет категории ${i + 1}` }, tile);
        color.addEventListener('input', () => { state.settings.colors[i] = color.value; apply(); });

        const info = el('div', {}, tile);
        el('div', { class: 'sev-name' }, info, `Категория ${i + 1}`);
        const range = el('div', { class: 'muted' }, info);
        const edit = el('label', { class: 'sev-edit' }, info, 'до ');
        let num = null;
        if (i < 3) {
            num = el('input', { type: 'number', min: 10 * (i + 1), max: 10 * (i + 7), step: 10, 'aria-label': `Верхняя граница категории ${i + 1}, %` }, edit);
            num.addEventListener('change', () => { setBound(i, Number(num.value)); apply(); });
            edit.append(' %');
        } else {
            edit.append('100 %');
        }
        return { color, range, num };
    });

    $('reset').addEventListener('click', () => { state.settings = structuredClone(DEFAULTS); apply(); });
    state.controls = { sliders, segments, tiles };
}

function updateControls() {
    const { bounds, colors } = state.settings;
    const sevs = severities();
    const { sliders, segments, tiles } = state.controls;
    sliders.forEach((s, i) => { s.value = bounds[i]; });
    segments.forEach((seg, i) => {
        seg.style.flexGrow = (i < 3 ? bounds[i] : 100) - (i ? bounds[i - 1] : 0);
        seg.style.background = colors[i];
        seg.style.color = inkFor(colors[i]);
        seg.textContent = String(i + 1);
    });
    tiles.forEach((t, i) => {
        t.color.value = colors[i];
        t.range.textContent = rangeText(sevs[i]);
        if (t.num) t.num.value = bounds[i];
    });
}

// ---------- диаграммы ----------

function select(i) {
    state.selected = state.selected === i ? null : i;
    render();
}

function renderChips(sevs) {
    const chip = (label, i, color) => {
        const b = el('button', { type: 'button', role: 'radio', class: 'chip', 'aria-checked': String(state.selected === i) });
        if (color) el('span', { class: 'key', style: `background: ${color}` }, b);
        b.append(label);
        b.addEventListener('click', () => { state.selected = i; render(); });
        return b;
    };
    $('chips').replaceChildren(
        el('span', { class: 'muted' }, null, 'Категория аварии'),
        chip('Все', null, null),
        ...sevs.map((s, i) => chip(`${i + 1} · ${rangeText(s)}`, i, s.color)),
    );
}

function render() {
    const { data, metrics, settings, selected } = state;
    const sevs = severities();
    // категория аварии для каждого диапазона: 0..3
    const bucketSev = data.buckets.map((b) => {
        const i = settings.bounds.findIndex((bound) => b.pct_to <= bound);
        return i === -1 ? 3 : i;
    });
    const bySeverity = (counts) => {
        const parts = [0, 0, 0, 0];
        counts.forEach((v, bi) => { parts[bucketSev[bi]] += v; });
        return parts;
    };
    const rows = state.opcat ? data.rows.filter((r) => String(r.category_id) === state.opcat) : data.rows;

    renderChips(sevs);

    const items = metrics.map((m) => rows.map((r) => ({ name: r.service, parts: bySeverity(r.counts[m.id]) })));
    const shownValue = (parts) => (selected === null ? sum(parts) : parts[selected]);
    const max = Math.max(1, ...items.flat().map((it) => shownValue(it.parts)));

    $('pies').replaceChildren(...metrics.map((m, mi) => {
        const card = el('section', { class: 'card' });
        el('h2', {}, card, m.label);
        const totals = [0, 1, 2, 3].map((k) => sum(items[mi].map((it) => it.parts[k])));
        renderDonut(el('div', {}, card), {
            parts: sevs.map((s, k) => ({ label: s.name, sub: rangeText(s), value: totals[k], color: s.color })),
            selected,
            onSelect: select,
        });
        el('h3', {}, card, selected === null ? 'Сервисы' : `Сервисы · категория ${selected + 1}`);
        renderServiceBars(el('div', {}, card), { items: items[mi], colors: settings.colors, selected, max });
        return card;
    }));

    renderTable($('table'), { metrics, buckets: data.buckets, rows, bucketSev, colors: settings.colors, selected });
}

function apply() {
    saveSettings();
    updateControls();
    render();
}

/** «Деградация (без учета 5 минут)» -> «Без учета 5 минут» */
function shortName(name) {
    const inner = /\(([^)]+)\)/.exec(name)?.[1] ?? name;
    return inner.charAt(0).toUpperCase() + inner.slice(1);
}

async function init() {
    try {
        const res = await fetch('/api/data');
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        state.data = body;
    } catch (e) {
        $('error').textContent = `Не удалось загрузить данные: ${e.message}`;
        $('error').hidden = false;
        return;
    }
    state.metrics = state.data.metrics.map((m) => ({ id: m.id, label: shortName(m.name) }));

    for (const c of state.data.categories) el('option', { value: c.id }, $('opcat'), c.name);
    $('opcat').addEventListener('change', (e) => { state.opcat = e.target.value; render(); });

    buildControls();
    apply();
}

init();
