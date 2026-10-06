import { el, equalizeColumns, inkFor, renderDonut, renderServiceBars, renderTable, sum } from './charts.js';

// Степени деградации (названия — по МУ по управлению авариями), границы — как цветовые зоны в исходном Excel:
// минимальная — 0–20%, частичная — 21–50%, значительная — 51–80%, полная — 81–100%.
// Цвета — как в макете шкалы: зелёный, жёлтый, оранжевый, красный (красный чуть темнее, чтобы на нём читался белый текст).
// bounds — верхние границы первых трёх степеней, шаг STEP (в процентах).
const DEGREES = ['Минимальная', 'Частичная', 'Значительная', 'Полная'];
const DEFAULTS = { bounds: [20, 50, 80], colors: ['#4bd163', '#fbc22c', '#ff7d2e', '#dc2f3a'] };
const STEP = 1;
// v3: сменилась палитра по умолчанию — старые сохранённые цвета не подхватываем
const STORAGE_KEY = 'demotask.severity.v3';

const $ = (id) => document.getElementById(id);
const state = { data: null, metrics: [], opcat: '', selected: null, settings: loadSettings(), controls: null };

// ---------- настройки степеней (сохраняются в браузере) ----------

function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
        const ok = s?.bounds?.length === 3 && s.bounds.every((b, i) => b % STEP === 0 && b > (s.bounds[i - 1] ?? 0) && b < 100)
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

/** Ставит границу i и сдвигает соседние так, чтобы у каждой степени остался хотя бы один процент */
function setBound(i, value) {
    const b = state.settings.bounds;
    b[i] = Math.min(Math.max(Math.round(value / STEP) * STEP, STEP * (i + 1)), 100 - STEP * (3 - i));
    for (let j = i + 1; j < 3; j++) b[j] = Math.max(b[j], b[j - 1] + STEP);
    for (let j = i - 1; j >= 0; j--) b[j] = Math.min(b[j], b[j + 1] - STEP);
}

/** Степень деградации для процента: 0..3 */
function sevOf(pct) {
    const i = state.settings.bounds.findIndex((bound) => pct <= bound);
    return i === -1 ? 3 : i;
}

/**
 * Колонки таблицы: диапазоны из БД, разрезанные границами степеней —
 * так каждая колонка целиком относится к одной степени. [{ from, to, sev }]
 */
function tableColumns() {
    const cols = [];
    for (const b of state.data.buckets) {
        let from = b.pct_from;
        for (const bound of state.settings.bounds) {
            if (bound >= from && bound < b.pct_to) {
                cols.push({ from, to: bound });
                from = bound + 1;
            }
        }
        cols.push({ from, to: b.pct_to });
    }
    return cols.map((c) => ({ ...c, sev: sevOf(c.to) }));
}

/**
 * Соседние колонки без случаев одной степени склеиваются в одну (43–50, 51–60, 61–70 → 43–70),
 * чтобы таблица не разрасталась нулями. pcts — все проценты, попадающие в таблицу (по всем метрикам)
 */
function compactColumns(columns, pcts) {
    const out = [];
    for (const c of columns) {
        const empty = !pcts.some((p) => p >= c.from && p <= c.to);
        const prev = out.at(-1);
        if (empty && prev?.empty && prev.sev === c.sev) prev.to = c.to;
        else out.push({ ...c, empty });
    }
    return out;
}

function severities() {
    const { bounds, colors } = state.settings;
    return colors.map((color, i) => ({
        name: DEGREES[i],
        short: DEGREES[i][0],
        from: i === 0 ? 0 : bounds[i - 1] + 1,
        to: i < 3 ? bounds[i] : 100,
        color,
    }));
}

const rangeText = (s) => `${s.from}–${s.to}%`;

// ---------- панель настройки: ползунки, числа, цвета ----------

