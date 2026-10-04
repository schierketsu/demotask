# Деградация сервисов — инфографика

PostgreSQL 18 + Adminer + NGINX + PHP-FPM 8.4, фронтенд на чистом JS без библиотек.

## Запуск

```sh
docker compose up -d --build
```

| Что | Адрес |
|---|---|
| Дашборд | http://localhost:8000 |
| Adminer | http://localhost:8080 (сервер `db`, пользователь `postgres_admin`, пароль `example`, база `testdb`) |
| PostgreSQL | localhost:5432 |

Если порты заняты: `DB_HOST_PORT=55432 ADMINER_HOST_PORT=8081 WEB_HOST_PORT=8001 docker compose up -d`.

## Данные

Демо-данные из `пример.xlsx` лежат в `db/02-data.sql`, схема — в `db/01-schema.sql`. Postgres загружает их сам при первом старте с пустым томом. Чтобы перезалить после правки этих файлов:

```sh
docker compose down -v && docker compose up -d
```

## Структура

```
compose.yaml, Dockerfile     PostgreSQL (ru_RU, ICU) + Adminer + php + nginx
db/                          схема и демо-данные
docker/php/Dockerfile        php-fpm с pdo_pgsql
docker/nginx/default.conf    статика из public/, /api/* -> src/api.php
src/api.php                  JSON API: GET /api/data — все данные одним ответом
public/                      index.html, style.css, app.js, charts.js
```
