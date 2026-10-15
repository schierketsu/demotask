"""Вход и права: access token Keycloak (OIDC) в заголовке Authorization: Bearer <токен>.

Токен страница получает у Keycloak сама (Authorization Code Flow с PKCE, frontend/src/auth.js)
и отправляет с каждым запросом к API. Здесь проверяем, что токен настоящий и наш:
  подпись — открытым ключом Keycloak (RS256; ключи скачиваются по KEYCLOAK_JWKS_URL и кэшируются);
  iss    — выдан нашим realm (KEYCLOAK_ISSUER — публичный адрес realm, тот, что видит браузер);
  aud    — выдан для этого API (KEYCLOAK_AUDIENCE), а не для чужого клиента;
  exp    — не истёк.
Роли — realm-роли пользователя из токена (realm_access.roles):
  reader — только чтение, editor — чтение и запись.

Нет токена или он не прошёл проверку — 401, токен хороший, но нужной роли нет — 403.
Адреса API подключают проверку через Depends(can_read) или Depends(can_write) — см. main.py.
"""

import logging
import os
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger("uvicorn.error")

ISSUER = os.environ["KEYCLOAK_ISSUER"]
AUDIENCE = os.environ["KEYCLOAK_AUDIENCE"]

# Ключи подписи Keycloak: скачиваются при первой проверке и живут в памяти 5 минут.
# Пришёл токен с ключом, которого нет в кэше (Keycloak сменил ключи), — PyJWKClient скачает их заново
jwks = jwt.PyJWKClient(os.environ["KEYCLOAK_JWKS_URL"], cache_keys=True, lifespan=300, timeout=5)

READER = "reader"
EDITOR = "editor"

# Токен из заголовка Authorization: Bearer …; auto_error=False — нет заголовка, отвечаем сами (401, а не 403).
# Заодно в /api/docs появляется кнопка Authorize
bearer = HTTPBearer(auto_error=False, description="Access token Keycloak (realm degradations)")


@dataclass(frozen=True)
class User:
    """Кто прислал запрос — из проверенного токена"""

    username: str
    roles: frozenset[str]


def unauthorized(text: str) -> HTTPException:
    """401 с заголовком WWW-Authenticate — так по стандарту отвечают, когда нужен Bearer-токен"""
    return HTTPException(status_code=401, detail=text, headers={"WWW-Authenticate": "Bearer"})


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> User:
    """Проверить токен из запроса и вернуть пользователя. Токена нет или он плохой — 401"""
    if credentials is None:
        raise unauthorized("Нужно войти: запрос без токена")

    token = credentials.credentials
    try:
        key = jwks.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],   # только то, чем подписывает Keycloak, — подделать алгоритм в токене не выйдет
            audience=AUDIENCE,
            issuer=ISSUER,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.PyJWKClientConnectionError:
        # Keycloak недоступен — дело не в токене: подробности в журнал, пользователю — 503
        logger.exception("Не удалось получить ключи Keycloak")
        raise HTTPException(status_code=503, detail="Сервер авторизации недоступен") from None
    except jwt.ExpiredSignatureError:
        raise unauthorized("Срок действия токена истёк — войдите заново") from None
    except (jwt.InvalidTokenError, jwt.PyJWKClientError):
        raise unauthorized("Недействительный токен") from None

    roles = claims.get("realm_access", {}).get("roles", [])
    return User(username=claims.get("preferred_username", claims["sub"]), roles=frozenset(roles))


def require_roles(*allowed: str):
    """Проверка для адреса API: пользователь вошёл (иначе 401) и у него есть хотя бы одна из ролей allowed (иначе 403)"""

    def check(user: User = Depends(current_user)) -> User:
        if user.roles.isdisjoint(allowed):
            raise HTTPException(status_code=403, detail=f"Недостаточно прав: нужна роль {' или '.join(allowed)}")
        return user

    return check


can_read = require_roles(READER, EDITOR)   # смотреть дашборд: reader и editor
can_write = require_roles(EDITOR)          # менять данные: только editor
