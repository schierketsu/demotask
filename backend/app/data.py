"""Данные дашборда за период — то, что отдаёт GET /api/data."""

import calendar
from datetime import date

import psycopg

from .db import query


class NoCasesError(Exception):
    """В базе нет ни одного случая деградации — показывать нечего"""


def dashboard_data(conn: psycopg.Connection, period_from: date | None, period_to: date | None) -> dict:
    """Собрать данные дашборда за период с period_from по period_to (оба дня включительно).

    Период не указан (None) — последний месяц, за который есть данные.
    """
    # 1. Справочники: метрики, диапазоны и продукты — просто списки из таблиц
    metrics = query(conn, "SELECT id, name FROM metric ORDER BY id")
    buckets = query(conn, "SELECT id, label, pct_from, pct_to FROM bucket ORDER BY id")
    products = query(conn, "SELECT id, name FROM product ORDER BY id")

    # 2. Месяцы для выбора: подряд от месяца самого раннего случая до месяца самого позднего.
    # generate_series выдаёт каждый месяц этого промежутка, поэтому месяц без аварий тоже попадёт в список.
    # Если случаев нет совсем, список будет пустым
    month_rows = query(conn, """
        SELECT to_char(month_start, 'YYYY-MM') AS month
        FROM generate_series(
            (SELECT date_trunc('month', min(case_date)) FROM degradation_case),
            (SELECT date_trunc('month', max(case_date)) FROM degradation_case),
            interval '1 month'
        ) AS month_start
        ORDER BY month_start""")
    months = [row["month"] for row in month_rows]   # [{'month': '2025-09'}, …] → ['2025-09', …]

    if not months:
        raise NoCasesError

    # первая и последняя дата случаев — странице, чтобы ограничить выбор дат в календаре
    date_range = query(conn, """
        SELECT to_char(min(case_date), 'YYYY-MM-DD') AS min_date,
               to_char(max(case_date), 'YYYY-MM-DD') AS max_date
        FROM degradation_case""")[0]

    if period_from is None:
        # период не выбран — последний месяц: с его первого дня по последний.
        # calendar.monthrange знает, сколько дней в месяце (и про високосные годы): (2026, 2) → (…, 28)
        year, month = (int(part) for part in months[-1].split("-"))   # '2026-10' → 2026, 10
        period_from = date(year, month, 1)
        period_to = date(year, month, calendar.monthrange(year, month)[1])

    # 3. Все сервисы, по строке на сервис, с его операцией и продуктом.
    # Сервисы без случаев деградации тоже здесь: в таблице дашборда у них будут нули
    services = query(conn, """
        SELECT product.id     AS product_id,
               product.name   AS product,
               operation.id   AS operation_id,
               operation.num  AS operation_num,
               operation.name AS operation,
               service.id     AS service_id,
               service.name   AS service
        FROM service
        JOIN operation ON operation.id = service.operation_id   -- к сервису — его операция
        JOIN product   ON product.id = operation.product_id     -- к операции — её продукт
        ORDER BY product.id, operation.num, service.id""")

    # 4. Сколько случаев деградации за период у каждого сервиса в каждом диапазоне по каждой метрике.
    # BETWEEN включает оба конца: случаи и 1 января, и 31 марта попадут в период; count(*) считает случаи в группе.
    # Сочетаний без случаев здесь нет — для них останутся нули из шага 5
    cases = query(conn, """
        SELECT service_id, metric_id, bucket_id, count(*) AS cases
        FROM degradation_case
        WHERE case_date BETWEEN %(from)s AND %(to)s
        GROUP BY service_id, metric_id, bucket_id""", {"from": period_from, "to": period_to})

    # место каждого диапазона в списке диапазонов: id диапазона → 0, 1, 2, … (по порядку buckets).
    # По этому месту число случаев ляжет в нужную колонку. enumerate даёт пары (место, диапазон)
    bucket_position = {}
    for position, bucket in enumerate(buckets):
        bucket_position[bucket["id"]] = position

    # 5. Заготовка ответа: каждый сервис (ключ — id сервиса) получает поле counts —
    # для каждой метрики список из нулей, по нулю на диапазон (10 диапазонов):
    #   сервис 1
    #   ├── counts[1] (метрика 1) → [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    #   └── counts[2] (метрика 2) → [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    rows = {}
    for service in services:
        row = dict(service)   # копия строки сервиса — к ней добавим counts
        row["counts"] = {}
        for metric in metrics:
            row["counts"][metric["id"]] = [0] * len(buckets)   # [0] * 10 — список из десяти нулей
        rows[service["service_id"]] = row

    # 6. Раскладываем посчитанные случаи по сервисам, метрикам и колонкам-диапазонам:
    # например, у сервиса 4 по метрике 1 в диапазоне 21-30% (место 2) 5 случаев → counts[1][2] = 5
    for case in cases:
        position = bucket_position[case["bucket_id"]]
        rows[case["service_id"]]["counts"][case["metric_id"]][position] = case["cases"]

    return {
        "metrics": metrics,
        "buckets": buckets,
        "products": products,
        "months": months,                       # все месяцы для выбора: ['2025-09', …, '2026-10']
        "minDate": date_range["min_date"],      # дата самого раннего случая: '2025-09-01'
        "maxDate": date_range["max_date"],      # дата самого позднего случая: '2026-10-10'
        "from": period_from.isoformat(),        # период, за который отданы данные: с from ('2026-10-01')
        "to": period_to.isoformat(),            # по to включительно
        # values() — только сами строки, без ключей-id, чтобы в JSON вышел список, а не объект
        "rows": list(rows.values()),
    }
