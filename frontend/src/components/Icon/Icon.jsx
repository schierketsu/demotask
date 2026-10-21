// Icon.jsx — иконка из набора Admiral (@admiral-ds/icons 2.0.0): <Icon src={exitIcon} />.
// Файл иконки служит маской: от него берётся только форма, а цвет — цвет текста рядом (currentColor). Поэтому иконка
// перекрашивается вместе с темой, хотя цвет в самих SVG Admiral зашит (#626F84). Уголки и крестик, которые
// рисуются в стилях, устроены так же — миксин icon в styles/_mixins.scss.

import { classNames } from '../../helpers.js';
import './Icon.scss';   // стили этого компонента

/**
 *   src — адрес SVG: import exitIcon from '@admiral-ds/icons/build/system/ExitOutline.svg' (Vite отдаёт адрес файла)
 *   size — сторона квадрата в px; иконки Admiral нарисованы на сетке 24, у кнопок панели они 20
 *   label — подпись для экранного диктора; без неё иконка — украшение, и диктор её пропускает
 *   остальное (className, обработчики подсказки) — на сам элемент
 */
export default function Icon({ src, size = 20, label, className, ...props }) {
    const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
    return (
        <span
            className={classNames('icon', className)}
            style={{ '--icon': `url("${src}")`, width: size, height: size }}
            {...a11y} {...props}
        />
    );
}
