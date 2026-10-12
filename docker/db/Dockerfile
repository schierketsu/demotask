FROM postgres:18

# Русская локаль для libc (LC_CTYPE / сообщения сервера); сортировка — через ICU (см. POSTGRES_INITDB_ARGS)
RUN localedef -i ru_RU -c -f UTF-8 \
    -A /usr/share/locale/locale.alias \
    ru_RU.UTF-8

ENV LANG=ru_RU.UTF-8
