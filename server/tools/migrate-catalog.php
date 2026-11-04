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
    'CREATE TABLE IF NOT EXISTS courses (
       id INT UNSIGNED NOT NULL AUTO_INCREMENT,
       course_code VARCHAR(32) NOT NULL,
       course_name VARCHAR(160) NOT NULL,
       PRIMARY KEY (id),
       UNIQUE KEY uq_courses_code (course_code),
       UNIQUE KEY uq_courses_name (course_name)
     ) ENGINE=InnoDB'
);
$pdo->exec(
    'CREATE TABLE IF NOT EXISTS course_subjects (
       course_id INT UNSIGNED NOT NULL,
       subject_id INT UNSIGNED NOT NULL,
       PRIMARY KEY (course_id, subject_id),
       CONSTRAINT fk_course_subjects_course
         FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
       CONSTRAINT fk_course_subjects_subject
         FOREIGN KEY (subject_id) REFERENCES subjects (id) ON DELETE CASCADE
     ) ENGINE=InnoDB'
);

if (!$columnExists('teachers', 'teacher_code')) {
    $pdo->exec('ALTER TABLE teachers ADD COLUMN teacher_code VARCHAR(64) NULL AFTER id');
}
if (!$columnExists('subjects', 'subject_code')) {
    $pdo->exec('ALTER TABLE subjects ADD COLUMN subject_code VARCHAR(32) NULL AFTER id');
}
if (!$columnExists('students', 'course_id')) {
    $pdo->exec('ALTER TABLE students ADD COLUMN course_id INT UNSIGNED NULL AFTER course');
}

$teacherRows = $pdo->query('SELECT id, teacher_code FROM teachers ORDER BY id')->fetchAll();
$teacherUpdate = $pdo->prepare('UPDATE teachers SET teacher_code = ? WHERE id = ?');
foreach ($teacherRows as $row) {
    if ($row['teacher_code'] === null || trim($row['teacher_code']) === '') {
        $teacherUpdate->execute([sprintf('T-%04d', $row['id']), $row['id']]);
    }
}
$subjectRows = $pdo->query('SELECT id, name, subject_code FROM subjects ORDER BY id')->fetchAll();
$subjectCodes = [];
$knownSubjectCodes = ['Student/Teacher Evaluation Questionnaires' => 'STEQ'];
$subjectUpdate = $pdo->prepare('UPDATE subjects SET subject_code = ? WHERE id = ?');
foreach ($subjectRows as $row) {
    $code = trim((string) ($row['subject_code'] ?? ''));
    if (isset($knownSubjectCodes[$row['name']])) {
        $code = $knownSubjectCodes[$row['name']];
        if ($row['subject_code'] !== $code) {
            $subjectUpdate->execute([$code, $row['id']]);
        }
        $subjectCodes[strtolower($code)] = true;
        continue;
    }
    if ($code === '') {
        $prefix = explode(' - ', $row['name'], 2)[0];
        $code = strtoupper(trim((string) preg_replace('/[^A-Za-z0-9]+/', '-', $prefix), '-'));
        if ($code === '') {
            $code = 'SUBJECT';
        }
        $code = substr($code, 0, 25);
        $candidate = $code;
        if (isset($subjectCodes[strtolower($candidate)])) {
            $candidate = substr($code, 0, 25) . '-' . $row['id'];
        }
        $code = $candidate;
        $subjectUpdate->execute([$code, $row['id']]);
    }
    $subjectCodes[strtolower($code)] = true;
}

$pdo->exec('ALTER TABLE teachers MODIFY teacher_code VARCHAR(64) NOT NULL');
$pdo->exec('ALTER TABLE subjects MODIFY subject_code VARCHAR(32) NOT NULL');
if (!$indexExists('teachers', 'uq_teachers_code')) {
    $pdo->exec('ALTER TABLE teachers ADD UNIQUE KEY uq_teachers_code (teacher_code)');
}
if (!$indexExists('subjects', 'uq_subjects_code')) {
    $pdo->exec('ALTER TABLE subjects ADD UNIQUE KEY uq_subjects_code (subject_code)');
}
if (!$indexExists('students', 'idx_students_course')) {
    $pdo->exec('ALTER TABLE students ADD KEY idx_students_course (course_id)');
}
if (!$constraintExists('students', 'fk_students_course')) {
    $pdo->exec(
        'ALTER TABLE students ADD CONSTRAINT fk_students_course
         FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE SET NULL'
    );
}

$legacyCourses = $pdo->query(
    "SELECT DISTINCT TRIM(course) AS course_name
     FROM students WHERE TRIM(course) <> '' ORDER BY course_name"
)->fetchAll(PDO::FETCH_COLUMN);
$findCourse = $pdo->prepare('SELECT id FROM courses WHERE course_name = ?');
$insertCourse = $pdo->prepare('INSERT INTO courses (course_code, course_name) VALUES (?, ?)');
foreach ($legacyCourses as $courseName) {
    $findCourse->execute([$courseName]);
    if ($findCourse->fetchColumn()) {
        continue;
    }
    $base = strtoupper(trim((string) preg_replace('/[^A-Za-z0-9]+/', '-', substr($courseName, 0, 20)), '-'));
    $base = $base === '' ? 'LEGACY' : $base;
    $code = substr('LEGACY-' . $base, 0, 32);
    $suffix = 1;
    while (true) {
        try {
            $insertCourse->execute([$code, $courseName]);
            break;
        } catch (PDOException $error) {
            if ($error->getCode() !== '23000') {
                throw $error;
            }
            $code = substr('LEGACY-' . $base, 0, 27) . '-' . $suffix++;
        }
    }
}
$pdo->exec(
    'UPDATE students s
     JOIN courses c ON c.course_name = TRIM(s.course)
     SET s.course_id = c.id
     WHERE s.course_id IS NULL AND TRIM(s.course) <> \'\''
);

$counts = [];
foreach (['teachers', 'subjects', 'courses', 'teacher_subjects', 'course_subjects', 'students'] as $table) {
    $counts[$table] = (int) $pdo->query("SELECT COUNT(*) FROM `$table`")->fetchColumn();
}
foreach ($counts as $table => $count) {
    fwrite(STDOUT, sprintf("%s: %d\n", $table, $count));
}
