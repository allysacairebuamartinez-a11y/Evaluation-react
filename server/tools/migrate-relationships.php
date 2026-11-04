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
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);

$database = $config['database'];
$columnExists = static function (string $table, string $column) use ($pdo, $database): bool {
    $statement = $pdo->prepare(
        'SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    );
    $statement->execute([$database, $table, $column]);
    return (bool) $statement->fetchColumn();
};
$indexExists = static function (string $table, string $index) use ($pdo, $database): bool {
    $statement = $pdo->prepare(
        'SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?'
    );
    $statement->execute([$database, $table, $index]);
    return (bool) $statement->fetchColumn();
};
$constraintExists = static function (string $table, string $constraint) use ($pdo, $database): bool {
    $statement = $pdo->prepare(
        'SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?'
    );
    $statement->execute([$database, $table, $constraint]);
    return (bool) $statement->fetchColumn();
};

$pdo->exec(
    'CREATE TABLE IF NOT EXISTS departments (
       id INT UNSIGNED NOT NULL AUTO_INCREMENT,
       name VARCHAR(120) NOT NULL,
       PRIMARY KEY (id),
       UNIQUE KEY uq_departments_name (name)
     ) ENGINE=InnoDB'
);
$pdo->exec(
    "INSERT IGNORE INTO departments (name)
     SELECT department FROM (
       SELECT DISTINCT TRIM(department) AS department FROM users WHERE TRIM(department) <> ''
       UNION
       SELECT DISTINCT TRIM(department) AS department FROM teachers WHERE TRIM(department) <> ''
       UNION
       SELECT DISTINCT TRIM(department) AS department FROM subjects WHERE TRIM(department) <> ''
     ) existing_departments"
);

if (!$columnExists('users', 'department_id')) {
    $pdo->exec('ALTER TABLE users ADD COLUMN department_id INT UNSIGNED NULL AFTER department');
}
$departmentRelations = [
    'users' => ['idx_users_department', 'fk_users_department'],
    'teachers' => ['idx_teachers_department', 'fk_teachers_department'],
    'subjects' => ['idx_subjects_department', 'fk_subjects_department'],
    'courses' => ['idx_courses_department', 'fk_courses_department'],
];
foreach ($departmentRelations as $table => [$index, $constraint]) {
    if (!$columnExists($table, 'department_id')) {
        $after = $table === 'courses' ? 'course_name' : 'department';
        $pdo->exec("ALTER TABLE `$table` ADD COLUMN department_id INT UNSIGNED NULL AFTER `$after`");
    }
    if (!$indexExists($table, $index)) {
        $pdo->exec("ALTER TABLE `$table` ADD KEY `$index` (department_id)");
    }
    if (!$constraintExists($table, $constraint)) {
        $pdo->exec(
            "ALTER TABLE `$table` ADD CONSTRAINT `$constraint`
             FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE SET NULL"
        );
    }
    if ($table !== 'courses') {
        $pdo->exec(
            "UPDATE `$table` record JOIN departments d ON d.name = TRIM(record.department)
             SET record.department_id = d.id
             WHERE record.department_id IS NULL AND TRIM(record.department) <> ''"
        );
    }
}

if (!$columnExists('teacher_subjects', 'year_level')) {
    $pdo->exec("ALTER TABLE teacher_subjects ADD COLUMN year_level VARCHAR(32) NOT NULL DEFAULT '' AFTER semester");
}
$pdo->exec(
    "UPDATE teacher_subjects
     SET year_level = semester, semester = ''
     WHERE semester IN ('1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year')
       AND year_level = ''"
);

$pdo->exec(
    'CREATE TABLE IF NOT EXISTS student_subjects (
       student_user_id INT UNSIGNED NOT NULL,
       subject_id INT UNSIGNED NOT NULL,
       PRIMARY KEY (student_user_id, subject_id),
       KEY idx_student_subjects_subject (subject_id),
       CONSTRAINT fk_student_subjects_student
         FOREIGN KEY (student_user_id) REFERENCES students (user_id) ON DELETE CASCADE,
       CONSTRAINT fk_student_subjects_subject
         FOREIGN KEY (subject_id) REFERENCES subjects (id) ON DELETE CASCADE
     ) ENGINE=InnoDB'
);

$primaryColumns = $pdo->prepare(
    "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'evaluation_duplicate_guards'
       AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION"
);
$primaryColumns->execute([$database]);
$currentPrimary = $primaryColumns->fetchAll(PDO::FETCH_COLUMN);
$expectedPrimary = ['student_user_id', 'teacher_id', 'subject_id', 'period_id'];
if ($currentPrimary !== $expectedPrimary) {
    foreach (['idx_duplicate_guards_teacher', 'idx_duplicate_guards_subject', 'idx_duplicate_guards_period'] as $index) {
        if (!$indexExists('evaluation_duplicate_guards', $index)) {
            $column = match ($index) {
                'idx_duplicate_guards_teacher' => 'teacher_id',
                'idx_duplicate_guards_subject' => 'subject_id',
                default => 'period_id',
            };
            $pdo->exec("ALTER TABLE evaluation_duplicate_guards ADD KEY `$index` (`$column`)");
        }
    }
    $pdo->exec(
        'ALTER TABLE evaluation_duplicate_guards
         DROP PRIMARY KEY,
         ADD PRIMARY KEY (student_user_id, teacher_id, subject_id, period_id)'
    );
}

$legacyAssignments = [
    [1, 1, 1, '1st Year', ''],
    [2, 1, 4, '1st Year', ''],
    [3, 5, 5, '1st Year', ''],
    [4, 6, 6, '1st Year', ''],
    [5, 7, 7, '1st Year', ''],
    [6, 8, 8, '1st Year', ''],
    [7, 9, 9, '1st Year', ''],
    [8, 6, 10, '1st Year', ''],
    [9, 9, 11, '2nd Year', ''],
    [10, 12, 12, '2nd Year', ''],
    [11, 13, 13, '2nd Year', ''],
    [12, 1, 14, '2nd Year', ''],
    [13, 1, 15, '2nd Year', ''],
    [14, 16, 16, '2nd Year', ''],
    [15, 1, 17, '2nd Year', ''],
    [16, 1, 18, '2nd Year', ''],
    [17, 19, 19, '2nd Year', ''],
    [18, 20, 20, '2nd Year', ''],
    [19, 21, 21, '2nd Year', ''],
    [20, 13, 22, '2nd Year', ''],
    [21, 23, 23, '2nd Year', ''],
];
$insertAssignment = $pdo->prepare(
    'INSERT IGNORE INTO teacher_subjects
    (id, teacher_id, subject_id, semester, year_level, academic_year) VALUES (?, ?, ?, \'\', ?, ?)'
);
$restoredAssignments = 0;
foreach ($legacyAssignments as $assignment) {
    $insertAssignment->execute($assignment);
    $restoredAssignments += $insertAssignment->rowCount();
}

foreach (['departments', 'teachers', 'subjects', 'courses', 'teacher_subjects', 'student_subjects', 'students', 'evaluation_duplicate_guards'] as $table) {
    $count = (int) $pdo->query("SELECT COUNT(*) FROM `$table`")->fetchColumn();
    fwrite(STDOUT, sprintf("%s: %d\n", $table, $count));
}
fwrite(STDOUT, sprintf("Legacy teacher-subject assignments added: %d\n", $restoredAssignments));
