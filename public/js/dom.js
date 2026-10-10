// dom.js — два помощника для работы со страницей: создать элемент и найти элемент по id.
// Вынесены отдельно, потому что нужны и view.js, и окну сервиса (service-dialog.js), и app.js —
// а если брать их из view.js, окно и view.js импортировали бы друг друга по кругу.


/**
 * Создать HTML-элемент: тег, атрибуты, родитель (в конец которого вставить) и текст — последние два необязательны.
 * Например: createElement('span', { class: 'muted' }, row, '0–20%') → <span class="muted">0–20%</span> в конце row.
 */
export function createElement(tag, attrs = {}, parent = null, text = null) {
    const element = document.createElement(tag);
    for (const name of Object.keys(attrs)) {
        element.setAttribute(name, attrs[name]);
    }
    if (text !== null) {
        element.textContent = text;
    }
    if (parent) {
        parent.append(element);
    }
    return element;
}

/** Найти элемент страницы по его id */
export function byId(id) {
    return document.getElementById(id);
}
