// Отрисовка графиков без сторонних библиотек: SVG для столбцов, HTML для баров и тепловых карт.
// Все подписи из данных вставляются через textContent.

const SVG_NS = 'http://www.w3.org/2000/svg';
export const fmt = new Intl.NumberFormat('ru-RU');
const pct = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0 });
const pluralRules = new Intl.PluralRules('ru-RU');

export function el(tag, attrs = {}, parent = null, text = null) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== null) node.textContent = text;
    parent?.append(node);
    return node;
}

function svgEl(tag, attrs, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent?.append(node);
    return node;
}

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

/** «случай / случая / случаев» */
function plural(n, [one, few, many]) {
    return { one, few, many }[pluralRules.select(n)] ?? many;
}

// ---------- подсказка ----------

const tip = document.getElementById('tooltip');

function showTip(title, rows, x, y) {
    tip.replaceChildren();
    el('div', { class: 'tip-title' }, tip, title);
    for (const r of rows) {
        const row = el('div', { class: 'tip-row' }, tip);
        el('span', { class: `tip-key ${r.cls}` }, row);
        el('strong', {}, row, fmt.format(r.value));
        el('span', { class: 'tip-label' }, row, r.label);
    }
    tip.hidden = false;
    const { offsetWidth: w, offsetHeight: h } = tip;
    tip.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - w - 8))}px`;
    tip.style.top = `${y + 14 + h > innerHeight - 8 ? y - h - 10 : y + 14}px`;
}

const hideTip = () => { tip.hidden = true; };

/** Подсказка по наведению и по фокусу с клавиатуры; content() -> { title, rows } */
function bindTip(node, content) {
    node.addEventListener('pointermove', (e) => {
        const { title, rows } = content();
        showTip(title, rows, e.clientX, e.clientY);
    });
    node.addEventListener('pointerleave', hideTip);
    node.addEventListener('focus', () => {
        const r = node.getBoundingClientRect();
        const { title, rows } = content();
        showTip(title, rows, r.left + r.width / 2, r.top);
    });
    node.addEventListener('blur', hideTip);
}

// ---------- легенда ----------

export function renderLegend(host, series) {
    host.replaceChildren(...series.map((s) => {
        const item = el('span');
        el('span', { class: `key ${s.cls}` }, item);
        item.append(s.label);
        return item;
    }));
}

// ---------- KPI ----------

export function renderKpis(host, series, data) {
    const byMetric = new Map(data.kpi.map((k) => [k.metric_id, k]));
    const tiles = series.map((s) => {
        const k = byMetric.get(s.id) ?? { total: 0, services_affected: 0, severe: 0 };
        const tile = el('div', { class: 'kpi' });
        const label = el('div', { class: 'kpi-label' }, tile);
        el('span', { class: `key ${s.cls}` }, label);
        label.append(s.label);
        el('div', { class: 'kpi-value' }, tile, fmt.format(k.total));
        el('div', { class: 'kpi-sub' }, tile, plural(k.total, ['случай деградации', 'случая деградации', 'случаев деградации']));
        const meta = el('dl', { class: 'kpi-meta' }, tile);
        const item = (dt, dd) => {
            const d = el('div', {}, meta);
            el('dt', {}, d, dt);
            el('dd', {}, d, dd);
        };
        item('Затронуто сервисов', `${fmt.format(k.services_affected)} из ${fmt.format(data.services_total)}`);
        item('Глубокая деградация (>50%)', k.total ? `${fmt.format(k.severe)} · ${pct.format(k.severe / k.total)}` : '0');
        return tile;
    });

    // Для пары метрик — насколько вторая отличается от первой
    if (series.length === 2) {
        const [a, b] = series.map((s) => byMetric.get(s.id)?.total ?? 0);
        const tile = el('div', { class: 'kpi' });
        el('div', { class: 'kpi-label' }, tile, 'Разница между метриками');
        const delta = a ? (b - a) / a : null;
        el('div', { class: 'kpi-value' }, tile, delta === null ? '—' : (delta > 0 ? '+' : '') + pct.format(delta).replace('-', '−'));
        el('div', { class: 'kpi-sub' }, tile, `«${series[1].label}» относительно «${series[0].label}»: ${fmt.format(a)} → ${fmt.format(b)}`);
        tiles.push(tile);
    }
    host.replaceChildren(...tiles);
}

// ---------- сгруппированные столбцы (SVG) ----------

function niceTicks(max, count = 4) {
    if (max <= 0) return [0, 1];
    const raw = max / count;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw));
    const ticks = [];
    for (let v = 0; v < max + step; v += step) ticks.push(v);
    return ticks;
}

/** Прямоугольник со скруглённым верхом (конец данных) и прямым основанием */
function columnPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`;
}