function buildControls() {
    const sliders = [0, 1, 2].map((i) => {
        const input = el('input', { type: 'range', min: 0, max: 100, step: STEP, 'aria-label': `Граница между степенями «${DEGREES[i]}» и «${DEGREES[i + 1]}», %` }, $('range'));
        input.addEventListener('input', () => { setBound(i, Number(input.value)); apply(); });
        return input;
    });
    // отрезок шкалы: номер степени и её название
    const segments = [0, 1, 2, 3].map((i) => {
        const seg = el('span', { title: DEGREES[i] }, $('range-track'));
        el('b', {}, seg, String(i + 1));
        el('small', {}, seg, DEGREES[i]);
        return seg;
    });
    // значение границы в «облачке» над ручкой
    const bubbles = [0, 1, 2].map(() => el('span', { class: 'range-bubble', 'aria-hidden': 'true' }, $('range')));
    for (let v = 0; v <= 100; v += 10) el('span', { style: `left: ${v}%` }, $('range-scale'), String(v));

    const tiles = [0, 1, 2, 3].map((i) => {
        const tile = el('div', { class: 'sev-tile' }, $('sev-tiles'));
        const color = el('input', { type: 'color', 'aria-label': `Цвет степени «${DEGREES[i]}»` }, tile);
        color.addEventListener('input', () => { state.settings.colors[i] = color.value; apply(); });

        // справа от цвета — диапазон и поле границы, по центру плашки по вертикали
        const info = el('div', {}, tile);
        const range = el('div', { class: 'muted' }, info);
        const edit = el('label', { class: 'sev-edit' }, info, 'до ');
        let num = null;
        if (i < 3) {
            num = el('input', { type: 'number', min: STEP * (i + 1), max: 100 - STEP * (3 - i), step: STEP, 'aria-label': `Верхняя граница степени «${DEGREES[i]}», %` }, edit);
            num.addEventListener('change', () => {
                // стёртое поле — не ноль: просто возвращаем текущее значение
                if (num.value === '') { updateControls(); return; }
                setBound(i, Number(num.value));
                apply();
            });
            edit.append(' %');
        } else {
            // у последней степени верхняя граница всегда 100 — поле только для вида, как у остальных плашек
            el('input', { type: 'number', value: 100, readonly: '', tabindex: -1, 'aria-label': `Верхняя граница степени «${DEGREES[i]}», %` }, edit);
            edit.append(' %');
        }
        return { color, range, num };
    });

    $('reset').addEventListener('click', () => { state.settings = structuredClone(DEFAULTS); apply(); });
    state.controls = { sliders, segments, bubbles, tiles };
    // ширина отрезков меняется и вместе с окном, а ширина текста — когда догрузится шрифт
    new ResizeObserver(fitSegmentLabels).observe($('range-track'));
    document.fonts.ready.then(fitSegmentLabels);
}

function updateControls() {
    const { bounds, colors } = state.settings;
    const sevs = severities();
    const { sliders, segments, bubbles, tiles } = state.controls;
    sliders.forEach((s, i) => { s.value = bounds[i]; });
    segments.forEach((seg, i) => {
        seg.style.flexGrow = (i < 3 ? bounds[i] : 100) - (i ? bounds[i - 1] : 0);
        // лёгкий градиент: слева цвет чуть светлее
        seg.style.background = `linear-gradient(90deg, color-mix(in srgb, ${colors[i]} 86%, #fff), ${colors[i]})`;
        seg.style.color = inkFor(colors[i]);
    });
    // центр ручки ходит от thumb/2 до (ширина − thumb/2) — облачко ставим туда же
    bubbles.forEach((b, i) => {
        b.textContent = String(bounds[i]);
        b.style.left = `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${bounds[i] / 100})`;
    });
    tiles.forEach((t, i) => {
        t.color.value = colors[i];
        t.range.textContent = rangeText(sevs[i]);
        if (t.num) t.num.value = bounds[i];
    });
    fitSegmentLabels();
}

/**
 * Номер и название степени в отрезке шкалы показываем, только если каждый из них помещается между ручками
 * с зазором LABEL_GAP от текста до края ручки. Сужается отрезок — сначала пропадает название, потом номер
 */
