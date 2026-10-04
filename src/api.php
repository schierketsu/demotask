<?php

declare(strict_types=1);

/*
 * JSON API дашборда. nginx направляет сюда все запросы /api/*.
 *
 *   GET /api/meta                    метрики, диапазоны, категории
 *   GET /api/dashboard[?category=ID] KPI, распределение по диапазонам, значения по сервисам
 */

function db(): PDO
{
    $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s', getenv('DB_HOST'), getenv('DB_PORT'), getenv('DB_NAME'));

    return new PDO($dsn, getenv('DB_USER'), getenv('DB_PASSWORD'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
}

function query(PDO $pdo, string $sql, array $params = []): array
{
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll();
}

function respond(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function meta(PDO $pdo): array
{
    return [
        'metrics' => query($pdo, 'SELECT id, name FROM metric ORDER BY id'),
        'buckets' => query($pdo, 'SELECT id, label, pct_from, pct_to FROM bucket ORDER BY id'),
        'categories' => query($pdo, 'SELECT id, name FROM category ORDER BY id'),
    ];
}

/** $categoryId = null — по всем категориям. «Глубокая» деградация — диапазоны выше 50% */
function dashboard(PDO $pdo, ?int $categoryId): array
{
    $where = '';
    $params = [];
    if ($categoryId !== null) {
        if (!query($pdo, 'SELECT 1 FROM category WHERE id = ?', [$categoryId])) {
            respond(404, ['error' => 'Категория не найдена']);
        }
        $where = 'WHERE o.category_id = :cat';
        $params = ['cat' => $categoryId];
    }

    $from = "FROM degradation d
             JOIN service s   ON s.id = d.service_id
             JOIN operation o ON o.id = s.operation_id
             JOIN category c  ON c.id = o.category_id
             JOIN bucket b    ON b.id = d.bucket_id
             {$where}";

    $kpi = query($pdo, "
        SELECT d.metric_id,
               SUM(d.cnt)                                             AS total,
               COUNT(DISTINCT d.service_id) FILTER (WHERE d.cnt > 0)  AS services_affected,
               COALESCE(SUM(d.cnt) FILTER (WHERE b.pct_from > 50), 0) AS severe
        {$from}
        GROUP BY d.metric_id
        ORDER BY d.metric_id", $params);

    $byBucket = query($pdo, "
        SELECT d.metric_id, d.bucket_id, SUM(d.cnt) AS cnt
        {$from}
        GROUP BY d.metric_id, d.bucket_id
        ORDER BY d.metric_id, d.bucket_id", $params);

    // по строке на сервис и метрику: значения по диапазонам одним массивом, как строка в Excel
    $cells = query($pdo, "
        SELECT c.id AS category_id, c.name AS category,
               o.id AS operation_id, o.num AS operation_num, o.name AS operation,
               s.id AS service_id, s.name AS service,
               d.metric_id, json_agg(d.cnt ORDER BY d.bucket_id) AS counts
        {$from}
        GROUP BY c.id, o.id, s.id, d.metric_id
        ORDER BY c.id, o.num, s.id, d.metric_id", $params);

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
            'counts' => [],
        ];
        $rows[$id]['counts'][$cell['metric_id']] = json_decode($cell['counts']);
    }

    return [
        'services_total' => count($rows),
        'kpi' => $kpi,
        'by_bucket' => $byBucket,
        'rows' => array_values($rows),
    ];
}

$route = trim(preg_replace('#^/api#', '', parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH)), '/');
$category = $_GET['category'] ?? '';

if ($category !== '' && (!is_string($category) || !ctype_digit($category))) {
    respond(400, ['error' => 'Параметр category должен быть целым числом']);
}

try {
    $pdo = db();
    match ($route) {
        'meta' => respond(200, meta($pdo)),
        'dashboard' => respond(200, dashboard($pdo, $category === '' ? null : (int) $category)),
        default => respond(404, ['error' => 'Неизвестный метод API']),
    };
} catch (PDOException $e) {
    error_log((string) $e);
    respond(500, ['error' => 'Ошибка базы данных']);
}
