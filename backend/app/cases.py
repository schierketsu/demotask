"""Новые случаи деградации: проверка — одной записи (POST /api/cases) и пачки из CSV (POST /api/cases/import) —
и предпросмотр импорта.

Правила одни для обоих путей: сервис существует и не в архиве, метрика и диапазон существуют, дата — ГГГГ-ММ-ДД,
не раньше 2000 года и не в будущем. Нижняя граница — чтобы дата из далёкого прошлого не растянула список месяцев
на странице на века; «будущее» — с запасом в сутки: сервер считает «сегодня» по UTC, а в Москве после полуночи
уже завтра.

CSV — в формате db/seed/degradation_case.csv: заголовок service_id,metric_id,bucket_id,case_date и строки
вида 4,1,3,2026-10-08. Разделитель «;» тоже подходит (так сохраняет CSV Excel с русской локалью).
"""

import csv
import io
import re
from datetime import date, timedelta

CASE_MIN_DATE = date(2000, 1, 1)
TIMEZONE_SLACK = timedelta(days=1)

COLUMNS = ("service_id", "metric_id", "bucket_id", "case_date")
ID_COLUMNS = ("service_id", "metric_id", "bucket_id")
MAX_ROWS = 20_000   # больше строк в одном файле не принимаем

DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}")
ID_PATTERN = re.compile(r"[1-9]\d{0,8}")   # целое больше нуля, не длиннее 9 цифр — помещается в int базы


class ImportFileError(Exception):
    """Файл целиком не годится: пустой, не те колонки, слишком много строк"""


def case_date_error(value: date, today: date) -> str | None:
    """Почему дата случая не подходит, или None — подходит"""
    if value < CASE_MIN_DATE:
        return "дата раньше 2000 года"
    if value > today + TIMEZONE_SLACK:
        return "дата в будущем"
    return None


def parse_csv(text: str) -> tuple[list[str], list[tuple[int, list[str]]]]:
    """Текст CSV → (колонки из заголовка, [(номер строки в файле, значения строки текстом)]).

    Проверяет только файл целиком (заголовок, есть ли строки, не слишком ли их много); строки — check_rows
    """
    text = text.lstrip("﻿")   # BOM — Excel ставит его в начало файла в UTF-8
    first_line = text.split("\n", 1)[0]
    if not first_line.strip():
        raise ImportFileError("Файл пустой")
    delimiter = ";" if ";" in first_line and "," not in first_line else ","

    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    header = [name.strip() for name in next(reader)]
    if sorted(header) != sorted(COLUMNS):
        raise ImportFileError(f"Нужны колонки {', '.join(COLUMNS)} — как в db/seed/degradation_case.csv")

    rows = []
    for values in reader:
        if not any(value.strip() for value in values):
            continue   # пустая строка (например, в конце файла)
        if len(rows) == MAX_ROWS:
            raise ImportFileError(f"Слишком много строк: в одном файле — не больше {MAX_ROWS}")
        rows.append((reader.line_num, [value.strip() for value in values]))
    if not rows:
        raise ImportFileError("В файле нет строк с данными")
    return header, rows


def check_rows(header: list[str], rows: list[tuple[int, list[str]]], refs: dict, today: date) -> tuple[list[dict], list[dict]]:
    """Проверить строки CSV по справочникам из базы (data.case_references).

    Возвращает (годные случаи [{'service_id': 4, 'metric_id': 1, 'bucket_id': 3, 'case_date': date(…)}],
    ошибки [{'line': 5, 'error': 'нет сервиса с id 99'}]) — у строки может быть несколько причин сразу
    """
    cases = []
    errors = []
    for line, values in rows:
        problems = []
        if len(values) != len(header):
            problems.append(f"значений {len(values)}, а нужно {len(header)}")
        else:
            raw = dict(zip(header, values))
            case = {}
            for column in ID_COLUMNS:
                if ID_PATTERN.fullmatch(raw[column]):
                    case[column] = int(raw[column])
                else:
                    problems.append(f"{column} «{raw[column]}» — не целое число больше нуля")

            if "service_id" in case:
                service = refs["services"].get(case["service_id"])
                if service is None:
                    problems.append(f"нет сервиса с id {case['service_id']}")
                elif not service["is_active"]:
                    problems.append(f"сервис «{service['name']}» в архиве")
            if "metric_id" in case and case["metric_id"] not in refs["metrics"]:
                problems.append(f"нет метрики с id {case['metric_id']}")
            if "bucket_id" in case and case["bucket_id"] not in refs["buckets"]:
                problems.append(f"нет диапазона с id {case['bucket_id']}")

            case_date = parse_date(raw["case_date"])
            if case_date is None:
                problems.append(f"case_date «{raw['case_date']}» — нужна дата ГГГГ-ММ-ДД")
            else:
                date_problem = case_date_error(case_date, today)
                if date_problem is not None:
                    problems.append(date_problem)
                case["case_date"] = case_date

        if problems:
            errors.append({"line": line, "error": "; ".join(problems)})
        else:
            cases.append(case)
    return cases, errors


def parse_date(value: str) -> date | None:
    """'2026-02-28' → дата; '2026-02-30', '28.02.2026', 'abc' → None"""
    if not DATE_PATTERN.fullmatch(value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def summarize(cases: list[dict], services: dict) -> dict:
    """Предпросмотр импорта: годные строки файла и названия их сервисов.

    {'total': 137,
     'services': [{'service_id': 4, 'service': '…', 'operation': '…'}, …] — сервисы, в которые добавятся записи,
         в порядке дашборда,
     'records': [{'service_id': 4, 'metric_id': 1, 'bucket_id': 3, 'case_date': '2026-10-08'}, …] — годные строки
         файла в его порядке; названия метрик и диапазонов у страницы уже есть (GET /api/data)}
    """
    used = {case["service_id"] for case in cases}
    rows = [
        {"service_id": service_id, "service": service["name"], "operation": service["operation"]}
        for service_id, service in services.items()   # services — в порядке дашборда (data.case_references)
        if service_id in used
    ]
    records = [{**case, "case_date": case["case_date"].isoformat()} for case in cases]   # дата → '2026-10-08' для JSON
    return {"total": len(cases), "services": rows, "records": records}
