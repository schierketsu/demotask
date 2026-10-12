"""Подключение к базе PostgreSQL и выполнение запросов.

Адрес, имя базы, логин и пароль — из переменных окружения, их задаёт compose.yaml (сервис backend, раздел environment).
"""

import os

import psycopg
from psycopg.rows import dict_row


def connect() -> psycopg.Connection:
    """Открыть соединение с базой. Строки результата приходят словарями: {'id': 1, 'name': '…'}"""
    return psycopg.connect(
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"],
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        row_factory=dict_row,   # строка результата → словарь «имя колонки → значение», а не кортеж
    )


def query(conn: psycopg.Connection, sql: str, params: dict | None = None) -> list[dict]:
    """Выполнить SQL-запрос и вернуть все строки результата: [{'id': 1, 'name': '…'}, …].

    params — значения для меток в запросе: {'from': date(2026, 10, 1)} подставится вместо %(from)s.
    Значения уходят в базу отдельно от текста запроса, поэтому то, что пришло из адреса,
    не может изменить сам SQL (защита от SQL-инъекций)
    """
    return conn.execute(sql, params).fetchall()
