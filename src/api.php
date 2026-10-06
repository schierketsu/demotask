<?php

declare(strict_types=1);

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
    // по строке на сервис и метрику: проценты деградации всех случаев одним массивом;
    // сервис без случаев тоже попадает в ответ — с пустым массивом
    $cells = query($pdo, "
        SELECT c.id AS category_id, c.name AS category,
               o.id AS operation_id, o.num AS operation_num, o.name AS operation,
               s.id AS service_id, s.name AS service,
               m.id AS metric_id,
               COALESCE(json_agg(d.pct ORDER BY d.pct) FILTER (WHERE d.pct IS NOT NULL), '[]') AS pcts
        FROM service s
                 JOIN operation o ON o.id = s.operation_id
                 JOIN category c  ON c.id = o.category_id
                 CROSS JOIN metric m
                 LEFT JOIN degradation_case d ON d.service_id = s.id AND d.metric_id = m.id
        GROUP BY c.id, o.id, s.id, m.id
        ORDER BY c.id, o.num, s.id, m.id");

    $rows = [];
    foreach ($cells as $cell) {
        $id = $cell['service_id'];
        $rows[$id] ??= [
            'category_id' => $cell['category_id'],
            'category' => $cell['category'],
            'operation_id' => $cell['operation_id'],
            'operation_num' => $cell['operation_num'],
            'operation' => $cell['operation'],
            'service_id' => $id,
            'service' => $cell['service'],
            'pcts' => [],
        ];
        $rows[$id]['pcts'][$cell['metric_id']] = json_decode($cell['pcts']);
    }

    return [
        'metrics' => query($pdo, 'SELECT id, name FROM metric ORDER BY id'),
        'buckets' => query($pdo, 'SELECT id, label, pct_from, pct_to FROM bucket ORDER BY id'),
        'categories' => query($pdo, 'SELECT id, name FROM category ORDER BY id'),
        'rows' => array_values($rows),
    ];
}

$route = trim(preg_replace('#^/api#', '', parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH)), '/');

try {
    match ($route) {
        'data' => respond(200, data(db())),
        default => respond(404, ['error' => 'Неизвестный метод API']),
    };
} catch (PDOException $e) {
    error_log((string) $e);
    respond(500, ['error' => 'Ошибка базы данных']);
}
