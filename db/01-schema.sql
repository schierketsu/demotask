-- Схема БД. Postgres выполняет файлы из этой папки один раз — при первом старте с пустым томом.

-- Группа столбцов в исходной таблице: «Деградация (без учета 5 минут)» / «(с учетом 5 минут)»
CREATE TABLE metric (
    id   int PRIMARY KEY,
    name text NOT NULL
);

-- Диапазон глубины деградации: «0-10%» … «91-100%» с шагом 10 — колонки таблицы «как в Excel».
-- Каждый случай деградации относится к одному из этих диапазонов (degradation_case.bucket_id)
CREATE TABLE bucket (
    id       int PRIMARY KEY,
    label    text NOT NULL,
    pct_from int  NOT NULL,
    pct_to   int  NOT NULL
);

-- Продукт: в нём операции, в операциях — сервисы
CREATE TABLE product (
    id   int PRIMARY KEY,
    name text NOT NULL
);

CREATE TABLE operation (
    id         int PRIMARY KEY,
    product_id int  NOT NULL REFERENCES product (id),
    num        int  NOT NULL,  -- столбец «№»
    name       text NOT NULL
);

CREATE TABLE service (
    id           int PRIMARY KEY,
    operation_id int  NOT NULL REFERENCES operation (id),
    name         text NOT NULL
);

-- Случай деградации сервиса. Глубина деградации — не точный процент, а диапазон с шагом 10
-- (bucket_id → «21-30%» и т.п.): авария определяется тем, в какой диапазон она попала.
-- case_date — день, когда случай произошёл (по нему дашборд показывает данные за выбранный месяц)
CREATE TABLE degradation_case (
    id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    service_id int  NOT NULL REFERENCES service (id),
    metric_id  int  NOT NULL REFERENCES metric (id),
    bucket_id  int  NOT NULL REFERENCES bucket (id),
    case_date  date NOT NULL
);
