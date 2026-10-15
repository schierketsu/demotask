"""JSON API дашборда на FastAPI. nginx (сервис frontend) передаёт сюда все запросы /api/*.

  GET /api/data?from=2026-01-01&to=2026-03-31
       данные дашборда за период с from по to включительно (без from и to — за последний месяц, где есть данные):
       метрики, диапазоны, продукты, список месяцев для выбора, первая и последняя дата случаев
       и строки «сервис → сколько случаев деградации в каждом диапазоне по каждой метрике».
       Месяц, год или произвольный диапазон выбирают на странице — сюда всегда приходят две даты.

  POST /api/cases — записать новый случай деградации (демонстрационная запись, только для роли editor):
       {"service_id": 4, "metric_id": 1, "bucket_id": 3, "case_date": "2026-10-14"}
       → 201 и созданная запись с id, created_at и created_by

  POST /api/cases/import — импорт случаев из CSV (только editor); тело запроса — текст файла в формате
       db/seed/degradation_case.csv. С ?dry_run=true — только проверка: сколько записей в какие сервисы и месяцы
       добавится и какие строки с ошибками (в базу ничего не пишется). Без него — проверка ещё раз и запись
       всех строк одной транзакцией → 201 {"added": 519}; если хоть одна строка с ошибкой — не пишется ничего

  GET /api/docs — описание API со страницей для пробных запросов (FastAPI строит её сам)

Все адреса /api/data и /api/cases… — только с токеном Keycloak в заголовке Authorization: Bearer … (см. auth.py):
читать — роль reader или editor, записывать — только editor.

Ошибки приходят в виде {"error": "текст"} с кодом 400 (неверные даты или данные), 401 (нет токена или он плохой),
403 (не хватает роли), 404 (в базе нет случаев или нет такого метода), 409 (данные поменялись во время импорта),
413 (файл слишком большой), 422 (тело запроса не по форме) или 500 (ошибка базы).

Запускает приложение uvicorn (см. Dockerfile): он принимает HTTP-запросы и вызывает функции этого файла.
"""

import logging
from datetime import date

import psycopg
from fastapi import Depends, FastAPI, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException

from .auth import User, can_read, can_write
from .cases import ImportFileError, case_date_error, check_rows, parse_csv, parse_date, summarize
from .data import NoCasesError, ServiceUnavailableError, add_case, add_cases, case_references, dashboard_data
from .db import connect

# журнал uvicorn: что сюда записать, видно в docker compose logs backend
logger = logging.getLogger("uvicorn.error")

# описание API — по адресам под /api/, чтобы nginx тоже передавал их сюда
app = FastAPI(title="Деградации", docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)

BAD_DATES = "Даты периода нужно указать в виде ГГГГ-ММ-ДД, например 2026-10-01"

# Файл импорта — не больше 1 МБ (десятки тысяч строк): столько же по умолчанию пропускает nginx
MAX_IMPORT_BYTES = 1024 * 1024
# Ошибок в ответе на проверку — не больше: остальные всё равно придётся исправлять по тем же причинам
MAX_ERRORS_SHOWN = 50


def respond(status: int, body: dict, headers: dict | None = None) -> JSONResponse:
    """Ответ браузеру: код status и body в виде JSON (русские буквы — как есть, а не \\u0410).

    no-store — браузер не хранит ответ: данные в базе могут поменяться. headers — дополнительные заголовки
    """
    return JSONResponse(body, status_code=status, headers={"Cache-Control": "no-store", **(headers or {})})


@app.get("/api/data", dependencies=[Depends(can_read)])
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


class NewCase(BaseModel):
    """Тело POST /api/cases. Лишние поля и строки вместо чисел не принимаем (extra="forbid", strict=True).

    Дата — строкой ГГГГ-ММ-ДД, поэтому для неё строгость выключена: FastAPI проверяет уже разобранный JSON,
    а строгий режим принял бы только готовый объект date
    """

    model_config = ConfigDict(extra="forbid", strict=True)

    service_id: int = Field(gt=0)
    metric_id: int = Field(gt=0)
    bucket_id: int = Field(gt=0)
    case_date: date = Field(strict=False)


