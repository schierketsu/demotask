// vite.config.js — настройки Vite: он собирает React-приложение (npm run build → папка dist)
// и умеет запускать сервер для разработки (npm run dev) с мгновенным обновлением страницы.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],   // понимать JSX (разметку внутри .jsx-файлов)
    server: {
        // при npm run dev запросы /api/* уходят в уже запущенный docker compose (порт 8000),
        // как в собранной версии их передаёт nginx
        proxy: { '/api': 'http://localhost:8000' },
    },
});
