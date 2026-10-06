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

Схема — в `db/01-schema.sql`, демо-данные — в `db/02-data.sql`. Postgres загружает их сам при первом старте с пустым томом.

Каждый случай деградации хранится отдельной строкой `degradation_case` с целым процентом деградации. Степени деградации (минимальная, частичная, значительная, полная — названия по МУ) считаются по этому проценту, поэтому их границы можно двигать с шагом 1%. Категории 1–3 в данных — это группы операций, а не категории аварий. Диапазоны `bucket` (0–10% … 91–100%) задают только колонки таблицы «как в Excel».

**Проценты в демо-данных синтетические.** В `пример.xlsx` есть только количество случаев по диапазонам, поэтому значения сгенерированы случайно внутри тех же диапазонов: количество по диапазонам совпадает с исходной таблицей, а точные проценты — нет. Когда будут реальные данные, их нужно загрузить вместо этого блока в `db/02-data.sql`.

Чтобы перезалить данные после правки этих файлов:

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