@app.post("/api/cases", status_code=201)
def post_case(case: NewCase, user: User = Depends(can_write)) -> JSONResponse:
    """Записать новый случай деградации — только роль editor. Кто создал, запоминается в created_by"""
    date_problem = case_date_error(case.case_date, date.today())   # правила дат — в cases.py
    if date_problem is not None:
        return respond(400, {"error": f"Дата случая: {date_problem}"})

    try:
        with connect() as conn:   # при выходе из with без ошибки psycopg сам подтвердит запись (commit)
            created = add_case(conn, case.model_dump(), user.username)
    except ServiceUnavailableError:
        return respond(400, {"error": "Сервис не найден или в архиве"})
    except psycopg.errors.ForeignKeyViolation:
        return respond(400, {"error": "Нет такой метрики или диапазона"})
    except psycopg.Error:
        logger.exception("Ошибка базы данных")
        return respond(500, {"error": "Ошибка базы данных"})

    # кто и что записал — в журнал (docker compose logs backend); в базе это же — created_by и created_at
    logger.info("Случай деградации %s добавил пользователь %s: %s", created["id"], user.username, case.model_dump_json())
    # jsonable_encoder — даты и время в строки ISO 8601, иначе JSON их не примет
    return respond(201, jsonable_encoder(created))


@app.post("/api/cases/import")
async def import_cases(
    request: Request,
    dry_run: bool = Query(False, description="true — только проверить файл и вернуть сводку, ничего не записывая"),
    user: User = Depends(can_write),
) -> JSONResponse:
    """Импорт случаев из CSV — только роль editor. Тело запроса — текст файла (Content-Type: text/csv)"""
    # тело читаем сами: файл приходит как есть, без JSON. Проверка роли (can_write) уже прошла — до чтения тела
    body = await request.body()
    if len(body) > MAX_IMPORT_BYTES:
        return respond(413, {"error": "Файл больше 1 МБ — разбейте его на части"})
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        return respond(400, {"error": "Файл должен быть в кодировке UTF-8"})
    # работа с базой синхронная — в отдельном потоке, чтобы не держать остальные запросы
    return await run_in_threadpool(run_import, text, dry_run, user)


def run_import(text: str, dry_run: bool, user: User) -> JSONResponse:
    """Проверить CSV по справочникам из базы и либо вернуть сводку (dry_run), либо записать все строки разом"""
    try:
        header, rows = parse_csv(text)
    except ImportFileError as error:
        return respond(400, {"error": str(error)})

    try:
        with connect() as conn:   # проверка и запись — в одной транзакции; ошибка внутри — откат целиком
            refs = case_references(conn)
            cases, errors = check_rows(header, rows, refs, date.today())
            if dry_run:
                preview = summarize(cases, refs["services"])
                return respond(200, {
                    **preview,
                    "rowCount": len(rows),             # строк с данными в файле
                    "errorCount": len(errors),         # из них с ошибками
                    "errors": errors[:MAX_ERRORS_SHOWN],
                })
            if errors:
                return respond(400, {"error": f"Строк с ошибками: {len(errors)} — ничего не записано"})
            added = add_cases(conn, cases, user.username)
    except ServiceUnavailableError:
        return respond(409, {"error": "Пока шла проверка, часть сервисов убрали в архив — ничего не записано, "
                                      "проверьте файл ещё раз"})
    except psycopg.Error:
        logger.exception("Ошибка базы данных")
        return respond(500, {"error": "Ошибка базы данных"})

    logger.info("Импорт из CSV: пользователь %s добавил случаев деградации: %s", user.username, added)
    return respond(201, {"added": added})


@app.exception_handler(HTTPException)
def http_error(request: Request, error: HTTPException) -> JSONResponse:
    """Ошибки, которые возвращает сам FastAPI (например, такого адреса нет) или проверка входа (auth.py), —
    в том же виде {"error": "…"}; заголовки ошибки (WWW-Authenticate у 401) сохраняем"""
    text = "Неизвестный метод API" if error.status_code == 404 else str(error.detail)
    return respond(error.status_code, {"error": text}, error.headers)


@app.exception_handler(RequestValidationError)
def validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
    """Тело или параметры запроса не по форме (например, case_date не дата) — 422 в том же виде {"error": "…"}"""
    fields = ", ".join(".".join(str(part) for part in item["loc"][1:]) or "тело запроса" for item in error.errors())
    return respond(422, {"error": f"Неверные данные: {fields}"})
