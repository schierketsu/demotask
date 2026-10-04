-- Схема БД. Postgres выполняет файлы из этой папки один раз — при первом старте с пустым томом.

-- Группа столбцов в исходной таблице: «Деградация (без учета 5 минут)» / «(с учетом 5 минут)»
CREATE TABLE metric (
    id   int PRIMARY KEY,
    name text NOT NULL
);

-- Диапазон глубины деградации: «0-10%» … «91-100%»
CREATE TABLE bucket (
    id       int PRIMARY KEY,
    label    text NOT NULL,
    pct_from int  NOT NULL,
    pct_to   int  NOT NULL
);

CREATE TABLE category (
    id   int PRIMARY KEY,
    name text NOT NULL
);

CREATE TABLE operation (
    id          int PRIMARY KEY,
    category_id int  NOT NULL REFERENCES category (id),
    num         int  NOT NULL,  -- столбец «№»
    name        text NOT NULL
);

CREATE TABLE service (
    id           int PRIMARY KEY,
    operation_id int  NOT NULL REFERENCES operation (id),
    name         text NOT NULL
);

-- Количество случаев деградации сервиса в диапазоне по метрике
CREATE TABLE degradation (
    service_id int NOT NULL REFERENCES service (id),
    metric_id  int NOT NULL REFERENCES metric (id),
    bucket_id  int NOT NULL REFERENCES bucket (id),
    cnt        int NOT NULL CHECK (cnt >= 0),
    PRIMARY KEY (service_id, metric_id, bucket_id)
);
