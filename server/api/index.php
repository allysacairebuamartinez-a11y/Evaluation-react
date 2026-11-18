<?php
declare(strict_types=1);

date_default_timezone_set('UTC');
ini_set('display_errors', '0');
ini_set('session.gc_maxlifetime', (string) (60 * 60 * 8));
error_reporting(E_ALL);

function send_json($data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

$config = require __DIR__ . '/config.php';
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
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    $cookieOptions = [
        'lifetime' => 60 * 60 * 8,
        'path' => '/',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Strict',
    ];
    session_set_cookie_params($cookieOptions);
    session_start();

    function fail_request(int $status, string $message): never
    {
        send_json(['error' => $message], $status);
    }

    function request_body(): array
    {
        $body = json_decode(file_get_contents('php://input'), true);
        return is_array($body) ? $body : [];
    }

    function current_user(PDO $pdo): ?array
    {
        if (empty($_SESSION['user_id'])) {
            return null;
        }
        $statement = $pdo->prepare(
            'SELECT users.id, users.username, users.role, users.display_name,
                    COALESCE(NULLIF(deans.department, \'\'), departments.name, users.department) AS department,
                    users.active
             FROM users
             LEFT JOIN departments ON departments.id = users.department_id
             LEFT JOIN deans ON deans.user_id = users.id
             WHERE users.id = ? LIMIT 1'
        );
        $statement->execute([(int) $_SESSION['user_id']]);
        $user = $statement->fetch();
        if (!$user || !(int) $user['active']) {
            $_SESSION = [];
            session_regenerate_id(true);
            return null;
        }
        if (!in_array($user['role'], ['admin', 'dean', 'student'], true)) {
            $_SESSION = [];
            session_regenerate_id(true);
            return null;
        }
        $user['displayName'] = $user['display_name'];
        return $user;
    }

    function require_user(?array $user, array $roles = []): array
    {
        if (!$user) {
            fail_request(401, 'Please sign in to continue.');
        }
        if ($roles && !in_array($user['role'], $roles, true)) {
            fail_request(403, 'You do not have permission to access this resource.');
        }
        return $user;
    }

    function require_csrf(): void
    {
        if ($_SERVER['REQUEST_METHOD'] === 'GET' || ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_GET['path'] ?? '') === '/auth/login')) {
            return;
        }
        $header = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        $token = $_SESSION['csrf_token'] ?? '';
        if (!$header || !$token || !hash_equals($token, $header)) {
            fail_request(403, 'Your secure session expired. Refresh the page and sign in again.');
        }
    }

    function public_user(array $user): array
    {
        return [
            'id' => (int) $user['id'],
            'username' => $user['username'],
            'role' => $user['role'],
            'displayName' => $user['displayName'] ?? $user['display_name'],
            'department' => $user['department'] ?? '',
        ];
    }

    function activity_log_schema(PDO $pdo): array
    {
        static $columns = null;
        if ($columns === null) {
            $columns = $pdo->query('SHOW COLUMNS FROM activity_logs')->fetchAll(PDO::FETCH_COLUMN);
        }

        $required = ['id', 'actor_name', 'actor_role'];
        $schemas = [
            ['user' => 'user_id', 'action' => 'action', 'details' => 'details', 'created' => 'created_at'],
            ['user' => 'actor_user_id', 'action' => 'action_type', 'details' => 'description', 'created' => 'occurred_at'],
        ];
        foreach ($schemas as $schema) {
            if (array_diff(array_merge($required, array_values($schema)), $columns) === []) {
                return $schema;
            }
        }

        throw new RuntimeException('The activity_logs table has an unsupported schema.');
    }

    function record_activity(PDO $pdo, array $user, string $action, string $details = ''): void
    {
        if (!in_array($user['role'] ?? '', ['admin', 'dean'], true)) {
            return;
        }
        $columns = activity_log_schema($pdo);
        $statement = $pdo->prepare(
            'INSERT INTO activity_logs (' . $columns['user'] . ', actor_name, actor_role, '
            . $columns['action'] . ', ' . $columns['details'] . ')
             VALUES (?, ?, ?, ?, ?)'
        );
        $statement->execute([
            (int) $user['id'],
            (string) ($user['displayName'] ?? $user['display_name'] ?? $user['username'] ?? 'Unknown'),
            (string) $user['role'],
            $action,
            substr($details, 0, 255),
        ]);
    }

    function period_state(array $period, int $now): string
    {
        $startsAt = strtotime((string) $period['starts_at'] . ' UTC');
        $endsAt = strtotime((string) $period['ends_at'] . ' UTC');
        if ($startsAt !== false && $now < $startsAt) {
            return 'Pending';
        }
        if (($period['status'] ?? '') === 'open' && $endsAt !== false && $now <= $endsAt) {
            return 'Ongoing';
        }
        return 'Completed';
    }

    function valid_department(PDO $pdo, string $department): bool
    {
        if ($department === '') {
            return true;
        }
        $statement = $pdo->prepare('SELECT 1 FROM departments WHERE name = ?');
        $statement->execute([$department]);
        return (bool) $statement->fetchColumn();
    }

    function department_id(PDO $pdo, string $department): ?int
    {
        if ($department === '') {
            return null;
        }
        $statement = $pdo->prepare('SELECT id FROM departments WHERE name = ?');
        $statement->execute([$department]);
        $id = $statement->fetchColumn();
        return $id === false ? null : (int) $id;
    }

    function iso_datetime(?string $value): string
    {
        if (!$value) {
            return '';
        }
        return (new DateTimeImmutable($value, new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s\Z');
    }

    function get_criteria(PDO $pdo): array
    {
        $statement = $pdo->query(
            'SELECT c.id, c.name, q.question_id
             FROM evaluation_criteria c
             LEFT JOIN criterion_questions q ON q.criterion_id = c.id
             ORDER BY c.sort_order, c.id, q.question_id'
        );
        $criteria = [];
        foreach ($statement as $row) {
            $id = (int) $row['id'];
            if (!isset($criteria[$id])) {
                $criteria[$id] = ['name' => $row['name'], 'questionIds' => []];
            }
            if ($row['question_id'] !== null) {
                $criteria[$id]['questionIds'][] = (int) $row['question_id'];
            }
        }
        return array_values($criteria);
    }

    function get_questions(PDO $pdo): array
    {
        $statement = $pdo->query(
            'SELECT id, question_text, answer_type
             FROM evaluation_questions ORDER BY id'
        );
        return array_map(static function (array $question): array {
            return [
                'id' => (int) $question['id'],
                'text' => $question['question_text'],
                'type' => $question['answer_type'],
            ];
        }, $statement->fetchAll());
    }

    function evaluation_reports(PDO $pdo, array $filters): array
    {
        $completeEvaluationIds = "SELECT answer_set.evaluation_id
                                  FROM evaluation_answers answer_set
                                  GROUP BY answer_set.evaluation_id
                                  HAVING COUNT(*) = 29
                                     AND SUM(CASE
                                         WHEN (answer_set.question_id BETWEEN 1 AND 28
                                               AND answer_set.answer_value REGEXP '^[1-5]$')
                                           OR (answer_set.question_id = 29
                                               AND answer_set.answer_value IN ('yes', 'no'))
                                         THEN 1 ELSE 0
                                     END) = 29";
        $where = ["e.id IN ($completeEvaluationIds)"];
        $values = [];
        $filterColumns = [
            'teacher' => 'e.teacher_name',
            'department' => 'e.department',
            'subject' => 'e.subject_name',
            'period' => 'e.period_name',
            'semester' => 'p.semester',
            'academicYear' => 'p.academic_year',
        ];
        foreach ($filterColumns as $key => $column) {
            if (isset($filters[$key]) && $filters[$key] !== '') {
                $where[] = "$column = ?";
                $values[] = $filters[$key];
            }
        }
        $sql = 'SELECT e.id, e.teacher_name, e.subject_name, e.department, e.period_name,
                       p.semester, p.academic_year, a.question_id, a.answer_value
                FROM evaluations e
                LEFT JOIN evaluation_periods p ON p.id = e.period_id
                LEFT JOIN evaluation_answers a ON a.evaluation_id = e.id';
        if ($where) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY e.teacher_name, e.subject_name, e.period_name';
        $statement = $pdo->prepare($sql);
        $statement->execute($values);

        $groups = [];
        foreach ($statement as $row) {
            $key = json_encode([
                $row['teacher_name'],
                $row['subject_name'],
                $row['department'],
                $row['period_name'],
                $row['semester'] ?? '',
                $row['academic_year'] ?? '',
            ]);
            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'teacher' => $row['teacher_name'],
                    'subject' => $row['subject_name'],
                    'department' => $row['department'],
                    'period' => $row['period_name'],
                    'semester' => $row['semester'] ?? '',
                    'academicYear' => $row['academic_year'] ?? '',
                    'responses' => 0,
                    'evaluationIds' => [],
                    'ratingTotals' => [],
                    'ratingTotal' => 0,
                    'ratingCount' => 0,
                ];
            }
            if (!isset($groups[$key]['evaluationIds'][$row['id']])) {
                $groups[$key]['evaluationIds'][$row['id']] = true;
                $groups[$key]['responses']++;
            }
            if ($row['question_id'] !== null
                && (int) $row['question_id'] >= 1
                && (int) $row['question_id'] <= 28
                && is_numeric($row['answer_value'])
                && (float) $row['answer_value'] >= 1
                && (float) $row['answer_value'] <= 5) {
                $questionId = (string) $row['question_id'];
                if (!isset($groups[$key]['ratingTotals'][$questionId])) {
                    $groups[$key]['ratingTotals'][$questionId] = ['total' => 0, 'count' => 0];
                }
                $rating = (float) $row['answer_value'];
                $groups[$key]['ratingTotals'][$questionId]['total'] += $rating;
                $groups[$key]['ratingTotals'][$questionId]['count']++;
                $groups[$key]['ratingTotal'] += $rating;
                $groups[$key]['ratingCount']++;
            }
        }

        $results = [];
        foreach ($groups as $group) {
            $perQuestion = [];
            foreach ($group['ratingTotals'] as $questionId => $score) {
                if ($score['count']) {
                    $perQuestion[$questionId] = round($score['total'] / $score['count'], 2);
                }
            }
            $group['mean'] = $group['ratingCount']
                ? round($group['ratingTotal'] / $group['ratingCount'], 2)
                : 0;
            $group['perQuestion'] = $perQuestion;
            unset($group['ratingTotals'], $group['evaluationIds'], $group['ratingTotal'], $group['ratingCount']);
            $results[] = $group;
        }
        return $results;
    }

    function catalog_code(string $name, string $fallback): string
    {
        $code = strtoupper(trim((string) preg_replace('/[^A-Za-z0-9]+/', '-', explode(' - ', $name, 2)[0]), '-'));
        return substr($code !== '' ? $code : $fallback, 0, 32);
    }

    function create_or_find_subject(PDO $pdo, string $name, string $department, string $subjectCode): int
    {
        $departmentId = department_id($pdo, $department);
        $find = $pdo->prepare('SELECT id FROM subjects WHERE name = ?');
        $find->execute([$name]);
        $id = $find->fetchColumn();
        if ($id !== false) {
            if ($department !== '') {
                $update = $pdo->prepare("UPDATE subjects SET department = ?, department_id = ? WHERE id = ? AND department = ''");
                $update->execute([$department, $departmentId, $id]);
            }
            return (int) $id;
        }
        $insert = $pdo->prepare('INSERT INTO subjects (subject_code, name, department, department_id) VALUES (?, ?, ?, ?)');
        $insert->execute([$subjectCode, $name, $department, $departmentId]);
        return (int) $pdo->lastInsertId();
    }

    function unique_conflict(PDOException $error): bool
    {
        return isset($error->errorInfo[1]) && (int) $error->errorInfo[1] === 1062;
    }

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $route = trim((string) ($_GET['path'] ?? $_SERVER['PATH_INFO'] ?? ''), '/');
    if ($route === '') {
        $requestPath = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
        $route = trim((string) preg_replace('~.*/server/api/~', '', $requestPath), '/');
    }
    $route = '/' . $route;
    $user = current_user($pdo);

    if ($method !== 'GET' && $route !== '/auth/login') {
        require_csrf();
    }

    if ($method === 'GET' && $route === '/health') {
        send_json(['status' => 'ok']);
    }

    if ($method === 'GET' && $route === '/dashboard/metrics') {
        $dashboardUser = require_user($user, ['admin', 'dean']);
        if ($dashboardUser['role'] === 'dean' && $dashboardUser['department'] === '') {
            fail_request(403, 'Assign this Dean account to a department before viewing evaluation monitoring.');
        }
        $periods = $pdo->query(
            'SELECT id, name, semester, academic_year, starts_at, ends_at, status
             FROM evaluation_periods ORDER BY starts_at DESC'
        )->fetchAll();
        $eligibleQuery = $pdo->prepare(
            "SELECT COUNT(*)
             FROM teacher_subjects a
             JOIN teachers t ON t.id = a.teacher_id
             LEFT JOIN departments td ON td.id = t.department_id
             JOIN subjects s ON s.id = a.subject_id
             LEFT JOIN departments sd ON sd.id = s.department_id
             CROSS JOIN students st
             JOIN users student_user ON student_user.id = st.user_id
                 AND student_user.role = 'student' AND student_user.active = 1
             WHERE (a.semester = '' OR a.semester = ?)
               AND (a.academic_year = '' OR a.academic_year = ?)
               AND (? = '' OR CASE
                   WHEN COALESCE(td.name, t.department) = '' THEN COALESCE(sd.name, s.department)
                   ELSE COALESCE(td.name, t.department) END = ?)
               AND (
                   EXISTS (
                       SELECT 1 FROM student_subjects direct_subject
                       WHERE direct_subject.student_user_id = st.user_id
                         AND direct_subject.subject_id = a.subject_id
                   )
                   OR (
                       NOT EXISTS (
                           SELECT 1 FROM student_subjects assigned_subject
                           WHERE assigned_subject.student_user_id = st.user_id
                       )
                       AND (
                           (
                               (a.year_level = '' OR a.year_level = st.year_level)
                               AND EXISTS (
                                   SELECT 1 FROM course_subjects cs
                                   WHERE cs.course_id = st.course_id
                                     AND cs.subject_id = a.subject_id
                               )
                           )
                           OR st.course_id IS NULL
                       )
                   )
               )"
        );
        $completedQuery = $pdo->prepare(
            "SELECT COUNT(*)
             FROM evaluation_duplicate_guards g
             JOIN teachers t ON t.id = g.teacher_id
             LEFT JOIN departments td ON td.id = t.department_id
             JOIN subjects s ON s.id = g.subject_id
             LEFT JOIN departments sd ON sd.id = s.department_id
             WHERE g.period_id = ? AND (? = '' OR CASE
                 WHEN COALESCE(td.name, t.department) = '' THEN COALESCE(sd.name, s.department)
                 ELSE COALESCE(td.name, t.department) END = ?)"
        );
        $progress = [];
        $totalEligible = 0;
        $totalCompleted = 0;
        $now = time();
        foreach ($periods as $period) {
            $department = $dashboardUser['role'] === 'dean' ? $dashboardUser['department'] : '';
            $eligibleQuery->execute([
                $period['semester'],
                $period['academic_year'],
                $department,
                $department,
            ]);
            $eligible = (int) $eligibleQuery->fetchColumn();
            $completedQuery->execute([(int) $period['id'], $department, $department]);
            $completed = min((int) $completedQuery->fetchColumn(), $eligible);
            $pending = max(0, $eligible - $completed);
            $totalEligible += $eligible;
            $totalCompleted += $completed;
            $progress[] = [
                'id' => (int) $period['id'],
                'name' => $period['name'],
                'semester' => $period['semester'],
                'academicYear' => $period['academic_year'],
                'startsAt' => iso_datetime($period['starts_at']),
                'endsAt' => iso_datetime($period['ends_at']),
                'status' => period_state($period, $now),
                'eligible' => $eligible,
                'completed' => $completed,
                'pending' => $pending,
                'participationPercentage' => $eligible ? round($completed * 100 / $eligible, 1) : 0,
            ];
        }
        $ongoingPeriods = count(array_filter($progress, static fn(array $period): bool => $period['status'] === 'Ongoing'));
        $completedPeriods = count(array_filter($progress, static fn(array $period): bool => $period['status'] === 'Completed'));
        send_json([
            'periods' => $progress,
            'pendingEvaluations' => array_sum(array_column($progress, 'pending')),
            'ongoingPeriods' => $ongoingPeriods,
            'completedPeriods' => $completedPeriods,
            'participationPercentage' => $totalEligible
                ? round($totalCompleted * 100 / $totalEligible, 1)
                : 0,
        ]);
    }

    if ($method === 'GET' && $route === '/admin/activity') {
        $admin = require_user($user, ['admin']);
        $columns = activity_log_schema($pdo);
        $statement = $pdo->query(
            'SELECT actor_name AS actor, actor_role AS role, '
            . $columns['action'] . ' AS action, ' . $columns['details'] . ' AS details, '
            . $columns['created'] . ' AS createdAt
             FROM activity_logs ORDER BY id DESC LIMIT 20'
        );
        $activities = $statement->fetchAll();
        foreach ($activities as &$activity) {
            $activity['createdAt'] = iso_datetime($activity['createdAt']);
        }
        unset($activity);
        send_json($activities);
    }

    if ($method === 'GET' && $route === '/admin/settings/system') {
        require_user($user, ['admin']);
        $statement = $pdo->query(
            "SELECT setting_key, setting_value FROM system_settings
             WHERE setting_key IN ('school_name', 'academic_year', 'semester', 'deadline_notice_days')"
        );
        $settings = [
            'schoolName' => 'OLPC-SMI Online Teachers Evaluation System',
            'academicYear' => '',
            'semester' => '1st Semester',
            'deadlineNoticeDays' => '3',
        ];
        $keys = [
            'school_name' => 'schoolName',
            'academic_year' => 'academicYear',
            'semester' => 'semester',
            'deadline_notice_days' => 'deadlineNoticeDays',
        ];
        foreach ($statement as $setting) {
            if (isset($keys[$setting['setting_key']])) {
                $settings[$keys[$setting['setting_key']]] = $setting['setting_value'];
            }
        }
        send_json($settings);
    }

    if ($method === 'PUT' && $route === '/admin/settings/system') {
        $admin = require_user($user, ['admin']);
        $body = request_body();
        $schoolName = trim((string) ($body['schoolName'] ?? ''));
        $academicYear = trim((string) ($body['academicYear'] ?? ''));
        $semester = (string) ($body['semester'] ?? '');
        $noticeDays = filter_var($body['deadlineNoticeDays'] ?? null, FILTER_VALIDATE_INT);
        if (strlen($schoolName) < 2 || strlen($schoolName) > 160
            || strlen($academicYear) > 32
            || !in_array($semester, ['1st Semester', '2nd Semester', 'Summer'], true)
            || $noticeDays === false || $noticeDays < 0 || $noticeDays > 30) {
            fail_request(400, 'Provide a school name, valid semester, academic year, and deadline notice range from 0 to 30 days.');
        }
        $values = [
            'school_name' => $schoolName,
            'academic_year' => $academicYear,
            'semester' => $semester,
            'deadline_notice_days' => (string) $noticeDays,
        ];
        try {
            $pdo->beginTransaction();
            $upsert = $pdo->prepare(
                'INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)'
            );
            foreach ($values as $key => $value) {
                $upsert->execute([$key, $value]);
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
        record_activity($pdo, $admin, 'system.settings.updated', 'Updated school and evaluation defaults.');
        send_json(['status' => 'updated']);
    }

    if ($method === 'GET' && $route === '/auth/me') {
        $authenticated = require_user($user);
        send_json(['user' => public_user($authenticated), 'csrfToken' => $_SESSION['csrf_token'] ?? '']);
    }

    if ($method === 'POST' && $route === '/auth/login') {
        $body = request_body();
        $username = trim((string) ($body['username'] ?? ''));
        $password = (string) ($body['password'] ?? '');
        $roleHint = (string) ($body['role'] ?? '');
        $allowedRoles = ['admin', 'dean', 'student'];
        if ($roleHint !== '' && !in_array($roleHint, $allowedRoles, true)) {
            fail_request(400, 'Choose Admin, Student, or Dean.');
        }
        if (!preg_match('/^[a-zA-Z0-9._-]{3,64}$/', $username) || strlen($password) < 1 || strlen($password) > 256) {
            fail_request(400, 'Enter a valid username and password.');
        }
        $statement = $pdo->prepare(
            'SELECT id, username, password_hash, role, display_name, department, active, failed_attempts, locked_until
             FROM users WHERE username = ? LIMIT 1'
        );
        $statement->execute([$username]);
        $account = $statement->fetch();
        $locked = $account && $account['locked_until'] && strtotime($account['locked_until'] . ' UTC') > time();
        if (!$account || !(int) $account['active'] || $locked || !password_verify($password, $account['password_hash'])) {
            if ($account && (int) $account['active']) {
                $failures = (int) $account['failed_attempts'] + 1;
                $lockUntil = $failures >= 10 ? gmdate('Y-m-d H:i:s', time() + 900) : null;
                $update = $pdo->prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?');
                $update->execute([$failures >= 10 ? 0 : $failures, $lockUntil, $account['id']]);
            }
            fail_request(401, 'Invalid username or password.');
        }
        if (!in_array($account['role'], $allowedRoles, true)) {
            fail_request(403, 'This account does not have a supported role.');
        }
        if ($roleHint !== '' && $roleHint !== $account['role']) {
            fail_request(403, 'The selected role does not match this account.');
        }
        $update = $pdo->prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?');
        $update->execute([$account['id']]);
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $account['id'];
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        $account['displayName'] = $account['display_name'];
        send_json(['user' => public_user($account), 'csrfToken' => $_SESSION['csrf_token']]);
    }

    if ($method === 'POST' && $route === '/auth/logout') {
        require_user($user);
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $cookie = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires' => time() - 42000,
                'path' => $cookie['path'],
                'domain' => $cookie['domain'],
                'secure' => $cookie['secure'],
                'httponly' => $cookie['httponly'],
                'samesite' => $cookie['samesite'] ?? 'Strict',
            ]);
        }
        session_destroy();
        send_json(['status' => 'signed_out']);
    }

    if ($route === '/admin/departments') {
        $admin = require_user($user, ['admin']);
        if ($method === 'GET') {
            send_json($pdo->query('SELECT id, name FROM departments ORDER BY name')->fetchAll());
        }
        if ($method === 'POST') {
            $name = trim((string) (request_body()['name'] ?? ''));
            if (strlen($name) < 2 || strlen($name) > 120) {
                fail_request(400, 'Enter a department name between 2 and 120 characters.');
            }
            try {
                $insert = $pdo->prepare('INSERT INTO departments (name) VALUES (?)');
                $insert->execute([$name]);
            } catch (PDOException $error) {
                if (unique_conflict($error)) {
                    fail_request(409, 'That department already exists.');
                }
                throw $error;
            }
            record_activity($pdo, $admin, 'department.created', 'Created department ' . $name . '.');
            send_json(['status' => 'created', 'id' => (int) $pdo->lastInsertId()], 201);
        }
    }

    if (preg_match('~^/admin/departments/(\d+)$~', $route, $match)) {
        $admin = require_user($user, ['admin']);
        $departmentId = (int) $match[1];
        if ($method === 'PUT' || $method === 'PATCH') {
            $name = trim((string) (request_body()['name'] ?? ''));
            if (strlen($name) < 2 || strlen($name) > 120) {
                fail_request(400, 'Enter a department name between 2 and 120 characters.');
            }
            try {
                $update = $pdo->prepare('UPDATE departments SET name = ? WHERE id = ?');
                $update->execute([$name, $departmentId]);
            } catch (PDOException $error) {
                if (unique_conflict($error)) {
                    fail_request(409, 'That department already exists.');
                }
                throw $error;
            }
            if (!$update->rowCount()) {
                $exists = $pdo->prepare('SELECT 1 FROM departments WHERE id = ?');
                $exists->execute([$departmentId]);
                if (!$exists->fetchColumn()) {
                    fail_request(404, 'Department not found.');
                }
            }
            record_activity($pdo, $admin, 'department.updated', 'Updated department ' . $departmentId . '.');
            send_json(['status' => 'updated']);
        }
        if ($method === 'DELETE') {
            $delete = $pdo->prepare('DELETE FROM departments WHERE id = ?');
            $delete->execute([$departmentId]);
            if (!$delete->rowCount()) {
                fail_request(404, 'Department not found.');
            }
            record_activity($pdo, $admin, 'department.deleted', 'Deleted department ' . $departmentId . '.');
            send_json(['status' => 'deleted']);
        }
    }

    if ($method === 'GET' && $route === '/catalog') {
        $authenticated = require_user($user);
        $teacherSql = 'SELECT teachers.id, teachers.teacher_code AS teacherCode, teachers.name,
                              COALESCE(departments.name, teachers.department) AS department
                       FROM teachers LEFT JOIN departments ON departments.id = teachers.department_id';
        $subjectSql = 'SELECT subjects.id, subjects.subject_code AS subjectCode, subjects.name,
                              COALESCE(departments.name, subjects.department) AS department
                       FROM subjects LEFT JOIN departments ON departments.id = subjects.department_id';
        $teacherValues = [];
        $subjectValues = [];
        if ($authenticated['role'] === 'student') {
            $teacherSql .= " WHERE EXISTS (
                SELECT 1 FROM teacher_subjects a
                WHERE a.teacher_id = teachers.id AND (
                    EXISTS (SELECT 1 FROM student_subjects ss
                            WHERE ss.student_user_id = ? AND ss.subject_id = a.subject_id)
                    OR (NOT EXISTS (SELECT 1 FROM student_subjects assigned
                                    WHERE assigned.student_user_id = ?)
                        AND EXISTS (SELECT 1 FROM course_subjects cs
                                    JOIN students enrollment ON enrollment.course_id = cs.course_id
                                    WHERE cs.subject_id = a.subject_id AND enrollment.user_id = ?))
                ) AND (a.year_level = '' OR EXISTS (
                    SELECT 1 FROM students grade
                    WHERE grade.user_id = ? AND grade.year_level = a.year_level
                ))
            )";
            $subjectSql .= ' WHERE EXISTS (
                SELECT 1 FROM student_subjects ss
                WHERE ss.student_user_id = ? AND ss.subject_id = subjects.id
            ) OR (NOT EXISTS (
                SELECT 1 FROM student_subjects assigned WHERE assigned.student_user_id = ?
            ) AND EXISTS (
                SELECT 1 FROM course_subjects cs
                JOIN students enrollment ON enrollment.course_id = cs.course_id
                WHERE cs.subject_id = subjects.id AND enrollment.user_id = ?
            ))';
            $teacherValues = array_fill(0, 4, $authenticated['id']);
            $subjectValues = array_fill(0, 3, $authenticated['id']);
        } elseif ($authenticated['role'] === 'dean') {
            if ($authenticated['department'] === '') {
                $teacherSql .= ' WHERE 1 = 0';
                $subjectSql .= ' WHERE 1 = 0';
            } else {
                $teacherSql .= ' WHERE COALESCE(departments.name, teachers.department) = ?';
                $subjectSql .= ' WHERE COALESCE(departments.name, subjects.department) = ?';
                $teacherValues[] = $authenticated['department'];
                $subjectValues[] = $authenticated['department'];
            }
        }
        $teachersQuery = $pdo->prepare($teacherSql . ' ORDER BY name');
        $teachersQuery->execute($teacherValues);
        $teachers = $teachersQuery->fetchAll();
        foreach ($teachers as &$teacher) {
            $teacher['id'] = (int) $teacher['id'];
        }
        unset($teacher);

        $subjectsQuery = $pdo->prepare($subjectSql . ' ORDER BY name');
        $subjectsQuery->execute($subjectValues);
        $subjects = $subjectsQuery->fetchAll();
        foreach ($subjects as &$subject) {
            $subject['id'] = (int) $subject['id'];
        }
        unset($subject);

        $studentCourse = null;
        if ($authenticated['role'] === 'student') {
            $courseQuery = $pdo->prepare(
                'SELECT c.id, c.course_code AS code, c.course_name AS name
                 FROM students s LEFT JOIN courses c ON c.id = s.course_id
                 WHERE s.user_id = ?'
            );
            $courseQuery->execute([$authenticated['id']]);
            $studentCourse = $courseQuery->fetch() ?: null;
            if ($studentCourse && $studentCourse['id'] !== null) {
                $studentCourse['id'] = (int) $studentCourse['id'];
            } else {
                $studentCourse = null;
            }
        }

        $assignmentSql = "SELECT a.id, a.teacher_id AS teacherId, a.subject_id AS subjectId,
            t.teacher_code AS teacherCode, t.name AS teacher,
            s.subject_code AS subjectCode, s.name AS subject,
            CASE WHEN COALESCE(td.name, t.department) = '' THEN COALESCE(sd.name, s.department)
                 ELSE COALESCE(td.name, t.department) END AS department,
            a.semester, a.year_level AS yearLevel, a.academic_year AS academicYear
            FROM teacher_subjects a
            JOIN teachers t ON t.id = a.teacher_id
            JOIN subjects s ON s.id = a.subject_id
            LEFT JOIN departments td ON td.id = t.department_id
            LEFT JOIN departments sd ON sd.id = s.department_id";
        $assignmentValues = [];
        if ($authenticated['role'] === 'student') {
            $assignmentSql .= " WHERE (
                EXISTS (SELECT 1 FROM student_subjects ss
                        WHERE ss.student_user_id = ? AND ss.subject_id = s.id)
                OR (NOT EXISTS (SELECT 1 FROM student_subjects assigned
                                WHERE assigned.student_user_id = ?)
                    AND (a.year_level = '' OR EXISTS (
                        SELECT 1 FROM students grade
                        WHERE grade.user_id = ? AND grade.year_level = a.year_level
                    ))
                    AND EXISTS (SELECT 1 FROM course_subjects cs
                                JOIN students enrollment ON enrollment.course_id = cs.course_id
                                WHERE enrollment.user_id = ? AND cs.subject_id = s.id))
                OR (NOT EXISTS (SELECT 1 FROM student_subjects assigned
                                WHERE assigned.student_user_id = ?)
                    AND EXISTS (SELECT 1 FROM students unassigned
                                WHERE unassigned.user_id = ? AND unassigned.course_id IS NULL))
            )";
            $assignmentValues = array_fill(0, 6, $authenticated['id']);
        } elseif ($authenticated['role'] === 'dean') {
            if ($authenticated['department'] === '') {
                $assignmentSql .= ' WHERE 1 = 0';
            } else {
                $assignmentSql .= " WHERE CASE
                    WHEN COALESCE(td.name, t.department) = '' THEN COALESCE(sd.name, s.department)
                    ELSE COALESCE(td.name, t.department) END = ?";
                $assignmentValues[] = $authenticated['department'];
            }
        }
        $assignmentSql .= ' ORDER BY t.name, s.name';
        $assignmentQuery = $pdo->prepare($assignmentSql);
        $assignmentQuery->execute($assignmentValues);
        $assignments = $assignmentQuery->fetchAll();
        foreach ($assignments as &$assignment) {
            $assignment['id'] = (int) $assignment['id'];
            $assignment['teacherId'] = (int) $assignment['teacherId'];
            $assignment['subjectId'] = (int) $assignment['subjectId'];
        }
        unset($assignment);

        $courses = [];
        $courseSubjects = [];
        if ($authenticated['role'] === 'admin') {
            $courses = $pdo->query(
                'SELECT c.id, c.course_code AS courseCode, c.course_name AS courseName,
                        c.department_id AS departmentId, d.name AS department
                 FROM courses c LEFT JOIN departments d ON d.id = c.department_id
                 ORDER BY c.course_name'
            )->fetchAll();
            foreach ($courses as &$course) {
                $course['id'] = (int) $course['id'];
            }
            unset($course);
            $courseSubjects = $pdo->query(
                'SELECT course_id AS courseId, subject_id AS subjectId FROM course_subjects'
            )->fetchAll();
            foreach ($courseSubjects as &$courseSubject) {
                $courseSubject['courseId'] = (int) $courseSubject['courseId'];
                $courseSubject['subjectId'] = (int) $courseSubject['subjectId'];
            }
            unset($courseSubject);
        }

        $periods = $pdo->query(
            "SELECT id, name, semester, academic_year, starts_at, ends_at, status
             FROM evaluation_periods ORDER BY starts_at DESC"
        )->fetchAll();
        foreach ($periods as &$period) {
            $period['id'] = (int) $period['id'];
            $period['starts_at'] = iso_datetime($period['starts_at']);
            $period['ends_at'] = iso_datetime($period['ends_at']);
        }
        unset($period);

        $departments = $pdo->query('SELECT id, name FROM departments ORDER BY name')->fetchAll();
        foreach ($departments as &$departmentRecord) {
            $departmentRecord['id'] = (int) $departmentRecord['id'];
        }
        unset($departmentRecord);
        if ($authenticated['role'] === 'dean') {
            $departments = array_values(array_filter(
                $departments,
                static fn(array $departmentRecord): bool => $departmentRecord['name'] === $authenticated['department']
            ));
        }
        $noticeDays = $pdo->prepare(
            "SELECT setting_value FROM system_settings WHERE setting_key = 'deadline_notice_days'"
        );
        $noticeDays->execute();
        $deadlineNoticeDays = $noticeDays->fetchColumn();
        send_json([
            'teachers' => $teachers,
            'subjects' => $subjects,
            'assignments' => $assignments,
            'courses' => $courses,
            'courseSubjects' => $courseSubjects,
            'studentCourse' => $studentCourse,
            'studentDepartment' => $authenticated['role'] === 'student' ? $authenticated['department'] : '',
            'scopeDepartment' => in_array($authenticated['role'], ['student', 'dean'], true) ? $authenticated['department'] : '',
            'deadlineNoticeDays' => $deadlineNoticeDays === false ? 3 : max(0, min(30, (int) $deadlineNoticeDays)),
            'periods' => $periods,
            'departments' => $departments,
        ]);
    }

    if ($method === 'GET' && $route === '/my-submissions') {
        $student = require_user($user, ['student']);
        $statement = $pdo->prepare(
            'SELECT t.name AS teacher, s.name AS subject, p.id AS periodId, p.name AS period,
                    NULL AS created_at
             FROM evaluation_duplicate_guards g
             JOIN teachers t ON t.id = g.teacher_id
             JOIN subjects s ON s.id = g.subject_id
             JOIN evaluation_periods p ON p.id = g.period_id
             WHERE g.student_user_id = ? ORDER BY p.starts_at DESC'
        );
        $statement->execute([$student['id']]);
        send_json($statement->fetchAll());
    }

    if ($method === 'POST' && $route === '/responses') {
        $student = require_user($user, ['student']);
        $body = request_body();
        $teacherName = trim((string) ($body['teacher'] ?? ''));
        $subjectName = trim((string) ($body['subject'] ?? ''));
        $periodId = filter_var($body['periodId'] ?? null, FILTER_VALIDATE_INT);
        $ratings = $body['ratings'] ?? null;
        $comment = trim((string) ($body['comment'] ?? ''));
        if (!$teacherName || !$subjectName || !$periodId || !is_array($ratings) || count($ratings) !== 29) {
            fail_request(400, 'Choose a teacher, subject, evaluation period, and complete all evaluation questions.');
        }
        if (strlen($comment) > 2000) {
            fail_request(400, 'The evaluation comment is too long.');
        }
        for ($questionId = 1; $questionId <= 29; $questionId++) {
            $key = (string) $questionId;
            if (!array_key_exists($key, $ratings)) {
                fail_request(400, 'Please complete all evaluation questions.');
            }
            if ($questionId === 29) {
                if (!in_array($ratings[$key], ['yes', 'no'], true)) {
                    fail_request(400, 'Question 29 needs a valid Yes or No answer.');
                }
            } elseif (!is_numeric($ratings[$key]) || (int) $ratings[$key] < 1 || (int) $ratings[$key] > 5 || (float) $ratings[$key] !== (float) (int) $ratings[$key]) {
                fail_request(400, "Question $questionId is missing a valid rating.");
            }
        }

        $periodQuery = $pdo->prepare(
            "SELECT id, name, semester, academic_year, status, starts_at, ends_at
             FROM evaluation_periods WHERE id = ?"
        );
        $periodQuery->execute([$periodId]);
        $period = $periodQuery->fetch();
        $now = time();
        if (!$period || $period['status'] !== 'open' || strtotime($period['starts_at'] . ' UTC') > $now || strtotime($period['ends_at'] . ' UTC') < $now) {
            fail_request(409, 'This evaluation period is not currently open.');
        }

        $assignmentQuery = $pdo->prepare(
            "SELECT t.id AS teacher_id, t.name AS teacher, s.id AS subject_id, s.name AS subject,
                    CASE WHEN COALESCE(td.name, t.department) = '' THEN COALESCE(sd.name, s.department)
                         ELSE COALESCE(td.name, t.department) END AS department,
                    a.semester, a.academic_year
             FROM teacher_subjects a
             JOIN teachers t ON t.id = a.teacher_id
             JOIN subjects s ON s.id = a.subject_id
             LEFT JOIN departments td ON td.id = t.department_id
             LEFT JOIN departments sd ON sd.id = s.department_id
             WHERE t.name = ? AND s.name = ? AND (
                 EXISTS (SELECT 1 FROM student_subjects ss
                         WHERE ss.student_user_id = ? AND ss.subject_id = s.id)
                 OR (NOT EXISTS (SELECT 1 FROM student_subjects assigned
                                 WHERE assigned.student_user_id = ?)
                     AND (a.year_level = '' OR EXISTS (
                         SELECT 1 FROM students grade
                         WHERE grade.user_id = ? AND grade.year_level = a.year_level
                     ))
                     AND EXISTS (SELECT 1 FROM course_subjects cs
                                 JOIN students enrollment ON enrollment.course_id = cs.course_id
                                 WHERE enrollment.user_id = ? AND cs.subject_id = s.id))
                 OR (NOT EXISTS (SELECT 1 FROM student_subjects assigned
                                 WHERE assigned.student_user_id = ?)
                     AND EXISTS (SELECT 1 FROM students unassigned
                                 WHERE unassigned.user_id = ? AND unassigned.course_id IS NULL))
             )
             ORDER BY a.id LIMIT 1"
        );
        $assignmentQuery->execute([$teacherName, $subjectName, $student['id'], $student['id'], $student['id'], $student['id'], $student['id'], $student['id']]);
        $assignment = $assignmentQuery->fetch();
        if (!$assignment) {
            fail_request(400, 'That teacher and subject are not in the active evaluation catalog.');
        }
        if (($assignment['semester'] !== '' && $assignment['semester'] !== $period['semester'])
            || ($assignment['academic_year'] !== '' && $assignment['academic_year'] !== $period['academic_year'])) {
            fail_request(400, 'That teacher and subject are not assigned for this evaluation period.');
        }

        try {
            $pdo->beginTransaction();
            $guard = $pdo->prepare(
                'INSERT INTO evaluation_duplicate_guards (student_user_id, teacher_id, subject_id, period_id) VALUES (?, ?, ?, ?)'
            );
            $guard->execute([$student['id'], $assignment['teacher_id'], $assignment['subject_id'], $period['id']]);
            $insert = $pdo->prepare(
                'INSERT INTO evaluations
                 (teacher_id, teacher_name, subject_id, subject_name, department, period_id, period_name, comment)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $insert->execute([
                $assignment['teacher_id'],
                $assignment['teacher'],
                $assignment['subject_id'],
                $assignment['subject'],
                $assignment['department'],
                $period['id'],
                $period['name'],
                $comment,
            ]);
            $evaluationId = (int) $pdo->lastInsertId();
            $answerInsert = $pdo->prepare(
                'INSERT INTO evaluation_answers (evaluation_id, question_id, answer_value) VALUES (?, ?, ?)'
            );
            foreach ($ratings as $questionId => $answer) {
                $answerInsert->execute([$evaluationId, (int) $questionId, (string) $answer]);
            }
            $pdo->commit();
        } catch (PDOException $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            if (unique_conflict($error)) {
                fail_request(409, 'You have already evaluated this teacher and subject for this period.');
            }
            throw $error;
        }
        send_json(['status' => 'submitted', 'created_at' => gmdate('Y-m-d\TH:i:s\Z')], 201);
    }

    if ($method === 'GET' && $route === '/reports/filters') {
        $reportUser = require_user($user, ['admin', 'dean']);
        if ($reportUser['role'] === 'dean' && $reportUser['department'] === '') {
            fail_request(403, 'Assign this Dean account to a department before viewing evaluation reports.');
        }
        $reports = evaluation_reports(
            $pdo,
            $reportUser['role'] === 'dean' ? ['department' => $reportUser['department']] : []
        );
        $filters = ['teacher' => [], 'subject' => [], 'department' => [], 'period' => [], 'semester' => [], 'academicYear' => []];
        foreach ($reports as $report) {
            foreach (['teacher', 'subject', 'department', 'period', 'semester', 'academicYear'] as $field) {
                if ($report[$field] !== '' && !in_array($report[$field], $filters[$field], true)) {
                    $filters[$field][] = $report[$field];
                }
            }
        }
        foreach ($filters as &$values) {
            sort($values, SORT_NATURAL | SORT_FLAG_CASE);
        }
        unset($values);
        send_json($filters);
    }

    if ($method === 'GET' && $route === '/reports') {
        $reportUser = require_user($user, ['admin', 'dean']);
        if ($reportUser['role'] === 'dean' && $reportUser['department'] === '') {
            fail_request(403, 'Assign this Dean account to a department before viewing evaluation reports.');
        }
        $filters = [];
        foreach (['teacher', 'department', 'subject', 'period', 'semester', 'academicYear'] as $filter) {
            if (isset($_GET[$filter]) && $_GET[$filter] !== '') {
                $filters[$filter] = (string) $_GET[$filter];
            }
        }
        if ($reportUser['role'] === 'dean') {
            $filters['department'] = $reportUser['department'];
            record_activity($pdo, $reportUser, 'reports.viewed', 'Viewed authorized department evaluation results.');
        }
        send_json(evaluation_reports($pdo, $filters));
    }

    if ($method === 'GET' && $route === '/admin/evaluations') {
        require_user($user, ['admin']);
        $filters = [];
        $values = [];
        foreach (['teacher' => 'teacher_name', 'subject' => 'subject_name', 'period' => 'period_name'] as $key => $column) {
            if (isset($_GET[$key]) && $_GET[$key] !== '') {
                $filters[] = "$column = ?";
                $values[] = (string) $_GET[$key];
            }
        }
        $sql = 'SELECT id, teacher_name AS teacher, subject_name AS subject,
                       department, period_name AS period, submitted_at AS submittedAt
                FROM evaluations';
        if ($filters) {
            $sql .= ' WHERE ' . implode(' AND ', $filters);
        }
        $sql .= ' ORDER BY submitted_at DESC, id DESC';
        $statement = $pdo->prepare($sql);
        $statement->execute($values);
        $evaluations = $statement->fetchAll();
        foreach ($evaluations as &$evaluation) {
            $evaluation['id'] = (int) $evaluation['id'];
            $evaluation['submittedAt'] = iso_datetime($evaluation['submittedAt']);
        }
        unset($evaluation);
        send_json($evaluations);
    }

    if ($method === 'POST' && $route === '/reports/submit') {
        $reportUser = require_user($user, ['admin', 'dean']);
        if ($reportUser['role'] === 'dean' && $reportUser['department'] === '') {
            fail_request(403, 'Assign this Dean account to a department before viewing evaluation reports.');
        }
        $filters = $reportUser['role'] === 'dean' ? ['department' => $reportUser['department']] : [];
        send_json([
            'status' => 'submitted',
            'submitted_at' => gmdate('Y-m-d\TH:i:s\Z'),
            'reports' => evaluation_reports($pdo, $filters),
            'submitted_by' => $reportUser['displayName'],
        ]);
    }

    if ($method === 'GET' && $route === '/settings/criteria') {
        require_user($user, ['admin', 'dean', 'student']);
        send_json(['criteria' => get_criteria($pdo)]);
    }

    if ($method === 'GET' && $route === '/settings/questions') {
        require_user($user, ['admin', 'dean', 'student']);
        send_json(['questions' => get_questions($pdo)]);
    }

    if ($method === 'PUT' && $route === '/admin/settings/questions') {
        $admin = require_user($user, ['admin']);
        $questions = request_body()['questions'] ?? null;
        if (!is_array($questions) || count($questions) !== 29) {
            fail_request(400, 'Provide all 29 evaluation questions.');
        }

        $questionTexts = [];
        foreach ($questions as $question) {
            if (!is_array($question)
                || !is_int($question['id'] ?? null)
                || $question['id'] < 1
                || $question['id'] > 29
                || !is_string($question['text'] ?? null)
                || strlen(trim($question['text'])) < 5
                || strlen(trim($question['text'])) > 1000
                || isset($questionTexts[$question['id']])) {
                fail_request(400, 'Each question must have a unique number from 1 to 29 and valid wording.');
            }
            $questionTexts[$question['id']] = trim($question['text']);
        }
        if (count($questionTexts) !== 29) {
            fail_request(400, 'Questions must include every number from 1 to 29 exactly once.');
        }

        try {
            $pdo->beginTransaction();
            $update = $pdo->prepare('UPDATE evaluation_questions SET question_text = ? WHERE id = ?');
            foreach ($questionTexts as $questionId => $text) {
                $update->execute([$text, $questionId]);
                if (!$update->rowCount()) {
                    $exists = $pdo->prepare('SELECT id FROM evaluation_questions WHERE id = ?');
                    $exists->execute([$questionId]);
                    if (!$exists->fetchColumn()) {
                        fail_request(400, 'The question database is missing an expected question number.');
                    }
                }
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
        record_activity($pdo, $admin, 'evaluation.questions.updated', 'Updated evaluation question wording.');
        send_json(['status' => 'updated', 'questions' => get_questions($pdo)]);
    }

    if ($method === 'PUT' && $route === '/admin/settings/criteria') {
        $admin = require_user($user, ['admin']);
        $criteria = request_body()['criteria'] ?? null;
        if (!is_array($criteria) || count($criteria) < 1 || count($criteria) > 20) {
            fail_request(400, 'Provide 1 to 20 evaluation criteria.');
        }
        $usedQuestions = [];
        foreach ($criteria as $item) {
            if (!is_array($item) || !is_string($item['name'] ?? null) || strlen(trim($item['name'])) < 2 || strlen(trim($item['name'])) > 80 || !is_array($item['questionIds'] ?? null) || !$item['questionIds']) {
                fail_request(400, 'Each criterion needs a name and at least one question number.');
            }
            foreach ($item['questionIds'] as $id) {
                if (!is_int($id) || $id < 1 || $id > 29 || isset($usedQuestions[$id])) {
                    fail_request(400, 'Each question number from 1 to 29 must appear once only.');
                }
                $usedQuestions[$id] = true;
            }
        }
        if (count($usedQuestions) !== 29) {
            fail_request(400, 'Criteria must cover all 29 existing questions exactly once.');
        }
        try {
            $pdo->beginTransaction();
            $pdo->exec('DELETE FROM criterion_questions');
            $pdo->exec('DELETE FROM evaluation_criteria');
            $insertCriterion = $pdo->prepare('INSERT INTO evaluation_criteria (name, sort_order) VALUES (?, ?)');
            $insertQuestion = $pdo->prepare('INSERT INTO criterion_questions (criterion_id, question_id) VALUES (?, ?)');
            foreach (array_values($criteria) as $index => $item) {
                $insertCriterion->execute([trim($item['name']), $index + 1]);
                $criterionId = (int) $pdo->lastInsertId();
                foreach ($item['questionIds'] as $questionId) {
                    $insertQuestion->execute([$criterionId, $questionId]);
                }
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
        record_activity($pdo, $admin, 'evaluation.criteria.updated', 'Updated evaluation criteria.');
        send_json(['status' => 'updated', 'criteria' => get_criteria($pdo)]);
    }

    if ($method === 'GET' && $route === '/admin/users') {
        require_user($user, ['admin']);
        $statement = $pdo->query(
            "SELECT u.id, u.username, u.role, u.display_name,
                    COALESCE(NULLIF(deans.department, ''), d.name, u.department) AS department,
                    u.active, u.created_at,
                    s.student_number, s.course_id, COALESCE(c.course_name, s.course) AS course,
                    c.course_code AS course_code, s.year_level, d.id AS department_id
             FROM users u
             LEFT JOIN students s ON s.user_id = u.id
             LEFT JOIN courses c ON c.id = s.course_id
             LEFT JOIN departments d ON d.id = u.department_id
             LEFT JOIN deans ON deans.user_id = u.id
             ORDER BY u.role, u.display_name"
        );
        $accounts = $statement->fetchAll();
        $studentSubjects = $pdo->query('SELECT student_user_id, subject_id FROM student_subjects')->fetchAll();
        $subjectsByStudent = [];
        foreach ($studentSubjects as $studentSubject) {
            $subjectsByStudent[(int) $studentSubject['student_user_id']][] = (int) $studentSubject['subject_id'];
        }
        foreach ($accounts as &$account) {
            $account['id'] = (int) $account['id'];
            $account['active'] = (int) $account['active'];
            $account['department_id'] = $account['department_id'] === null ? null : (int) $account['department_id'];
            $account['subject_ids'] = $subjectsByStudent[$account['id']] ?? [];
        }
        unset($account);
        send_json($accounts);
    }

    if ($method === 'POST' && $route === '/admin/users') {
        $admin = require_user($user, ['admin']);
        $body = request_body();
        $username = trim((string) ($body['username'] ?? ''));
        $password = (string) ($body['password'] ?? '');
        $role = (string) ($body['role'] ?? '');
        $displayName = trim((string) ($body['displayName'] ?? ''));
        $department = trim((string) ($body['department'] ?? ''));
        $studentNumber = trim((string) ($body['studentNumber'] ?? ''));
        $courseValue = $body['courseId'] ?? null;
        $courseId = $courseValue === null || $courseValue === '' ? null : filter_var($courseValue, FILTER_VALIDATE_INT);
        $yearLevel = trim((string) ($body['yearLevel'] ?? ''));
        $subjectIds = $body['subjectIds'] ?? [];
        if (!is_array($subjectIds)) {
            fail_request(400, 'Choose a valid list of student subjects.');
        }
        $normalizedSubjectIds = [];
        foreach ($subjectIds as $subjectId) {
            $id = filter_var($subjectId, FILTER_VALIDATE_INT);
            if ($id === false || $id < 1 || isset($normalizedSubjectIds[$id])) {
                fail_request(400, 'Choose valid subjects for this student.');
            }
            $normalizedSubjectIds[$id] = $id;
        }
        $subjectIds = array_values($normalizedSubjectIds);
        if (!preg_match('/^[a-zA-Z0-9._-]{3,64}$/', $username) || strlen($password) < 12 || strlen($password) > 256 || !in_array($role, ['admin', 'dean', 'student'], true) || strlen($displayName) < 2 || strlen($displayName) > 120 || !valid_department($pdo, $department) || ($role === 'dean' && $department === '') || ($role === 'student' && (strlen($studentNumber) < 1 || strlen($studentNumber) > 64 || ($courseId !== null && $courseId === false) || strlen($yearLevel) > 32))) {
            fail_request(400, 'Provide a valid username, password (at least 12 characters), role, and display name.');
        }
        $courseName = '';
        if ($role === 'student' && $courseId !== null) {
            $courseQuery = $pdo->prepare('SELECT course_name FROM courses WHERE id = ?');
            $courseQuery->execute([$courseId]);
            $courseName = (string) ($courseQuery->fetchColumn() ?: '');
            if ($courseName === '') {
                fail_request(400, 'Choose an existing course for this student.');
            }
        }
        if ($role !== 'student' && $subjectIds) {
            fail_request(400, 'Subjects can only be assigned to student accounts.');
        }
        if ($subjectIds) {
            $placeholders = implode(',', array_fill(0, count($subjectIds), '?'));
            $validSubjects = $pdo->prepare("SELECT COUNT(*) FROM subjects WHERE id IN ($placeholders)");
            $validSubjects->execute($subjectIds);
            if ((int) $validSubjects->fetchColumn() !== count($subjectIds)) {
                fail_request(400, 'Choose existing subjects for this student.');
            }
        }
        $departmentId = department_id($pdo, $department);
        try {
            $pdo->beginTransaction();
            $statement = $pdo->prepare(
                'INSERT INTO users (username, password_hash, role, display_name, department, department_id) VALUES (?, ?, ?, ?, ?, ?)'
            );
            $statement->execute([$username, password_hash($password, PASSWORD_DEFAULT), $role, $displayName, $department, $departmentId]);
            $newUserId = (int) $pdo->lastInsertId();
            if ($role === 'student') {
                $student = $pdo->prepare(
                    'INSERT INTO students (user_id, student_number, course, course_id, year_level) VALUES (?, ?, ?, ?, ?)'
                );
                $student->execute([$newUserId, $studentNumber, $courseName, $courseId ?: null, $yearLevel]);
                $linkSubject = $pdo->prepare('INSERT INTO student_subjects (student_user_id, subject_id) VALUES (?, ?)');
                foreach ($subjectIds as $subjectId) {
                    $linkSubject->execute([$newUserId, $subjectId]);
                }
            } elseif ($role === 'dean') {
                $dean = $pdo->prepare('INSERT INTO deans (user_id, department) VALUES (?, ?)');
                $dean->execute([$newUserId, $department]);
            }
            $pdo->commit();
        } catch (PDOException $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            if (unique_conflict($error)) {
                fail_request(409, 'That username or student number is already in use.');
            }
            throw $error;
        }
        record_activity($pdo, $admin, 'account.created', 'Created ' . $role . ' account ' . $newUserId . '.');
        send_json(['status' => 'created'], 201);
    }

    if (preg_match('~^/admin/users/(\d+)$~', $route, $match)) {
        $admin = require_user($user, ['admin']);
        $accountId = (int) $match[1];
        if ($method === 'PATCH') {
            $active = request_body()['active'] ?? null;
            if (!is_bool($active)) {
                fail_request(400, 'Provide a valid account ID and active status.');
            }
            if ($accountId === (int) $admin['id'] && !$active) {
                fail_request(400, 'You cannot disable your own account.');
            }
            $statement = $pdo->prepare('UPDATE users SET active = ? WHERE id = ?');
            $statement->execute([$active ? 1 : 0, $accountId]);
            if (!$statement->rowCount()) {
                $exists = $pdo->prepare('SELECT id FROM users WHERE id = ?');
                $exists->execute([$accountId]);
                if (!$exists->fetchColumn()) {
                    fail_request(404, 'Account not found.');
                }
            }
            record_activity($pdo, $admin, 'account.status.updated', 'Changed account status for account ' . $accountId . '.');
            send_json(['status' => 'updated']);
        }
        if ($method === 'DELETE') {
            $lookup = $pdo->prepare('SELECT role FROM users WHERE id = ?');
            $lookup->execute([$accountId]);
            $role = $lookup->fetchColumn();
            if ($role === false) {
                fail_request(404, 'Account not found.');
            }
            if (!in_array($role, ['student', 'dean'], true)) {
                fail_request(400, 'Only Student and Dean accounts can be deleted here.');
            }
            if ($role === 'student') {
                $hasEvaluations = $pdo->prepare('SELECT 1 FROM evaluation_duplicate_guards WHERE student_user_id = ? LIMIT 1');
                $hasEvaluations->execute([$accountId]);
                if ($hasEvaluations->fetchColumn()) {
                    fail_request(409, 'This student has submitted evaluations. Disable the account to preserve evaluation records.');
                }
            }
            $delete = $pdo->prepare('DELETE FROM users WHERE id = ?');
            $delete->execute([$accountId]);
            record_activity($pdo, $admin, 'account.deleted', 'Deleted ' . $role . ' account ' . $accountId . '.');
            send_json(['status' => 'deleted']);
        }
        if ($method === 'PUT') {
            $body = request_body();
            $displayName = trim((string) ($body['displayName'] ?? ''));
            $password = $body['password'] ?? null;
            if (strlen($displayName) < 2 || strlen($displayName) > 120 || ($password !== null && (!is_string($password) || strlen($password) < 12 || strlen($password) > 256))) {
                fail_request(400, 'Provide a valid account name and optional password of at least 12 characters.');
            }
            $lookup = $pdo->prepare(
                'SELECT u.role, u.username, s.student_number, s.course, s.course_id, s.year_level
                 FROM users u LEFT JOIN students s ON s.user_id = u.id
                 WHERE u.id = ?'
            );
            $lookup->execute([$accountId]);
            $account = $lookup->fetch();
            if (!$account) {
                fail_request(404, 'Account not found.');
            }
            $role = $account['role'];
            $department = trim((string) ($body['department'] ?? ''));
            if (!valid_department($pdo, $department) || ($role === 'dean' && $department === '')) {
                fail_request(400, 'Choose an existing department for this account.');
            }
            $studentNumber = trim((string) ($body['studentNumber'] ?? $account['student_number'] ?? $account['username']));
            $courseValue = array_key_exists('courseId', $body) ? $body['courseId'] : ($account['course_id'] ?? null);
            $courseId = $courseValue === null || $courseValue === '' ? null : filter_var($courseValue, FILTER_VALIDATE_INT);
            $yearLevel = trim((string) ($body['yearLevel'] ?? $account['year_level'] ?? ''));
            $courseName = '';
            if ($role === 'student') {
                if (strlen($studentNumber) < 1 || strlen($studentNumber) > 64 || ($courseId !== null && $courseId === false) || strlen($yearLevel) > 32) {
                    fail_request(400, 'Provide a valid student number, optional course, and year level.');
                }
                if ($courseId !== null) {
                    $courseQuery = $pdo->prepare('SELECT course_name FROM courses WHERE id = ?');
                    $courseQuery->execute([$courseId]);
                    $courseName = (string) ($courseQuery->fetchColumn() ?: '');
                    if ($courseName === '') {
                        fail_request(400, 'Choose an existing course for this student.');
                    }
                }
            }
            $subjectsProvided = array_key_exists('subjectIds', $body);
            $subjectIds = $subjectsProvided ? $body['subjectIds'] : [];
            if ($subjectsProvided && !is_array($subjectIds)) {
                fail_request(400, 'Choose a valid list of student subjects.');
            }
            $normalizedSubjectIds = [];
            foreach ($subjectIds as $subjectId) {
                $id = filter_var($subjectId, FILTER_VALIDATE_INT);
                if ($id === false || $id < 1 || isset($normalizedSubjectIds[$id])) {
                    fail_request(400, 'Choose valid subjects for this student.');
                }
                $normalizedSubjectIds[$id] = $id;
            }
            $subjectIds = array_values($normalizedSubjectIds);
            if ($role !== 'student' && $subjectIds) {
                fail_request(400, 'Subjects can only be assigned to student accounts.');
            }
            if ($subjectIds) {
                $placeholders = implode(',', array_fill(0, count($subjectIds), '?'));
                $validSubjects = $pdo->prepare("SELECT COUNT(*) FROM subjects WHERE id IN ($placeholders)");
                $validSubjects->execute($subjectIds);
                if ((int) $validSubjects->fetchColumn() !== count($subjectIds)) {
                    fail_request(400, 'Choose existing subjects for this student.');
                }
            }
            $departmentId = department_id($pdo, $department);
            try {
                $pdo->beginTransaction();
                if ($password !== null && $password !== '') {
                    $update = $pdo->prepare('UPDATE users SET display_name = ?, department = ?, department_id = ?, password_hash = ? WHERE id = ?');
                    $update->execute([$displayName, $department, $departmentId, password_hash($password, PASSWORD_DEFAULT), $accountId]);
                } else {
                    $update = $pdo->prepare('UPDATE users SET display_name = ?, department = ?, department_id = ? WHERE id = ?');
                    $update->execute([$displayName, $department, $departmentId, $accountId]);
                }
                if ($role === 'student') {
                    $student = $pdo->prepare(
                        'INSERT INTO students (user_id, student_number, course, course_id, year_level) VALUES (?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE student_number = VALUES(student_number),
                                                 course = VALUES(course), course_id = VALUES(course_id),
                                                 year_level = VALUES(year_level)'
                    );
                    $student->execute([$accountId, $studentNumber, $courseName, $courseId ?: null, $yearLevel]);
                    if ($subjectsProvided) {
                        $pdo->prepare('DELETE FROM student_subjects WHERE student_user_id = ?')->execute([$accountId]);
                        $linkSubject = $pdo->prepare('INSERT INTO student_subjects (student_user_id, subject_id) VALUES (?, ?)');
                        foreach ($subjectIds as $subjectId) {
                            $linkSubject->execute([$accountId, $subjectId]);
                        }
                    }
                } elseif ($role === 'dean') {
                    $dean = $pdo->prepare(
                        'INSERT INTO deans (user_id, department) VALUES (?, ?)
                         ON DUPLICATE KEY UPDATE department = VALUES(department)'
                    );
                    $dean->execute([$accountId, $department]);
                }
                $pdo->commit();
            } catch (Throwable $error) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                if ($error instanceof PDOException && unique_conflict($error)) {
                    fail_request(409, 'That student number is already in use.');
                }
                throw $error;
            }
            if ($accountId === (int) $admin['id']) {
                $_SESSION['user_name'] = $displayName;
            }
            record_activity($pdo, $admin, 'account.updated', 'Updated ' . $role . ' account ' . $accountId . '.');
            send_json(['status' => 'updated']);
        }
    }

    if ($route === '/admin/courses' && in_array($method, ['POST'], true)) {
        $admin = require_user($user, ['admin']);
        $body = request_body();
        $courseCode = trim((string) ($body['courseCode'] ?? ''));
        $courseName = trim((string) ($body['courseName'] ?? ''));
        $department = trim((string) ($body['department'] ?? ''));
        $subjectIds = $body['subjectIds'] ?? [];
        if (!preg_match('/^[A-Za-z0-9._-]{1,32}$/', $courseCode) || strlen($courseName) < 2 || strlen($courseName) > 160 || !valid_department($pdo, $department) || !is_array($subjectIds)) {
            fail_request(400, 'Provide a valid course code, course name, and subject list.');
        }
        $departmentId = department_id($pdo, $department);
        $subjectIds = array_values(array_unique(array_filter($subjectIds, static fn($id): bool => filter_var($id, FILTER_VALIDATE_INT) !== false)));
        if (count($subjectIds) !== count($body['subjectIds'] ?? [])) {
            fail_request(400, 'Choose valid subjects for this course.');
        }
        try {
            $pdo->beginTransaction();
            $insert = $pdo->prepare('INSERT INTO courses (course_code, course_name, department_id) VALUES (?, ?, ?)');
            $insert->execute([$courseCode, $courseName, $departmentId]);
            $courseId = (int) $pdo->lastInsertId();
            $link = $pdo->prepare('INSERT INTO course_subjects (course_id, subject_id) VALUES (?, ?)');
            foreach ($subjectIds as $subjectId) {
                $link->execute([$courseId, (int) $subjectId]);
            }
            $pdo->commit();
        } catch (PDOException $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            if (unique_conflict($error)) {
                fail_request(409, 'That course code or name is already in use.');
            }
            if ($error->getCode() === '23000') {
                fail_request(400, 'Choose existing subjects for this course.');
            }
            throw $error;
        }
        record_activity($pdo, $admin, 'course.created', 'Created course ' . $courseName . '.');
        send_json(['status' => 'created', 'id' => $courseId], 201);
    }

    if (preg_match('~^/admin/courses/(\d+)$~', $route, $match)) {
        $admin = require_user($user, ['admin']);
        $courseId = (int) $match[1];
        if ($method === 'PUT') {
            $body = request_body();
            $courseCode = trim((string) ($body['courseCode'] ?? ''));
            $courseName = trim((string) ($body['courseName'] ?? ''));
            $department = trim((string) ($body['department'] ?? ''));
            $subjectIds = $body['subjectIds'] ?? [];
            if (!preg_match('/^[A-Za-z0-9._-]{1,32}$/', $courseCode) || strlen($courseName) < 2 || strlen($courseName) > 160 || !valid_department($pdo, $department) || !is_array($subjectIds)) {
                fail_request(400, 'Provide a valid course code, course name, and subject list.');
            }
            $departmentId = department_id($pdo, $department);
            $subjectIds = array_values(array_unique(array_filter($subjectIds, static fn($id): bool => filter_var($id, FILTER_VALIDATE_INT) !== false)));
            if (count($subjectIds) !== count($body['subjectIds'] ?? [])) {
                fail_request(400, 'Choose valid subjects for this course.');
            }
            try {
                $pdo->beginTransaction();
                $update = $pdo->prepare('UPDATE courses SET course_code = ?, course_name = ?, department_id = ? WHERE id = ?');
                $update->execute([$courseCode, $courseName, $departmentId, $courseId]);
                if (!$update->rowCount()) {
                    $exists = $pdo->prepare('SELECT id FROM courses WHERE id = ?');
                    $exists->execute([$courseId]);
                    if (!$exists->fetchColumn()) {
                        $pdo->rollBack();
                        fail_request(404, 'Course not found.');
                    }
                }
                $pdo->prepare('DELETE FROM course_subjects WHERE course_id = ?')->execute([$courseId]);
                $link = $pdo->prepare('INSERT INTO course_subjects (course_id, subject_id) VALUES (?, ?)');
                foreach ($subjectIds as $subjectId) {
                    $link->execute([$courseId, (int) $subjectId]);
                }
                $pdo->commit();
            } catch (PDOException $error) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                if (unique_conflict($error)) {
                    fail_request(409, 'That course code or name is already in use.');
                }
                if ($error->getCode() === '23000') {
                    fail_request(400, 'Choose existing subjects for this course.');
                }
                throw $error;
            }
            record_activity($pdo, $admin, 'course.updated', 'Updated course ' . $courseId . '.');
            send_json(['status' => 'updated']);
        }
        if ($method === 'DELETE') {
            $delete = $pdo->prepare('DELETE FROM courses WHERE id = ?');
            $delete->execute([$courseId]);
            if (!$delete->rowCount()) {
                fail_request(404, 'Course not found.');
            }
            record_activity($pdo, $admin, 'course.deleted', 'Deleted course ' . $courseId . '.');
            send_json(['status' => 'deleted']);
        }
    }

    if ($method === 'POST' && $route === '/admin/subjects') {
        $admin = require_user($user, ['admin']);
        $body = request_body();
        $subjectCode = trim((string) ($body['subjectCode'] ?? ''));
        $name = trim((string) ($body['name'] ?? ''));
        $department = trim((string) ($body['department'] ?? ''));
        $teacher = trim((string) ($body['teacher'] ?? ''));
        if ($subjectCode === '') {
            $subjectCode = catalog_code($name, 'SUBJECT');
        }
        if (!preg_match('/^[A-Za-z0-9._-]{1,32}$/', $subjectCode) || strlen($name) < 2 || strlen($name) > 160 || !valid_department($pdo, $department)) {
            fail_request(400, 'Provide a valid subject code, name, and department.');
        }
        $departmentId = department_id($pdo, $department);
        $semester = (string) ($body['semester'] ?? '');
        $academicYear = trim((string) ($body['academicYear'] ?? ''));
        if (($semester !== '' && !in_array($semester, ['1st Semester', '2nd Semester', 'Summer'], true)) || strlen($academicYear) > 32) {
            fail_request(400, 'Provide a valid semester and academic year.');
        }
        $teacherId = null;
        if ($teacher !== '') {
            $teacherQuery = $pdo->prepare('SELECT id FROM teachers WHERE name = ?');
            $teacherQuery->execute([$teacher]);
            $teacherId = $teacherQuery->fetchColumn();
            if ($teacherId === false) {
                fail_request(400, 'Choose an existing teacher from the catalog.');
            }
        }
        try {
            $pdo->beginTransaction();
            if ($teacherId === null) {
                $insertSubject = $pdo->prepare('INSERT INTO subjects (subject_code, name, department, department_id) VALUES (?, ?, ?, ?)');
                $insertSubject->execute([$subjectCode, $name, $department, $departmentId]);
                $subjectId = (int) $pdo->lastInsertId();
            } else {
                $subjectId = create_or_find_subject($pdo, $name, $department, $subjectCode);
                $assignment = $pdo->prepare(
                    'INSERT INTO teacher_subjects (teacher_id, subject_id, semester, academic_year) VALUES (?, ?, ?, ?)'
                );
                $assignment->execute([(int) $teacherId, $subjectId, $semester, $academicYear]);
            }
            $pdo->commit();
        } catch (PDOException $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            if (unique_conflict($error)) {
                fail_request(409, $teacherId === null
                    ? 'A subject with that name already exists.'
                    : 'That subject assignment already exists for this semester and academic year.');
            }
            throw $error;
        }
        record_activity($pdo, $admin, 'subject.created', 'Created or assigned subject ' . $name . '.');
        send_json(['status' => 'created'], 201);
    }

    if ($route === '/admin/assignments' && $method === 'POST') {
        $admin = require_user($user, ['admin']);
        $body = request_body();
        $teacherId = filter_var($body['teacherId'] ?? null, FILTER_VALIDATE_INT);
        $subjectId = filter_var($body['subjectId'] ?? null, FILTER_VALIDATE_INT);
        $semester = (string) ($body['semester'] ?? '');
        $yearLevel = trim((string) ($body['yearLevel'] ?? ''));
        $academicYear = trim((string) ($body['academicYear'] ?? ''));
        if (!$teacherId || !$subjectId || !in_array($semester, ['1st Semester', '2nd Semester', 'Summer'], true) || strlen($yearLevel) > 32 || strlen($academicYear) < 1 || strlen($academicYear) > 32) {
            fail_request(400, 'Choose a teacher, subject, semester, and valid academic year.');
        }
        try {
            $statement = $pdo->prepare(
                'INSERT INTO teacher_subjects (teacher_id, subject_id, semester, year_level, academic_year) VALUES (?, ?, ?, ?, ?)'
            );
            $statement->execute([$teacherId, $subjectId, $semester, $yearLevel, $academicYear]);
        } catch (PDOException $error) {
            if (unique_conflict($error)) {
                fail_request(409, 'That teacher is already assigned to this subject for the selected term.');
            }
            if ($error->getCode() === '23000') {
                fail_request(400, 'Choose an existing teacher and subject.');
            }
            throw $error;
        }
        record_activity($pdo, $admin, 'assignment.created', 'Created teacher-subject assignment.');
        send_json(['status' => 'created'], 201);
    }

    if (preg_match('~^/admin/assignments/(\d+)$~', $route, $match)) {
        $admin = require_user($user, ['admin']);
        $assignmentId = (int) $match[1];
        if ($method === 'PUT') {
            $body = request_body();
            $teacherId = filter_var($body['teacherId'] ?? null, FILTER_VALIDATE_INT);
            $subjectId = filter_var($body['subjectId'] ?? null, FILTER_VALIDATE_INT);
            $semester = (string) ($body['semester'] ?? '');
            $yearLevel = trim((string) ($body['yearLevel'] ?? ''));
            $academicYear = trim((string) ($body['academicYear'] ?? ''));
            if (!$teacherId || !$subjectId || ($semester !== '' && !in_array($semester, ['1st Semester', '2nd Semester', 'Summer'], true)) || strlen($yearLevel) > 32 || strlen($academicYear) > 32 || ($semester === '' && $yearLevel === '' && $academicYear === '')) {
                fail_request(400, 'Choose a teacher, subject, semester, and valid academic year.');
            }
            try {
                $statement = $pdo->prepare(
                    'UPDATE teacher_subjects
                     SET teacher_id = ?, subject_id = ?, semester = ?, year_level = ?, academic_year = ?
                     WHERE id = ?'
                );
                $statement->execute([$teacherId, $subjectId, $semester, $yearLevel, $academicYear, $assignmentId]);
            } catch (PDOException $error) {
                if (unique_conflict($error)) {
                    fail_request(409, 'That teacher is already assigned to this subject for the selected term.');
                }
                if ($error->getCode() === '23000') {
                    fail_request(400, 'Choose an existing teacher and subject.');
                }
                throw $error;
            }
            if (!$statement->rowCount()) {
                $exists = $pdo->prepare('SELECT id FROM teacher_subjects WHERE id = ?');
                $exists->execute([$assignmentId]);
                if (!$exists->fetchColumn()) {
                    fail_request(404, 'Teacher assignment not found.');
                }
            }
            record_activity($pdo, $admin, 'assignment.updated', 'Updated teacher-subject assignment ' . $assignmentId . '.');
            send_json(['status' => 'updated']);
        }
        if ($method === 'DELETE') {
            $statement = $pdo->prepare('DELETE FROM teacher_subjects WHERE id = ?');
            $statement->execute([$assignmentId]);
            if (!$statement->rowCount()) {
                fail_request(404, 'Teacher assignment not found.');
            }
            record_activity($pdo, $admin, 'assignment.deleted', 'Deleted teacher-subject assignment ' . $assignmentId . '.');
            send_json(['status' => 'deleted']);
        }
    }

    if (preg_match('~^/admin/subjects/(\d+)$~', $route, $match)) {
        $admin = require_user($user, ['admin']);
        $subjectId = (int) $match[1];
        if ($method === 'PUT') {
            $body = request_body();
            $subjectCode = trim((string) ($body['subjectCode'] ?? ''));
            $name = trim((string) ($body['name'] ?? ''));
            $department = trim((string) ($body['department'] ?? ''));
            if ($subjectCode === '') {
                $subjectCode = catalog_code($name, 'SUBJECT');
            }
            if (!preg_match('/^[A-Za-z0-9._-]{1,32}$/', $subjectCode) || strlen($name) < 2 || strlen($name) > 160 || !valid_department($pdo, $department)) {
                fail_request(400, 'Provide a valid subject code, name, and department.');
            }
            $departmentId = department_id($pdo, $department);
            try {
                $update = $pdo->prepare('UPDATE subjects SET subject_code = ?, name = ?, department = ?, department_id = ? WHERE id = ?');
                $update->execute([$subjectCode, $name, $department, $departmentId, $subjectId]);
            } catch (PDOException $error) {
                if (unique_conflict($error)) {
                    fail_request(409, 'That subject code or name is already in use.');
                }
                throw $error;
            }
            if (!$update->rowCount()) {
                $lookup = $pdo->prepare('SELECT id FROM subjects WHERE id = ?');
                $lookup->execute([$subjectId]);
                if (!$lookup->fetchColumn()) {
                    fail_request(404, 'Subject not found.');
                }
            }
            record_activity($pdo, $admin, 'subject.updated', 'Updated subject ' . $subjectId . '.');
            send_json(['status' => 'updated']);
        }
        if ($method === 'DELETE') {
            $delete = $pdo->prepare('DELETE FROM subjects WHERE id = ?');
            $delete->execute([$subjectId]);
            if (!$delete->rowCount()) {
                fail_request(404, 'Subject not found.');
            }
            record_activity($pdo, $admin, 'subject.deleted', 'Deleted subject ' . $subjectId . '.');
            send_json(['status' => 'deleted']);
        }
    }

    if ($route === '/admin/teachers' && $method === 'POST') {
        $admin = require_user($user, ['admin']);
        $body = request_body();
        $teacherCode = trim((string) ($body['teacherCode'] ?? ''));
        $name = trim((string) ($body['name'] ?? ''));
        $department = trim((string) ($body['department'] ?? ''));
        if ($teacherCode === '') {
            $teacherCode = 'T-' . strtoupper(substr(bin2hex(random_bytes(6)), 0, 10));
        }
        if (!preg_match('/^[A-Za-z0-9._-]{1,64}$/', $teacherCode) || strlen($name) < 2 || strlen($name) > 120 || !valid_department($pdo, $department)) {
            fail_request(400, 'Provide a valid teacher ID, name, and department.');
        }
        $departmentId = department_id($pdo, $department);
        try {
            $statement = $pdo->prepare('INSERT INTO teachers (teacher_code, name, department, department_id) VALUES (?, ?, ?, ?)');
            $statement->execute([$teacherCode, $name, $department, $departmentId]);
        } catch (PDOException $error) {
            if (unique_conflict($error)) {
                fail_request(409, 'That teacher ID or name is already in use.');
            }
            throw $error;
        }
        record_activity($pdo, $admin, 'teacher.created', 'Created teacher record ' . $teacherCode . '.');
        send_json(['status' => 'created'], 201);
    }

    if (preg_match('~^/admin/teachers/(\d+)$~', $route, $match)) {
        $admin = require_user($user, ['admin']);
        $teacherId = (int) $match[1];
        if ($method === 'PATCH') {
            $body = request_body();
            $teacherCode = trim((string) ($body['teacherCode'] ?? ''));
            $name = trim((string) ($body['name'] ?? ''));
            $department = trim((string) ($body['department'] ?? ''));
            if ($teacherCode === '') {
                $teacherCode = 'T-' . strtoupper(substr(bin2hex(random_bytes(6)), 0, 10));
            }
            if (!preg_match('/^[A-Za-z0-9._-]{1,64}$/', $teacherCode) || strlen($name) < 2 || strlen($name) > 120 || !valid_department($pdo, $department)) {
                fail_request(400, 'Provide a valid teacher ID, name, and department.');
            }
            $departmentId = department_id($pdo, $department);
            try {
                $statement = $pdo->prepare('UPDATE teachers SET teacher_code = ?, name = ?, department = ?, department_id = ? WHERE id = ?');
                $statement->execute([$teacherCode, $name, $department, $departmentId, $teacherId]);
            } catch (PDOException $error) {
                if (unique_conflict($error)) {
                    fail_request(409, 'That teacher ID or name is already in use.');
                }
                throw $error;
            }
            if (!$statement->rowCount()) {
                $lookup = $pdo->prepare('SELECT id FROM teachers WHERE id = ?');
                $lookup->execute([$teacherId]);
                if (!$lookup->fetchColumn()) {
                    fail_request(404, 'Teacher not found.');
                }
            }
            record_activity($pdo, $admin, 'teacher.updated', 'Updated teacher record ' . $teacherId . '.');
            send_json(['status' => 'updated']);
        }
        if ($method === 'DELETE') {
            $statement = $pdo->prepare('DELETE FROM teachers WHERE id = ?');
            $statement->execute([$teacherId]);
            if (!$statement->rowCount()) {
                fail_request(404, 'Teacher not found.');
            }
            record_activity($pdo, $admin, 'teacher.deleted', 'Deleted teacher record ' . $teacherId . '.');
            send_json(['status' => 'deleted']);
        }
    }

    if ($method === 'POST' && $route === '/admin/periods') {
        $admin = require_user($user, ['admin']);
        $body = request_body();
        $name = trim((string) ($body['name'] ?? ''));
        $semester = (string) ($body['semester'] ?? '');
        $academicYear = trim((string) ($body['academicYear'] ?? ''));
        $startsAt = $body['startsAt'] ?? null;
        $endsAt = $body['endsAt'] ?? null;
        if (strlen($name) < 3 || strlen($name) > 120 || !in_array($semester, ['1st Semester', '2nd Semester', 'Summer'], true) || strlen($academicYear) < 1 || !is_string($startsAt) || !is_string($endsAt)) {
            fail_request(400, 'Provide a period name, semester, academic year, and a valid start/end date range.');
        }
        try {
            $start = (new DateTimeImmutable($startsAt))->setTimezone(new DateTimeZone('UTC'));
            $end = (new DateTimeImmutable($endsAt))->setTimezone(new DateTimeZone('UTC'));
        } catch (Throwable) {
            fail_request(400, 'Provide valid start and end dates.');
        }
        if ($start >= $end) {
            fail_request(400, 'The period end date must be later than the start date.');
        }
        try {
            $statement = $pdo->prepare(
                "INSERT INTO evaluation_periods (name, semester, academic_year, starts_at, ends_at, status)
                 VALUES (?, ?, ?, ?, ?, 'closed')"
            );
            $statement->execute([$name, $semester, $academicYear, $start->format('Y-m-d H:i:s'), $end->format('Y-m-d H:i:s')]);
        } catch (PDOException $error) {
            if (unique_conflict($error)) {
                fail_request(409, 'An evaluation period with that name already exists.');
            }
            throw $error;
        }
        record_activity($pdo, $admin, 'evaluation.period.created', 'Created evaluation period ' . $name . '.');
        send_json(['status' => 'created'], 201);
    }

    if (preg_match('~^/admin/periods/(\d+)$~', $route, $match) && $method === 'PATCH') {
        $admin = require_user($user, ['admin']);
        $periodId = (int) $match[1];
        $body = request_body();
        $status = $body['status'] ?? null;
        $lookup = $pdo->prepare('SELECT id, ends_at FROM evaluation_periods WHERE id = ?');
        $lookup->execute([$periodId]);
        $period = $lookup->fetch();
        if (!$period) {
            fail_request(404, 'Evaluation period not found.');
        }
        if ($status !== null) {
            if (!in_array($status, ['open', 'closed'], true)) {
                fail_request(400, 'Provide a valid open/closed status.');
            }
            if ($status === 'open' && strtotime($period['ends_at'] . ' UTC') < time()) {
                fail_request(400, 'An expired evaluation period cannot be reopened.');
            }
            $pdo->beginTransaction();
            if ($status === 'open') {
                $pdo->exec("UPDATE evaluation_periods SET status = 'closed' WHERE status = 'open'");
            }
            $update = $pdo->prepare('UPDATE evaluation_periods SET status = ? WHERE id = ?');
            $update->execute([$status, $periodId]);
            $pdo->commit();
            record_activity($pdo, $admin, 'evaluation.period.status.updated', 'Set period ' . $periodId . ' to ' . $status . '.');
            send_json(['status' => 'updated']);
        }

        $name = trim((string) ($body['name'] ?? ''));
        $semester = (string) ($body['semester'] ?? '');
        $academicYear = trim((string) ($body['academicYear'] ?? ''));
        $startsAt = $body['startsAt'] ?? null;
        $endsAt = $body['endsAt'] ?? null;
        if (strlen($name) < 3 || strlen($name) > 120 || !in_array($semester, ['1st Semester', '2nd Semester', 'Summer'], true) || strlen($academicYear) < 1 || !is_string($startsAt) || !is_string($endsAt)) {
            fail_request(400, 'Provide a period name, semester, academic year, and valid start/end dates.');
        }
        try {
            $start = (new DateTimeImmutable($startsAt))->setTimezone(new DateTimeZone('UTC'));
            $end = (new DateTimeImmutable($endsAt))->setTimezone(new DateTimeZone('UTC'));
        } catch (Throwable) {
            fail_request(400, 'Provide valid start and end dates.');
        }
        if ($start >= $end) {
            fail_request(400, 'The period end date must be later than the start date.');
        }
        try {
            $update = $pdo->prepare(
                'UPDATE evaluation_periods
                 SET name = ?, semester = ?, academic_year = ?, starts_at = ?, ends_at = ?
                 WHERE id = ?'
            );
            $update->execute([
                $name,
                $semester,
                $academicYear,
                $start->format('Y-m-d H:i:s'),
                $end->format('Y-m-d H:i:s'),
                $periodId,
            ]);
        } catch (PDOException $error) {
            if (unique_conflict($error)) {
                fail_request(409, 'An evaluation period with that name already exists.');
            }
            throw $error;
        }
        record_activity($pdo, $admin, 'evaluation.period.updated', 'Updated evaluation period ' . $periodId . '.');
        send_json(['status' => 'updated']);
    }

    fail_request(404, 'API endpoint not found.');
} catch (Throwable $error) {
    error_log('Evaluation API error: ' . $error->getMessage());
    if (!headers_sent()) {
        send_json(['error' => 'The request could not be completed. Check the PHP and MySQL server settings.'], 500);
    }
}
