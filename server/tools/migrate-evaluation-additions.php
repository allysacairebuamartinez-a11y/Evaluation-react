<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$config = require __DIR__ . '/../api/config.php';
$dsn = sprintf(
    'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
    $config['host'],
    $config['port'],
    $config['database']
);
$pdo = new PDO($dsn, $config['username'], $config['password'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);

$pdo->exec(
    "CREATE TABLE IF NOT EXISTS activity_logs (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       user_id INT UNSIGNED NULL,
       actor_name VARCHAR(120) NOT NULL,
       actor_role ENUM('admin', 'dean') NOT NULL,
       action VARCHAR(80) NOT NULL,
       details VARCHAR(255) NOT NULL DEFAULT '',
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (id),
       KEY idx_activity_logs_created (created_at),
       KEY idx_activity_logs_user (user_id),
       CONSTRAINT fk_activity_logs_user
         FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
     ) ENGINE=InnoDB"
);

$columns = $pdo->query('SHOW COLUMNS FROM activity_logs')->fetchAll(PDO::FETCH_COLUMN);
$required = ['id', 'actor_name', 'actor_role'];
$schemas = [
    ['user_id', 'action', 'details', 'created_at'],
    ['actor_user_id', 'action_type', 'description', 'occurred_at'],
];
$compatible = false;
foreach ($schemas as $schema) {
    if (array_diff(array_merge($required, $schema), $columns) === []) {
        $compatible = true;
        break;
    }
}
if (!$compatible) {
    throw new RuntimeException('The existing activity_logs table has an unsupported schema. It was left unchanged.');
}

fwrite(STDOUT, "Activity log table is ready. Existing application records were not modified.\n");