/**
 * labels — подписи групп по оси X; series — [{ label, cls, values[] }]
 */
export function renderColumns(host, { labels, series, axisTitle }) {
    const W = Math.max(280, host.clientWidth);
    const plotH = 220;
    const m = { top: 18, right: 4, left: 32 };
    const band = (W - m.left - m.right) / labels.length;
    const rotate = band < 46;  // узкий экран — подписи диапазонов наклоняем
    m.bottom = (rotate ? 58 : 30) + 18;
    const H = m.top + plotH + m.bottom;

    const ticks = niceTicks(Math.max(0, ...series.flatMap((s) => s.values)));
    const top = ticks.at(-1);
    const y = (v) => m.top + plotH - (v / top) * plotH;

    const gap = 2;
    const barW = Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length);
    const groupW = barW * series.length + gap * (series.length - 1);
    const showCaps = barW >= 14;  // подпись над столбцом, только если помещается

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': axisTitle });

    for (const t of ticks) {
        svgEl('line', { class: t === 0 ? 'base' : 'grid', x1: m.left, x2: W - m.right, y1: y(t), y2: y(t) }, svg);
        svgEl('text', { x: m.left - 6, y: y(t) + 4, 'text-anchor': 'end' }, svg).textContent = fmt.format(t);
    }

    labels.forEach((label, i) => {
        const x0 = m.left + band * i;
        const g = svgEl('g', {
            class: 'col',
            tabindex: 0,
            'aria-label': `${label}: ` + series.map((s) => `${s.label} — ${s.values[i]}`).join(', '),
        }, svg);
        svgEl('rect', { class: 'hit', x: x0, y: m.top, width: band, height: plotH, rx: 4 }, g);

        series.forEach((s, k) => {
            const v = s.values[i];
            if (v <= 0) return;
            const bx = x0 + (band - groupW) / 2 + k * (barW + gap);
            svgEl('path', { class: s.cls, d: columnPath(bx, y(v), barW, y(0) - y(v), 4) }, g);
            if (showCaps) {
                svgEl('text', { class: 'cap', x: bx + barW / 2, y: y(v) - 4 }, g).textContent = fmt.format(v);
            }
        });

        const tx = x0 + band / 2;
        const ty = m.top + plotH + 16;
        svgEl('text', rotate
            ? { x: tx + 4, y: ty, 'text-anchor': 'end', transform: `rotate(-40 ${tx + 4} ${ty})` }
            : { x: tx, y: ty, 'text-anchor': 'middle' }, svg).textContent = label;

        bindTip(g, () => ({ title: label, rows: series.map((s) => ({ label: s.label, cls: s.cls, value: s.values[i] })) }));
    });

    svgEl('text', { x: m.left + (W - m.left - m.right) / 2, y: H - 4, 'text-anchor': 'middle' }, svg).textContent = axisTitle;
    host.replaceChildren(svg);
}

// ---------- горизонтальные бары по сервисам (HTML) ----------

export function renderServiceBars(host, rows, series) {
    if (!rows.length) {
        host.replaceChildren(el('p', { class: 'empty' }, null, 'Нет данных'));
        return;
    }
    const totals = rows.map((r) => series.map((s) => sum(r.counts[s.id])));
    const max = Math.max(1, ...totals.flat());
    const list = el('div', { class: 'bars' });
    let category = null;
    let operation = null;

    rows.forEach((r, i) => {
        if (r.category_id !== category) {
            category = r.category_id;
            operation = null;
            el('div', { class: 'bars-cat' }, list, r.category);
        }
        if (r.operation_id !== operation) {
            operation = r.operation_id;
            el('div', { class: 'bars-op' }, list, (r.operation_num !== null ? `№ ${r.operation_num} · ` : '') + r.operation);
        }
        const row = el('div', { class: 'bars-row' }, list);
        el('div', { class: 'bars-label' }, row, r.service);
        const track = el('div', { class: 'bars-track' }, row);
        series.forEach((s, k) => {
            const v = totals[i][k];
            const line = el('div', { class: 'bar-line', 'aria-label': `${s.label}: ${v}` }, track);
            // место под подпись значения у конца бара вычитаем из доступной ширины
            el('span', { class: `bar ${s.cls}`, style: `width: calc((100% - 3em) * ${v / max})` }, line);
            el('span', { class: v ? 'bar-val' : 'bar-val zero' }, line, fmt.format(v));
        });
    });
    host.replaceChildren(list);
}

