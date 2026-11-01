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

try {
    $pdo = new PDO($dsn, $config['username'], $config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    $count = (int) $pdo->query("SELECT COUNT(*) FROM users WHERE role = 'admin'")->fetchColumn();
    if ($count > 0) {
        fwrite(STDERR, "An administrator account already exists.\n");
        exit(1);
    }

    $username = trim((string) readline('Admin username: '));
    if (!preg_match('/^[a-zA-Z0-9._-]{3,64}$/', $username)) {
        throw new RuntimeException('Use 3 to 64 letters, numbers, dots, underscores, or hyphens.');
    }
    $displayName = trim((string) readline('Admin full name: '));
    if (strlen($displayName) < 2 || strlen($displayName) > 120) {
        throw new RuntimeException('Enter a full name between 2 and 120 characters.');
    }
    fwrite(STDOUT, "Admin password (at least 12 characters): ");
    $password = trim((string) fgets(STDIN));
    if (strlen($password) < 12 || strlen($password) > 256) {
        throw new RuntimeException('Password must be between 12 and 256 characters.');
    }

    $statement = $pdo->prepare(
        "INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, 'admin', ?)"
    );
    $statement->execute([$username, password_hash($password, PASSWORD_DEFAULT), $displayName]);
    fwrite(STDOUT, "Administrator account created. Sign in through the evaluation system.\n");
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(1);
}
