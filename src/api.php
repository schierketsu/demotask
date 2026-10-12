<?php

declare(strict_types=1); // строгие типы: если функция ждёт int, а ей передали строку "5", будет ошибка, а не тихое превращение в 5

/*
 * JSON API дашборда. nginx направляет сюда все запросы /api/* (см. docker/nginx/default.conf).
 *
 *   GET /api/data?month=2026-10  данные дашборда за месяц (без month — за последний месяц, где есть данные):
 *                                метрики, диапазоны, продукты, список месяцев для выбора
 *                                и строки «сервис → сколько случаев деградации в каждом диапазоне по каждой метрике»
 *
 * Ошибки приходят в виде {"error": "текст"} с кодом 400 (неверный месяц), 404 (нет такого месяца или метода)
 * или 500 (ошибка базы).
 */

// Подключение к базе. Адрес, имя базы, логин и пароль — из переменных окружения,
// их задаёт compose.yaml (сервис php, раздел environment)
function db(): PDO // функция обязана вернуть объект PDO — соединение с базой
{
    $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s', getenv('DB_HOST'), getenv('DB_PORT'), getenv('DB_NAME'));

    return new PDO($dsn, getenv('DB_USER'), getenv('DB_PASSWORD'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,       // ошибка базы → исключение PDOException (его ловит catch внизу)
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,  // строка результата → массив вида ['id' => 1, 'name' => '…']
    ]);
}

// Выполнить SQL-запрос и вернуть все строки результата.
// $params — значения для меток в запросе: ['month' => '2026-10'] подставится вместо :month.
// prepare + execute передают значения в базу отдельно от текста запроса,
// поэтому то, что пришло из адреса, не может изменить сам SQL (защита от SQL-инъекций)
function query(PDO $pdo, string $sql, array $params = []): array
{
    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    return $statement->fetchAll();
}


// Отправить браузеру ответ: код $status и $body в виде JSON — и завершить скрипт.
// never — функция не возвращается туда, откуда её вызвали: в конце exit завершает скрипт.
//
// Порядок важен: сначала код и заголовки, потом тело. По умолчанию PHP отвечает
//   HTTP/1.1 200 OK
//   Content-Type: text/html
// и отправляет эти заголовки вместе с первым выведенным байтом тела. Если сначала сделать echo,
// уйдут именно они, а вызванные после http_response_code и header уже ничего не изменят
function respond(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');   // браузер не хранит ответ: данные в базе могут поменяться
    echo json_encode($body, JSON_UNESCAPED_UNICODE);   // JSON_UNESCAPED_UNICODE — русские буквы как есть, а не А
    exit;
}