// ---------- тепловые карты «сервис × диапазон» (HTML-таблицы) ----------

const LEVELS = 5;

export function renderHeatmaps(host, scaleHost, rows, labels, series) {
    if (!rows.length) {
        host.replaceChildren(el('p', { class: 'empty' }, null, 'Нет данных'));
        scaleHost.replaceChildren();
        return;
    }
    // общая шкала для всех метрик, чтобы карты можно было сравнивать
    const max = Math.max(0, ...rows.flatMap((r) => series.flatMap((s) => r.counts[s.id])));
    const level = (v) => (v <= 0 ? 0 : max <= 1 ? LEVELS : 1 + Math.round(((v - 1) / (max - 1)) * (LEVELS - 1)));

    const figures = series.map((s) => {
        const fig = el('figure', { class: 'heatmap' });
        const cap = el('figcaption', {}, fig);
        el('span', { class: `key ${s.cls}` }, cap);
        cap.append(s.label);

        const table = el('table', {}, el('div', { class: 'table-wrap' }, fig));
        const head = el('tr', {}, el('thead', {}, table));
        el('th', { scope: 'col', class: 'rowhead' }, head, 'Сервис');
        labels.forEach((l) => el('th', { scope: 'col' }, head, l));
        el('th', { scope: 'col' }, head, 'Итого');

        const body = el('tbody', {}, table);
        const colTotals = labels.map(() => 0);
        let group = null;
        for (const r of rows) {
            const g = `${r.category_id}/${r.operation_id}`;
            if (g !== group) {
                group = g;
                el('th', { colspan: labels.length + 2, scope: 'rowgroup' }, el('tr', { class: 'grp' }, body), `${r.category} · ${r.operation}`);
            }
            const tr = el('tr', {}, body);
            el('th', { scope: 'row', class: 'rowhead' }, tr, r.service);
            r.counts[s.id].forEach((v, i) => {
                colTotals[i] += v;
                const td = el('td', { 'data-v': v, 'data-i': i }, tr, v ? fmt.format(v) : null);
                if (v) td.className = `h${level(v)}`;
                else el('span', { class: 'sr' }, td, '0');
                td.dataset.service = r.service;
            });
            el('td', { class: 'total' }, tr, fmt.format(sum(r.counts[s.id])));
        }

        const foot = el('tr', {}, el('tfoot', {}, table));
        el('th', { scope: 'row' }, foot, 'Итого');
        colTotals.forEach((v) => el('td', {}, foot, fmt.format(v)));
        el('td', {}, foot, fmt.format(sum(colTotals)));

        // одна подсказка на таблицу через делегирование событий
        table.addEventListener('pointermove', (e) => {
            const td = e.target.closest('td[data-i]');
            if (!td) return hideTip();
            showTip(td.dataset.service, [{ label: `${labels[td.dataset.i]} · ${s.label}`, cls: s.cls, value: Number(td.dataset.v) }], e.clientX, e.clientY);
        });
        table.addEventListener('pointerleave', hideTip);
        return fig;
    });
    host.replaceChildren(...figures);

    // легенда шкалы: каждое значение, если их мало, иначе ступени с границами
    scaleHost.replaceChildren();
    el('span', {}, scaleHost, 'Случаев в ячейке:');
    el('span', { class: 'sw', style: 'background: var(--wash)' }, scaleHost, '0');
    if (max <= LEVELS * 2) {
        for (let v = 1; v <= max; v++) el('span', { class: `sw h${level(v)}` }, scaleHost, fmt.format(v));
    } else {
        for (let k = 1; k <= LEVELS; k++) {
            const from = Math.ceil(1 + ((k - 1.5) / (LEVELS - 1)) * (max - 1));
            el('span', { class: `sw h${k}` }, scaleHost, `${fmt.format(Math.max(1, from))}+`);
        }
    }
}
