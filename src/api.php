<?php

declare(strict_types=1); //строгий режим (без приведения типов)

/*
 * JSON API дашборда. nginx направляет сюда все запросы /api/*.
 *
 *   GET /api/data  метрики, диапазоны, группы операций и проценты деградации случаев по сервисам
 */

function db(): PDO
{
    $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s', getenv('DB_HOST'), getenv('DB_PORT'), getenv('DB_NAME'));

    return new PDO($dsn, getenv('DB_USER'), getenv('DB_PASSWORD'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
}

function query(PDO $pdo, string $sql): array
{
    return $pdo->query($sql)->fetchAll();
}

// never — функция не возвращается туда, откуда её вызвали: в конце exit завершает скрипт
function respond(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function data(PDO $pdo): array
{
    // 1. Справочники: метрики, диапазоны и категории — просто списки из таблиц
    $metrics = query($pdo, 'SELECT id, name FROM metric ORDER BY id');
    $buckets = query($pdo, 'SELECT id, label, pct_from, pct_to FROM bucket ORDER BY id');
    $categories = query($pdo, 'SELECT id, name FROM category ORDER BY id');

    // 2. Сервисы вместе с названиями их операции и категории — по одной строке на сервис
    $services = query($pdo, "
        SELECT category.id    AS category_id,
               category.name  AS category,
               operation.id   AS operation_id,
               operation.num  AS operation_num,
               operation.name AS operation,
               service.id     AS service_id,
               service.name   AS service
        FROM service
        JOIN operation ON operation.id = service.operation_id   -- к сервису — его операция
        JOIN category  ON category.id = operation.category_id   -- к операции — её категория
        ORDER BY category.id, operation.num, service.id");

    // 3. Все случаи деградации — по возрастанию процента
    $cases = query($pdo, 'SELECT service_id, metric_id, pct FROM degradation_case ORDER BY pct');

    // 4. Заводим запись на каждый сервис; для каждой метрики — пока пустой список процентов
    $rows = [];
    foreach ($services as $service) {
        $id = $service['service_id'];
        $rows[$id] = $service;
        $rows[$id]['pcts'] = [];
        foreach ($metrics as $metric) {
            $rows[$id]['pcts'][$metric['id']] = [];
        }
    }

    // 5. Раскладываем каждый случай в список своего сервиса и своей метрики
    foreach ($cases as $case) {
        $serviceId = $case['service_id'];
        $metricId = $case['metric_id'];
        $rows[$serviceId]['pcts'][$metricId][] = $case['pct'];   // [] = «добавить в конец списка»
    }

    return [
        'metrics' => $metrics,
        'buckets' => $buckets,
        'categories' => $categories,
        // array_values убирает ключи-id: [4 => …, 7 => …] → […, …], чтобы в JSON вышел список, а не объект
        'rows' => array_values($rows),
    ];
}

// Из адреса запроса достаём имя метода API: "/api/data?x=1" -> "data"
$uri = $_SERVER['REQUEST_URI'];                      // адрес целиком:              "/api/data?x=1"
//$_SERVER — встроенный массив PHP со сведениями о текущем запросе. Его заполняет сам PHP на основе того, что передал nginx.
$path = parse_url($uri, PHP_URL_PATH);               // без параметров после «?»:   "/api/data"
$withoutPrefix = preg_replace('#^/api#', '', $path); // без «/api» в начале:        "/data"
$route = trim($withoutPrefix, '/');                  // без слэшей по краям:        "data"

try {
    if ($route === 'data') {
        // Сначала db() открывает соединение с базой.
        // Его передаём в data(), которая выполняет запросы
        // и собирает данные в массив. Этот массив respond()
        // отправляет браузеру в формате JSON с кодом 200.
        $pdo = db();                // подключаемся к базе
        $body = data($pdo);         // достаём из базы все данные для дашборда
        respond(200, $body);        // 200 — всё хорошо, отдаём данные
    } else {
        // запросили метод, которого нет
        respond(404, ['error' => 'Неизвестный метод API']);
    }
} catch (PDOException $e) {
    // сломалась база (не подключились или ошибка в запросе):
    // подробности — в лог сервера, пользователю — короткое сообщение без внутренностей
    error_log((string) $e);
    respond(500, ['error' => 'Ошибка базы данных']);
}