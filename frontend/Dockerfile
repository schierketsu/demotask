# 1. Сборка: Node собирает React-приложение в обычные файлы html, js и css (папка dist)
FROM node:24-alpine AS build
WORKDIR /app
# сначала только списки библиотек: пока они не меняются, Docker берёт установленные библиотеки из кэша
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# realm и клиент Keycloak (compose.yaml, build.args): Vite вписывает переменные VITE_* в собранный код (src/auth.js)
ARG VITE_KEYCLOAK_REALM
ARG VITE_KEYCLOAK_CLIENT_ID
RUN npm run build

# 2. Раздача: nginx отдаёт собранные файлы и передаёт /api/ в backend. Node в итоговом образе уже не нужен
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
