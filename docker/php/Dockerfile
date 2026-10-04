FROM php:8.4-fpm-alpine

# Расширение pdo_pgsql для доступа к PostgreSQL; dev-пакеты нужны только на время сборки
RUN apk add --no-cache libpq \
 && apk add --no-cache --virtual .build-deps $PHPIZE_DEPS libpq-dev \
 && docker-php-ext-install pdo_pgsql \
 && apk del .build-deps

WORKDIR /var/www
