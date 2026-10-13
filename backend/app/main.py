"""JSON API дашборда на FastAPI. nginx (сервис frontend) передаёт сюда все запросы /api/*.

  GET /api/data?from=2026-01-01&to=2026-03-31
       данные дашборда за период с from по to включительно (без from и to — за последний месяц, где есть данные):
       метрики, диапазоны, продукты, список месяцев для выбора, первая и последняя дата случаев
       и строки «сервис → сколько случаев деградации в каждом диапазоне по каждой метрике».
       Месяц, год или произвольный диапазон выбирают на странице — сюда всегда приходят две даты.

  GET /api/docs — описание API со страницей для пробных запросов (FastAPI строит её сам)

Ошибки приходят в виде {"error": "текст"} с кодом 400 (неверные даты), 404 (в базе нет случаев или нет такого метода)
или 500 (ошибка базы).

Запускает приложение uvicorn (см. Dockerfile): он принимает HTTP-запросы и вызывает функции этого файла.
"""

import logging
import re
from datetime import date

import psycopg
from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from .data import NoCasesError, dashboard_data
from .db import connect

# журнал uvicorn: что сюда записать, видно в docker compose logs backend
logger = logging.getLogger("uvicorn.error")

# описание API — по адресам под /api/, чтобы nginx тоже передавал их сюда
app = FastAPI(title="Деградации", docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)

# дата вида ГГГГ-ММ-ДД: 4 цифры, дефис, 2 цифры, дефис, 2 цифры
DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}")
BAD_DATES = "Даты периода нужно указать в виде ГГГГ-ММ-ДД, например 2026-10-01"


def respond(status: int, body: dict) -> JSONResponse:
    """Ответ браузеру: код status и body в виде JSON (русские буквы — как есть, а не \\u0410).

    no-store — браузер не хранит ответ: данные в базе могут поменяться
    """
    return JSONResponse(body, status_code=status, headers={"Cache-Control": "no-store"})


def parse_date(value: str) -> date | None:
    """Строка ГГГГ-ММ-ДД → дата: '2026-02-28' — да; '2026-02-30', '2026-2-1', 'abc' — None.

    Сначала проверяем вид (date.fromisoformat понимает и другие записи, например 20260228),
    потом — что такой день есть в календаре: 30 февраля fromisoformat не примет
    """
    if not DATE_PATTERN.fullmatch(value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None

#одна единственная ручка
@app.get("/api/data")
def get_data(
    # from — зарезервированное слово Python, поэтому в коде period_from, а в адресе — from (alias)
    period_from: str = Query("", alias="from"),
    period_to: str = Query("", alias="to"),
) -> JSONResponse:
    """Данные дашборда за период: /api/data?from=2026-01-01&to=2026-03-31; без from и to — за последний месяц"""
    # либо обе даты пустые (последний месяц), либо обе — настоящие даты ГГГГ-ММ-ДД
    if period_from == "" and period_to == "":
        start = end = None
    else:
        start = parse_date(period_from)
        end = parse_date(period_to)
        if start is None or end is None:
            return respond(400, {"error": BAD_DATES})
        if start > end:
            return respond(400, {"error": "Начало периода позже его конца"})

    try:
        # with — соединение закроется само, даже если запрос упадёт с ошибкой
        with connect() as conn: #connect из db.py, возвращает psycopg.Connection
            body = dashboard_data(conn, start, end) #dashboard_data из data.py, возвращает словарь с данными дашборда
    except NoCasesError:
        return respond(404, {"error": "В базе нет случаев деградации"})
    except psycopg.Error:
        # сломалась база (не подключились или ошибка в запросе):
        # подробности — в журнал (docker compose logs backend), пользователю — короткое сообщение без внутренностей
        logger.exception("Ошибка базы данных")
        return respond(500, {"error": "Ошибка базы данных"})

    return respond(200, body)   # 200 — всё хорошо, отдаём данные в JSON


@app.exception_handler(HTTPException)
def http_error(request: Request, error: HTTPException) -> JSONResponse:
    """Ошибки, которые возвращает сам FastAPI (например, такого адреса нет), — в том же виде {"error": "…"}"""
    text = "Неизвестный метод API" if error.status_code == 404 else str(error.detail)
    return respond(error.status_code, {"error": text})