// Собрать данные дашборда за месяц.
// $month — выбранный месяц «2026-10»; пустая строка — последний месяц, за который есть данные
function data(PDO $pdo, string $month): array
{
    // 1. Справочники: метрики, диапазоны и продукты — просто списки из таблиц
    $metrics = query($pdo, 'SELECT id, name FROM metric ORDER BY id');
    $buckets = query($pdo, 'SELECT id, label, pct_from, pct_to FROM bucket ORDER BY id');
    $products = query($pdo, 'SELECT id, name FROM product ORDER BY id');

    // 2. Месяцы для выбора: подряд от месяца самого раннего случая до месяца самого позднего.
    // generate_series выдаёт каждый месяц этого промежутка, поэтому месяц без аварий тоже попадёт в список.
    // Если случаев нет совсем, список будет пустым
    $monthRows = query($pdo, "
        SELECT to_char(month_start, 'YYYY-MM') AS month
        FROM generate_series(
            (SELECT date_trunc('month', min(case_date)) FROM degradation_case),
            (SELECT date_trunc('month', max(case_date)) FROM degradation_case),
            interval '1 month'
        ) AS month_start
        ORDER BY month_start");
    $months = array_column($monthRows, 'month');   // [['month' => '2025-09'], …] → ['2025-09', …]

    if ($month === '' && count($months) > 0) {
        $month = $months[count($months) - 1];     // месяц не выбран — берём последний
    } elseif ($month !== '' && !in_array($month, $months, true)) {
        // месяц указан, но его нет в списке (раньше первого, позже последнего или вроде 2026-13)
        respond(404, ['error' => 'Нет данных за этот месяц']);
    }

    // 3. Все сервисы, по строке на сервис, с его операцией и продуктом.
    // Сервисы без случаев деградации тоже здесь: в таблице дашборда у них будут нули
    $services = query($pdo, "
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
        ORDER BY product.id, operation.num, service.id");

    // 4. Сколько случаев деградации выбранного месяца у каждого сервиса в каждом диапазоне по каждой метрике.
    // to_char превращает дату случая в «2026-10» — сравниваем с месяцем; count(*) считает случаи в группе.
    // Сочетаний без случаев здесь нет — для них останутся нули из шага 5
    $cases = query($pdo, "
        SELECT service_id, metric_id, bucket_id, count(*) AS cases
        FROM degradation_case
        WHERE to_char(case_date, 'YYYY-MM') = :month
        GROUP BY service_id, metric_id, bucket_id", ['month' => $month]);

    // место каждого диапазона в списке диапазонов: id диапазона → 0, 1, 2, … (по порядку $buckets).
    // По этому месту число случаев ляжет в нужную колонку
    $bucketPosition = [];
    foreach ($buckets as $position => $bucket) {
        $bucketPosition[$bucket['id']] = $position;
    }

    // 5. Заготовка ответа: каждый сервис (ключ — id сервиса) получает поле counts —
    // для каждой метрики список из нулей, по нулю на диапазон (10 диапазонов):
    //   сервис 1
    //   ├── counts[1] (метрика 1) → [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    //   └── counts[2] (метрика 2) → [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    $rows = [];
    foreach ($services as $service) {
        $id = $service['service_id'];
        $rows[$id] = $service;
        $rows[$id]['counts'] = [];
        foreach ($metrics as $metric) {
            $rows[$id]['counts'][$metric['id']] = array_fill(0, count($buckets), 0);   // список из нулей
        }
    }

    // 6. Раскладываем посчитанные случаи по сервисам, метрикам и колонкам-диапазонам:
    // например, у сервиса 4 по метрике 1 в диапазоне 21-30% (место 2) 5 случаев → counts[1][2] = 5
    foreach ($cases as $case) {
        $serviceId = $case['service_id'];
        $metricId = $case['metric_id'];
        $position = $bucketPosition[$case['bucket_id']];
        $rows[$serviceId]['counts'][$metricId][$position] = $case['cases'];
    }

    return [
        'metrics' => $metrics,
        'buckets' => $buckets,
        'products' => $products,
        'months' => $months,   // все месяцы для выбора: ['2025-09', …, '2026-10']
        'month' => $month,     // месяц, за который отданы данные
        // array_values убирает ключи-id: [4 => …, 7 => …] → […, …], чтобы в JSON вышел список, а не объект
        'rows' => array_values($rows),
    ];
}

// Из адреса запроса достаём имя метода API: "/api/data?x=1" -> "data".
// $_SERVER — встроенный массив PHP со сведениями о текущем запросе; его заполняет PHP из того, что передал nginx
$uri = $_SERVER['REQUEST_URI'];                      // адрес целиком:              "/api/data?x=1"
$path = parse_url($uri, PHP_URL_PATH);               // без параметров после «?»:   "/api/data"
$withoutPrefix = preg_replace('#^/api#', '', $path); // без «/api» в начале:        "/data"
$route = trim($withoutPrefix, '/');                  // без слэшей по краям:        "data"

try {
    if ($route === 'data') {
        // выбранный месяц из адреса: "/api/data?month=2026-10" → "2026-10"; не указан — пустая строка
        $month = $_GET['month'] ?? '';
        // принимаем только вид ГГГГ-ММ (4 цифры, дефис, 2 цифры); есть ли такой месяц в данных — проверит data().
        // is_string — на случай ?month[]=…, там придёт массив
        if (!is_string($month) || ($month !== '' && preg_match('/^\d{4}-\d{2}$/', $month) !== 1)) {
            respond(400, ['error' => 'Месяц нужно указать в виде ГГГГ-ММ, например 2026-10']);
        }
        // '4 цифры - 2 цифры' шаблон регулярки

        $pdo = db();                // подключаемся к базе
        $body = data($pdo, $month); // собираем данные дашборда за выбранный месяц
        respond(200, $body);        // 200 — всё хорошо, отдаём данные в JSON
    } else {
        // запросили метод, которого нет
        respond(404, ['error' => 'Неизвестный метод API']);
    }
} catch (PDOException $e) {
    // сломалась база (не подключились или ошибка в запросе):
    // подробности — в лог сервера (docker compose logs php), пользователю — короткое сообщение без внутренностей
    error_log((string) $e);
    respond(500, ['error' => 'Ошибка базы данных']);
}
