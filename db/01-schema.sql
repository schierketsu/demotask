-- Схема БД. Postgres выполняет файлы из этой папки один раз — при первом старте с пустым томом.

-- Группа столбцов в исходной таблице: «Деградация (без учета 5 минут)» / «(с учетом 5 минут)»
CREATE TABLE metric (
    id   int PRIMARY KEY,
    name text NOT NULL
);

-- Диапазон глубины деградации: «0-10%» … «91-100%» — колонки таблицы «как в Excel»
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

-- Случай деградации сервиса: процент деградации — готовый результат анализа, всегда целое число
CREATE TABLE degradation_case (
    id         int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    service_id int NOT NULL REFERENCES service (id),
    metric_id  int NOT NULL REFERENCES metric (id),
    pct        int NOT NULL CHECK (pct BETWEEN 0 AND 100)
);
