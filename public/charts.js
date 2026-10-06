// Отрисовка без сторонних библиотек: кольцевая диаграмма (SVG), полосы по сервисам и таблица (HTML).
// Подписи из данных вставляются только через textContent.

const SVG_NS = 'http://www.w3.org/2000/svg';
export const fmt = new Intl.NumberFormat('ru-RU');
const pct = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0 });
const pluralRules = new Intl.PluralRules('ru-RU');

export const sum = (arr) => arr.reduce((a, b) => a + b, 0);

/** «авария / аварии / аварий» */
export function plural(n, [one, few, many]) {
    return { one, few, many }[pluralRules.select(n)] ?? many;
}

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

// ---------- цвета ----------

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Полупрозрачный оттенок цвета — фон для нулевых ячеек */
const tint = (hex, alpha) => `rgba(${rgb(hex).join(', ')}, ${alpha})`;

/** Тёмный или белый текст — что контрастнее на этом фоне */
export function inkFor(hex) {
    const [r, g, b] = rgb(hex).map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return (lum + 0.05) / 0.05 > 1.05 / (lum + 0.05) ? '#0b0b0b' : '#ffffff';
}

// ---------- подсказка ----------

const tip = document.getElementById('tooltip');

function showTip(title, rows, x, y) {
    tip.replaceChildren();
    el('div', { class: 'tip-title' }, tip, title);
    for (const r of rows) {
        const row = el('div', { class: 'tip-row' }, tip);
        el('span', { class: 'tip-key', style: `background: ${r.color}` }, row);
        el('span', {}, row, fmt.format(r.value));
        el('span', { class: 'tip-label' }, row, r.label);
    }
    tip.hidden = false;
    const { offsetWidth: w, offsetHeight: h } = tip;
    tip.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - w - 8))}px`;
    tip.style.top = `${y + 14 + h > innerHeight - 8 ? y - h - 10 : y + 14}px`;
}

function bindTip(node, content) {
    node.addEventListener('pointermove', (e) => {
        const { title, rows } = content();
        showTip(title, rows, e.clientX, e.clientY);
    });
    node.addEventListener('pointerleave', () => { tip.hidden = true; });
}

// ---------- кольцевая диаграмма ----------

/** Сектор кольца от угла a0 до a1 (радианы, 0 — сверху, по часовой) */
function arc(c, R, r, a0, a1) {
    const pt = (rad, a) => `${c + rad * Math.sin(a)},${c - rad * Math.cos(a)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${pt(R, a0)}A${R},${R} 0 ${large} 1 ${pt(R, a1)}L${pt(r, a1)}A${r},${r} 0 ${large} 0 ${pt(r, a0)}Z`;
}

/**
 * parts: [{ label, short, sub, value, color }]; short — подпись на секторе; selected — индекс выбранной части или null;
 * onSelect(i) вызывается по клику на сектор или строку легенды.
 */
export function renderDonut(host, { parts, selected, onSelect }) {
    const total = sum(parts.map((p) => p.value));
    const S = 180;
    const c = S / 2;
    const R = 86;
    const r = 56;

    const wrap = el('div', { class: 'donut' });
    const svg = svgEl('svg', { viewBox: `0 0 ${S} ${S}`, width: S, height: S, role: 'img', 'aria-label': 'Доли аварий по степеням деградации' }, wrap);

    if (total === 0) {
        svgEl('circle', { cx: c, cy: c, r: (R + r) / 2, fill: 'none', stroke: 'var(--grid)', 'stroke-width': R - r }, svg);
    }
    let a = 0;
    parts.forEach((p, i) => {
        if (!p.value) return;
        const a1 = a + (p.value / total) * 2 * Math.PI;
        // целое кольцо рисуем двумя половинами: дуга в 360° вырождается
        const d = p.value === total ? arc(c, R, r, 0, Math.PI) + arc(c, R, r, Math.PI, 2 * Math.PI) : arc(c, R, r, a, a1);
        const slice = svgEl('path', { d, fill: p.color, class: p.value === total ? 'slice full' : 'slice' }, svg);
        if (selected !== null && selected !== i) slice.classList.add('dim');
        // буква степени на секторе — чтобы степени различались не только цветом
        if (a1 - a >= 0.35) {
            const mid = (a + a1) / 2;
            const num = svgEl('text', {
                class: 'slice-num', x: c + ((R + r) / 2) * Math.sin(mid), y: c - ((R + r) / 2) * Math.cos(mid) + 4, fill: inkFor(p.color),
            }, svg);
            num.textContent = p.short;
            if (selected !== null && selected !== i) num.classList.add('dim');
        }
        slice.addEventListener('click', () => onSelect(i));
        bindTip(slice, () => ({
            title: `${p.label} · ${p.sub}`,
            rows: [{ value: p.value, label: `${plural(p.value, ['авария', 'аварии', 'аварий'])} · ${pct.format(p.value / total)}`, color: p.color }],
        }));
        a = a1;
    });

    // в центре — всего аварий или число в выбранной степени и её доля
    const shown = selected === null ? total : parts[selected].value;
    svgEl('text', { x: c, y: c + 4, class: 'donut-value' }, svg).textContent = fmt.format(shown);
    svgEl('text', { x: c, y: c + 24, class: 'donut-label' }, svg).textContent = selected === null
        ? plural(total, ['авария', 'аварии', 'аварий'])
        : (total ? pct.format(shown / total) : '');

    const legend = el('div', { class: 'donut-legend' }, wrap);
    parts.forEach((p, i) => {
        const row = el('button', { type: 'button', class: 'legend-row', 'aria-pressed': String(selected === i) }, legend);
        if (selected !== null && selected !== i) row.classList.add('dim');
        el('span', { class: 'key', style: `background: ${p.color}` }, row);
        el('span', {}, row, p.label);
        el('span', { class: 'muted' }, row, p.sub);
        el('span', { class: 'legend-value' }, row, fmt.format(p.value));
        el('span', { class: 'muted legend-pct' }, row, total ? pct.format(p.value / total) : '—');
        row.addEventListener('click', () => onSelect(i));
    });

    host.replaceChildren(wrap);
}

// ---------- полосы по сервисам ----------

/**
 * items: [{ name, parts: [кол-во по степеням деградации] }]; names — названия степеней.
 * Полоса сервиса разбита на цвета степеней; если степень выбрана — показывается только она.
 * max — общий масштаб для сравнения карточек.
 */
export function renderServiceBars(host, { items, colors, names, selected, max }) {
    const shown = items
        .map((it) => ({ ...it, value: selected === null ? sum(it.parts) : it.parts[selected] }))
        .filter((it) => it.value > 0)
        .sort((x, y) => y.value - x.value);

    if (!shown.length) {
        host.replaceChildren(el('p', { class: 'empty' }, null, 'Аварий нет'));
        return;
    }
    const list = el('div', { class: 'bars' });
    for (const it of shown) {
        const row = el('div', { class: 'bars-row' }, list);
        el('div', {}, row, it.name);
        const line = el('div', { class: 'bar-line' }, row);
        const bar = el('div', { class: 'bar', style: `width: calc((100% - 3em) * ${it.value / max})` }, line);
        it.parts.forEach((v, i) => {
            if (!v || (selected !== null && selected !== i)) return;
            const seg = el('span', { style: `flex-grow: ${v}; background: ${colors[i]}` }, bar);
            bindTip(seg, () => ({ title: it.name, rows: [{ value: v, label: names[i].toLowerCase(), color: colors[i] }] }));
        });
        el('span', { class: 'bar-value' }, line, fmt.format(it.value));
    }
    host.replaceChildren(list);
}

// ---------- таблица как в Excel ----------

function groupBy(rows, key) {
    const map = new Map();
    for (const r of rows) {
        if (!map.has(key(r))) map.set(key(r), []);
        map.get(key(r)).push(r);
    }
    return [...map.values()];
}

/**
 * Таблица как в Excel: по блоку на каждую метрику, один под другим. Блоки — части одной таблицы,
 * поэтому столбцы у них одинаковой ширины. columns: [{ from, to, sev }] — общие для всех метрик,
 * rows[].counts[metricId] — количество случаев по колонкам.
 */
export function renderTable(host, { metrics, columns, rows, colors, selected }) {
    const table = el('table', { class: 'grid' });
    // колонки диапазонов — одинаковой ширины (см. .grid col.value), колонки №, операции и сервиса — по содержимому
    const colgroup = el('colgroup', {}, table);
    el('col', { span: 3 }, colgroup);
    el('col', { span: columns.length, class: 'value' }, colgroup);

    metrics.forEach((m, mi) => {
        if (mi > 0) el('td', { colspan: columns.length + 3 }, el('tr', { class: 'spacer' }, el('tbody', {}, table)));
        appendSection(table, m, mi === 0 ? 'thead' : 'tbody', columns, rows, colors, selected);
    });
    host.replaceChildren(table);
}

/** Блок одной метрики. Ячейка окрашена цветом степени своей колонки: ненулевые — полным цветом, нулевые — бледным оттенком */
function appendSection(table, metric, headTag, columns, rows, colors, selected) {
    const paint = (cell, v, c) => {
        const color = colors[c.sev];
        cell.style.backgroundColor = v ? color : tint(color, 0.16);
        cell.style.color = v ? inkFor(color) : 'var(--muted)';
        if (selected !== null && c.sev !== selected) cell.classList.add('dim');
    };
    const valueCells = (tr, counts) => counts.forEach((v, bi) => paint(el('td', {}, tr, fmt.format(v)), v, columns[bi]));
    const sumCounts = (list) => columns.map((_, bi) => sum(list.map((r) => r.counts[metric.id][bi])));

    const head = el(headTag, {}, table);
    const head1 = el('tr', {}, head);
    for (const title of ['№', 'Операция', 'Сервис']) el('th', { rowspan: 2, class: 'name' }, head1, title);
    el('th', { colspan: columns.length, class: 'metric' }, head1, `${metric.label} · деградация, %`);
    const head2 = el('tr', {}, head);
    for (const c of columns) {
        const th = el('th', { class: 'bucket' }, head2, c.from === c.to ? String(c.from) : `${c.from}–${c.to}`);
        const color = colors[c.sev];
        th.style.backgroundColor = color;
        th.style.color = inkFor(color);
        if (selected !== null && c.sev !== selected) th.classList.add('dim');
    }

    const body = el('tbody', {}, table);
    const total = el('tr', { class: 'sum' }, body);
    el('td', { colspan: 3, class: 'name' }, total, 'Всего');
    valueCells(total, sumCounts(rows));

    for (const catRows of groupBy(rows, (r) => r.category_id)) {
        const cat = el('tr', { class: 'sum' }, body);
        el('td', { colspan: 3, class: 'name' }, cat, catRows[0].category);
        valueCells(cat, sumCounts(catRows));

        for (const opRows of groupBy(catRows, (r) => r.operation_id)) {
            opRows.forEach((r, i) => {
                const tr = el('tr', {}, body);
                if (i === 0) {
                    el('td', { rowspan: opRows.length }, tr, String(r.operation_num));
                    el('td', { rowspan: opRows.length, class: 'name' }, tr, r.operation);
                }
                el('td', { class: 'name' }, tr, r.service);
                valueCells(tr, r.counts[metric.id]);
            });
        }
    }
}