const LABEL_GAP = 8;
function fitSegmentLabels() {
    const thumb = parseFloat(getComputedStyle($('range')).getPropertyValue('--thumb'));
    for (const seg of state.controls.segments) {
        for (const label of seg.children) {
            label.hidden = false;  // чтобы измерить ширину текста
            label.hidden = seg.clientWidth < label.scrollWidth + 2 * (thumb / 2 + LABEL_GAP);
        }
    }
}

// ---------- диаграммы ----------

function select(i) {
    state.selected = state.selected === i ? null : i;
    render();
}

function renderChips(sevs) {
    // на чипе степени — только цвет и проценты; название — во всплывающей подсказке и для экранного диктора
    const chip = (label, i, color, name) => {
        const attrs = { type: 'button', role: 'radio', class: 'chip', 'aria-checked': String(state.selected === i) };
        if (name) Object.assign(attrs, { title: name, 'aria-label': `${name}, ${label}` });
        const b = el('button', attrs);
        if (color) el('span', { class: 'key', style: `background: ${color}` }, b);
        b.append(label);
        b.addEventListener('click', () => { state.selected = i; render(); });
        return b;
    };
    $('chips').replaceChildren(
        el('span', { class: 'muted' }, null, 'Степень деградации'),
        chip('Все', null, null),
        ...sevs.map((s, i) => chip(rangeText(s), i, s.color, s.name)),
    );
}

function render() {
    const { data, metrics, settings, selected } = state;
    const sevs = severities();
    const bySeverity = (pcts) => {
        const parts = [0, 0, 0, 0];
        for (const p of pcts) parts[sevOf(p)]++;
        return parts;
    };
    const rows = state.opcat ? data.rows.filter((r) => String(r.category_id) === state.opcat) : data.rows;

    renderChips(sevs);

    const items = metrics.map((m) => rows.map((r) => ({ name: r.service, parts: bySeverity(r.pcts[m.id]) })));
    const shownValue = (parts) => (selected === null ? sum(parts) : parts[selected]);
    const max = Math.max(1, ...items.flat().map((it) => shownValue(it.parts)));

    // в таблицах — количество случаев по колонкам, как в Excel. Колонки общие для всех метрик, чтобы таблицы
    // совпадали столбец в столбец: склеиваются только колонки, пустые во всех метриках
    const columns = compactColumns(tableColumns(), rows.flatMap((r) => metrics.flatMap((m) => r.pcts[m.id])));
    const tableRows = rows.map((r) => ({
        ...r,
        counts: Object.fromEntries(metrics.map((m) => [
            m.id,
            columns.map((c) => r.pcts[m.id].filter((p) => p >= c.from && p <= c.to).length),
        ])),
    }));

    // по карточке на метрику: слева сводка (кольцо, легенда, полосы сервисов), справа детализация (таблица)
    $('metric-rows').replaceChildren(...metrics.map((m, mi) => {
        const card = el('section', { class: 'card metric-card' });

        const summary = el('div', { class: 'metric-summary' }, card);
        el('h2', {}, summary, m.label);
        const totals = [0, 1, 2, 3].map((k) => sum(items[mi].map((it) => it.parts[k])));
        renderDonut(el('div', {}, summary), {
            parts: sevs.map((s, k) => ({ label: s.name, short: s.short, sub: rangeText(s), value: totals[k], color: s.color })),
            selected,
            onSelect: select,
        });
        el('h3', {}, summary, selected === null ? 'Сервисы' : `Сервисы · ${sevs[selected].name.toLowerCase()} деградация`);
        renderServiceBars(el('div', {}, summary), { items: items[mi], colors: settings.colors, names: DEGREES, selected, max });

        const detail = el('div', { class: 'metric-detail' }, card);
        el('div', { class: 'detail-title muted' }, detail, 'Детализация');
        renderTable(el('div', { class: 'table-wrap' }, detail), { metric: m, columns, rows: tableRows, colors: settings.colors, selected });
        return card;
    }));
    // таблицы уже на странице — выравниваем колонки диапазонов по ширине
    document.querySelectorAll('#metric-rows table.grid').forEach(equalizeColumns);
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
