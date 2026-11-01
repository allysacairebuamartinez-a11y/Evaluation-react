<?php
declare(strict_types=1);

return [
    'host' => getenv('OLPCSMI_DB_HOST') ?: '127.0.0.1',
    'port' => getenv('OLPCSMI_DB_PORT') ?: '3306',
    'database' => getenv('OLPCSMI_DB_NAME') ?: 'olpcsmi_evaluation_v2',
    'username' => getenv('OLPCSMI_DB_USER') ?: 'root',
    'password' => getenv('OLPCSMI_DB_PASSWORD') ?: '',
];
