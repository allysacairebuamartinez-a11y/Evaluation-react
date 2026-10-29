import cors from 'cors';
import express, { type Request, type RequestHandler, type Response } from 'express';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT ?? 4000);
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databaseFile = resolve(process.env.OLPCSMI_DATABASE_FILE ?? resolve(serverRoot, 'data', 'olpcsmi.sqlite'));
const dataDirectory = dirname(databaseFile);
const require = createRequire(import.meta.url);
const wasmFile = require.resolve('sql.js/dist/sql-wasm.wasm');
const scrypt = promisify(scryptCallback);
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const roles = ['server', 'client', 'dean'] as const;
const semesters = ['1st Semester', '2nd Semester', 'Summer'] as const;
const departments = [
  'College of Accountancy',
  'College of Business Administration',
  'College of Criminology',
  'College of Hospitality Management',
  'College of Information Technology',
  'College of Teacher Education',
] as const;
const departmentSet: ReadonlySet<string> = new Set(departments);
type Role = typeof roles[number];

type AuthUser = {
  id: number;
  username: string;
  role: Role;
  display_name: string;
  department: string;
};
type LegacyResponse = {
  id?: number;
  studentKey?: string;
  teacher: string;
  subject?: string;
  ratings?: Record<string, number | string>;
  teaching?: number;
  communication?: number;
  fairness?: number;
  comment?: string;
  created_at?: string;
};
type EvaluationAssignment = {
  employee: string;
  subject: string;
  department?: string;
  period?: string;
  status?: string;
};
type EvaluationCriterion = { name: string; questionIds: number[] };

const DEFAULT_CRITERIA: EvaluationCriterion[] = [
  { name: 'Teaching effectiveness', questionIds: [2, 3, 8, 10, 15, 16, 17, 18, 25, 26] },
  { name: 'Communication', questionIds: [4, 9, 20] },
  { name: 'Classroom management', questionIds: [1, 5, 7, 21, 23] },
  { name: 'Punctuality and grading', questionIds: [6, 11, 12, 13, 14] },
  { name: 'Student engagement', questionIds: [19, 22, 24, 27, 28, 29] },
];

const rateLimits = new Map<string, { failures: number; resetAt: number }>();
const developmentSessions = new Map<string, { user: AuthUser; csrfHash: string; expiresAt: number }>();
let database: Database;
let duplicateSecret: string;
let nextDevelopmentUserId = -1;

function queryAll<T extends Record<string, unknown>>(sql: string, values: SqlValue[] = []): T[] {
  const statement = database.prepare(sql);
  try {
    statement.bind(values);
    const result: T[] = [];
    while (statement.step()) result.push(statement.getAsObject() as T);
    return result;
  } finally {
    statement.free();
  }
}

function queryOne<T extends Record<string, unknown>>(sql: string, values: SqlValue[] = []): T | undefined {
  return queryAll<T>(sql, values)[0];
}

function execute(sql: string, values: SqlValue[] = []) {
  database.run(sql, values);
}

function persistDatabase() {
  const temporaryFile = `${databaseFile}.tmp`;
  writeFileSync(temporaryFile, Buffer.from(database.export()));
  renameSync(temporaryFile, databaseFile);
}

function migrateDatabase() {
  database.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('server', 'client', 'dean', 'teacher')),
      display_name TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      department TEXT NOT NULL DEFAULT '',
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      department TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      subject_id INTEGER NOT NULL REFERENCES subjects(id),
      semester TEXT NOT NULL DEFAULT '',
      academic_year TEXT NOT NULL DEFAULT '',
      UNIQUE(teacher_id, subject_id, semester, academic_year)
    );
    CREATE TABLE IF NOT EXISTS periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      semester TEXT NOT NULL DEFAULT '',
      academic_year TEXT NOT NULL DEFAULT '',
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'closed'))
    );
    CREATE TABLE IF NOT EXISTS responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
      teacher_name TEXT NOT NULL,
      subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
      subject_name TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT '',
      period_id INTEGER REFERENCES periods(id) ON DELETE SET NULL,
      period_name TEXT NOT NULL DEFAULT '',
      ratings TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS responses_teacher_idx ON responses(teacher_name);
    CREATE INDEX IF NOT EXISTS responses_department_idx ON responses(department);
    CREATE INDEX IF NOT EXISTS responses_period_idx ON responses(period_name);
    CREATE TABLE IF NOT EXISTS submission_guards (
      student_hash TEXT NOT NULL,
      teacher_name TEXT NOT NULL COLLATE NOCASE,
      subject_name TEXT NOT NULL COLLATE NOCASE,
      period_name TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(student_hash, teacher_name, subject_name, period_name)
    );
  `);
  const departmentAliases = [
    ['College of Information Technology', 'BSIT'],
    ['College of Teacher Education', 'Education'],
  ] as const;
  for (const [department, alias] of departmentAliases) {
    for (const table of ['users', 'teachers', 'subjects', 'responses']) {
      execute(`UPDATE ${table} SET department = ? WHERE department = ?`, [department, alias]);
    }
  }
  execute("INSERT OR IGNORE INTO settings(key, value) VALUES ('duplicate_secret', ?)", [randomBytes(32).toString('hex')]);
  execute("INSERT OR IGNORE INTO settings(key, value) VALUES ('evaluation_criteria', ?)", [JSON.stringify(DEFAULT_CRITERIA)]);
  duplicateSecret = String(queryOne<{ value: string }>("SELECT value FROM settings WHERE key = 'duplicate_secret'")?.value);
  const now = new Date().toISOString();
  execute(
    "INSERT OR IGNORE INTO periods(name, semester, academic_year, starts_at, ends_at, status) VALUES ('Legacy data', '', '', ?, ?, 'closed')",
    [now, now],
  );

  const legacyResponseFile = resolve(serverRoot, 'responses.json');
  const importedResponses = Number(queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM responses')?.count ?? 0);
  if (importedResponses === 0 && existsSync(legacyResponseFile)) {
    const legacyResponses = JSON.parse(readFileSync(legacyResponseFile, 'utf8')) as LegacyResponse[];
    const legacyPeriod = queryOne<{ id: number; name: string }>("SELECT id, name FROM periods WHERE name = 'Legacy data'");
    if (legacyPeriod) {
      database.run('BEGIN');
      try {
        legacyResponses.forEach((item) => {
          const ratingData = item.ratings ?? {
            '1': item.teaching ?? 0,
            '2': item.communication ?? 0,
            '3': item.fairness ?? 0,
          };
          const teacherName = String(item.teacher ?? '').trim();
          const subjectName = String(item.subject ?? 'Student/Teacher Evaluation Questionnaires').trim();
          if (!teacherName) return;
          const teacher = findOrCreateTeacher(teacherName, '');
          const subject = findOrCreateSubject(subjectName, '');
          const createdAt = item.created_at ?? now;
          execute(
            'INSERT INTO responses(teacher_id, teacher_name, subject_id, subject_name, department, period_id, period_name, ratings, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [teacher.id, teacher.name, subject.id, subject.name, teacher.department, legacyPeriod.id, legacyPeriod.name, JSON.stringify(ratingData), String(item.comment ?? ''), createdAt],
          );
          if (item.studentKey) {
            execute(
              'INSERT OR IGNORE INTO submission_guards(student_hash, teacher_name, subject_name, period_name, created_at) VALUES (?, ?, ?, ?, ?)',
              [hashDuplicateKey(item.studentKey), teacher.name, subject.name, legacyPeriod.name, createdAt],
            );
          }
        });
        database.run('COMMIT');
      } catch (error) {
        database.run('ROLLBACK');
        throw error;
      }
    }
  }

  const evaluationFile = resolve(serverRoot, 'evaluations.json');
  if (existsSync(evaluationFile)) {
    const assignments = JSON.parse(readFileSync(evaluationFile, 'utf8')) as EvaluationAssignment[];
    database.run('BEGIN');
    try {
      assignments.forEach((item) => {
        if (item.status && item.status.toLowerCase() !== 'active') return;
        const department = String(item.department ?? '').trim();
        const teacher = findOrCreateTeacher(String(item.employee ?? '').trim(), department);
        const subject = findOrCreateSubject(String(item.subject ?? '').trim(), department);
        if (!teacher.name || !subject.name) return;
        const semester = String(item.period ?? '').trim();
        execute(
          'INSERT OR IGNORE INTO assignments(teacher_id, subject_id, semester, academic_year) VALUES (?, ?, ?, ?)',
          [teacher.id, subject.id, semester, ''],
        );
      });
      database.run('COMMIT');
    } catch (error) {
      database.run('ROLLBACK');
      throw error;
    }
  }
  persistDatabase();
}

function findOrCreateTeacher(name: string, department: string) {
  execute('INSERT OR IGNORE INTO teachers(name, department) VALUES (?, ?)', [name, department]);
  const teacher = queryOne<{ id: number; name: string; department: string }>('SELECT id, name, department FROM teachers WHERE name = ?', [name]);
  if (!teacher) throw new Error('Unable to persist teacher catalog entry.');
  if (!teacher.department && department) execute('UPDATE teachers SET department = ? WHERE id = ?', [department, teacher.id]);
  return { ...teacher, department: teacher.department || department };
}

function findOrCreateSubject(name: string, department: string) {
  execute('INSERT OR IGNORE INTO subjects(name, department) VALUES (?, ?)', [name, department]);
  const subject = queryOne<{ id: number; name: string; department: string }>('SELECT id, name, department FROM subjects WHERE name = ?', [name]);
  if (!subject) throw new Error('Unable to persist subject catalog entry.');
  if (!subject.department && department) execute('UPDATE subjects SET department = ? WHERE id = ?', [department, subject.id]);
  return { ...subject, department: subject.department || department };
}

function hashDuplicateKey(value: string) {
  return createHmac('sha256', duplicateSecret).update(value).digest('hex');
}

function hashSessionToken(value: string) {
  return createHmac('sha256', duplicateSecret).update(`session:${value}`).digest('hex');
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.cookie ?? '';
  const encodedName = `${name}=`;
  const cookie = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(encodedName));
  return cookie ? decodeURIComponent(cookie.slice(encodedName.length)) : '';
}

function setCookie(response: Response, name: string, value: string, options: { httpOnly: boolean; maxAge?: number }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Strict'];
  if (options.httpOnly) parts.push('HttpOnly');
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  response.append('Set-Cookie', parts.join('; '));
}

function isLocalDevelopment(request: Request) {
  const address = request.socket.remoteAddress;
  const host = request.get('host');
  return process.env.NODE_ENV === 'development'
    && (address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1')
    && (host === `localhost:${port}` || host === 'localhost:5173' || host === `127.0.0.1:${port}` || host === '127.0.0.1:5173');
}

function publicUser(user: AuthUser) {
  return { id: user.id, username: user.username, role: user.role, displayName: user.display_name, department: user.department };
}

function validatePassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && value.length <= 256;
}

async function createPasswordHash(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64) as Buffer;
  return { hash: hash.toString('hex'), salt: salt.toString('hex') };
}

async function verifyPassword(password: string, hashHex: string, saltHex: string) {
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function asyncHandler(handler: (request: Request, response: Response) => Promise<void>): RequestHandler {
  return (request, response, next) => {
    void handler(request, response).catch(next);
  };
}

function requireRoles(...allowedRoles: Role[]): RequestHandler {
  return (request, response, next) => {
    const user = response.locals.user as AuthUser | undefined;
    if (!user) {
      response.status(401).json({ error: 'Please sign in to continue.' });
      return;
    }
    if (!allowedRoles.includes(user.role)) {
      response.status(403).json({ error: 'You do not have permission to access this resource.' });
      return;
    }
    next();
  };
}

function requireCsrf(request: Request, response: Response, next: express.NextFunction) {
  const cookieToken = readCookie(request, 'olpcsmi_csrf');
  const headerToken = request.get('X-CSRF-Token') ?? '';
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    response.status(403).json({ error: 'Your secure session expired. Refresh the page and sign in again.' });
    return;
  }
  const tokenHash = hashSessionToken(readCookie(request, 'olpcsmi_session'));
  const suppliedHash = createHmac('sha256', duplicateSecret).update(`csrf:${cookieToken}`).digest('hex');
  const devSession = isLocalDevelopment(request) ? developmentSessions.get(tokenHash) : undefined;
  if (devSession && devSession.expiresAt > Date.now() && devSession.csrfHash === suppliedHash) {
    next();
    return;
  }
  const session = queryOne<{ csrf_hash: string }>(
    'SELECT csrf_hash FROM sessions WHERE token_hash = ? AND expires_at > ?',
    [tokenHash, Date.now()],
  );
  if (!session || session.csrf_hash !== suppliedHash) {
    response.status(403).json({ error: 'Your secure session expired. Refresh the page and sign in again.' });
    return;
  }
  next();
}

function getCurrentUser(request: Request, response: Response, next: express.NextFunction) {
  const token = readCookie(request, 'olpcsmi_session');
  if (!token) {
    next();
    return;
  }
  const tokenHash = hashSessionToken(token);
  if (isLocalDevelopment(request)) {
    const devSession = developmentSessions.get(tokenHash);
    if (devSession) {
      if (devSession.expiresAt > Date.now()) {
        response.locals.user = devSession.user;
        next();
        return;
      }
      developmentSessions.delete(tokenHash);
    }
  }
  const session = queryOne<AuthUser & { expires_at: number }>(
    `SELECT users.id, users.username, users.role, users.display_name, users.department, sessions.expires_at
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ?`,
    [tokenHash],
  );
  if (!session || session.expires_at <= Date.now() || !roles.includes(session.role)) {
    execute('DELETE FROM sessions WHERE token_hash = ?', [hashSessionToken(token)]);
    next();
    return;
  }
  if (!Number(queryOne<{ active: number }>('SELECT active FROM users WHERE id = ?', [session.id])?.active)) {
    execute('DELETE FROM sessions WHERE token_hash = ?', [hashSessionToken(token)]);
    next();
    return;
  }
  response.locals.user = session satisfies AuthUser;
  next();
}

function validateUsername(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9._-]{3,64}$/.test(value);
}

function groupResponses(filters: { teacher?: string; department?: string; subject?: string; period?: string; semester?: string; academicYear?: string; role?: string }) {
  const clauses: string[] = [];
  const values: SqlValue[] = [];
  if (filters.teacher) { clauses.push('teacher_name = ?'); values.push(filters.teacher); }
  if (filters.department) { clauses.push('department = ?'); values.push(filters.department); }
  if (filters.subject) { clauses.push('subject_name = ?'); values.push(filters.subject); }
  if (filters.period) { clauses.push('period_name = ?'); values.push(filters.period); }
  if (filters.semester) { clauses.push('periods.semester = ?'); values.push(filters.semester); }
  if (filters.academicYear) { clauses.push('periods.academic_year = ?'); values.push(filters.academicYear); }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const records = queryAll<{
    teacher_name: string;
    subject_name: string;
    department: string;
    period_name: string;
    ratings: string;
    semester: string;
    academic_year: string;
  }>(
    `SELECT responses.teacher_name, responses.subject_name, responses.department, responses.period_name, responses.ratings,
     COALESCE(periods.semester, '') AS semester, COALESCE(periods.academic_year, '') AS academic_year
     FROM responses LEFT JOIN periods ON periods.id = responses.period_id ${where}`,
    values,
  );
  const grouped = new Map<string, {
    teacher: string;
    subject: string;
    department: string;
    period: string;
    semester: string;
    academicYear: string;
    responses: number;
    ratingTotals: Record<string, { total: number; count: number }>;
  }>();
  records.forEach((record) => {
    const key = [record.teacher_name, record.subject_name, record.department, record.period_name, record.semester, record.academic_year].join('\u001f');
    let group = grouped.get(key);
    if (!group) {
      group = {
        teacher: record.teacher_name,
        subject: record.subject_name,
        department: record.department,
        period: record.period_name,
        semester: record.semester,
        academicYear: record.academic_year,
        responses: 0,
        ratingTotals: {},
      };
      grouped.set(key, group);
    }
    group.responses += 1;
    const ratings = JSON.parse(record.ratings) as Record<string, number | string>;
    Object.entries(ratings).forEach(([questionId, value]) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      const totals = group.ratingTotals[questionId] ?? { total: 0, count: 0 };
      totals.total += value;
      totals.count += 1;
      group.ratingTotals[questionId] = totals;
    });
  });
  return [...grouped.values()].map(({ ratingTotals, ...summary }) => {
    const perQuestion = Object.fromEntries(
      Object.entries(ratingTotals).map(([questionId, item]) => [questionId, Number((item.total / item.count).toFixed(2))]),
    );
    const averageValues = Object.values(perQuestion);
    const mean = averageValues.length
      ? Number((averageValues.reduce((total, value) => total + value, 0) / averageValues.length).toFixed(2))
      : 0;
    return { ...summary, mean, perQuestion };
  }).sort((first, second) => first.teacher.localeCompare(second.teacher) || first.subject.localeCompare(second.subject));
}

function initializeBootstrapAdmin() {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!username && !password) return;
  if (!username || !validateUsername(username) || !validatePassword(password)) {
    throw new Error('Set BOOTSTRAP_ADMIN_USERNAME (3-64 letters/numbers/._-) and BOOTSTRAP_ADMIN_PASSWORD (12-256 characters) together.');
  }
  if (queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM users WHERE role IN (?, ?)', ['server', 'dean'])?.count) return;
  return createPasswordHash(password).then(({ hash, salt }) => {
    execute(
      'INSERT INTO users(username, password_hash, password_salt, role, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [username, hash, salt, 'server', 'System Administrator', new Date().toISOString()],
    );
    persistDatabase();
    console.log(`Initial administrator account "${username}" created. Clear bootstrap environment variables after setup.`);
  });
}

function requireProductionAccounts() {
  if (process.env.NODE_ENV !== 'production') return;
  const missingRoles = roles.filter((role) => !queryOne<{ id: number }>(
    "SELECT id FROM users WHERE role = ? AND active = 1 AND username NOT IN ('demo-admin', 'demo-student', 'demo-dean') AND (? <> 'dean' OR department <> '') LIMIT 1",
    [role, role],
  ));
  if (missingRoles.length) {
    throw new Error(
      `Production requires at least one active, non-demo account for each role. Missing: ${missingRoles.join(', ')}. ` +
      'Run npm run reset:accounts --prefix server with the server stopped, then start production again.',
    );
  }
}

async function startServer() {
  const SQL = await initSqlJs({ locateFile: () => wasmFile });
  mkdirSync(dataDirectory, { recursive: true });
  database = existsSync(databaseFile) ? new SQL.Database(readFileSync(databaseFile)) : new SQL.Database();
  migrateDatabase();
  persistDatabase();
  await initializeBootstrapAdmin();
  requireProductionAccounts();

  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  const permittedOrigins = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...(process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  ]);
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || permittedOrigins.has(origin)) callback(null, true);
      else callback(new Error('Origin is not allowed by CORS policy.'));
    },
  }));
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', getCurrentUser);
  app.use('/api', (request, response, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && request.path !== '/auth/login') {
      requireCsrf(request, response, next);
      return;
    }
    next();
  });

  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));

  app.get('/api/auth/me', (request, response) => {
    const user = response.locals.user as AuthUser | undefined;
    if (!user) {
      response.status(401).json({ error: 'Not signed in.' });
      return;
    }
    response.json({ user: publicUser(user), csrfToken: readCookie(request, 'olpcsmi_csrf') });
  });

  app.post('/api/auth/login', asyncHandler(async (request, response) => {
    const username = typeof request.body?.username === 'string' ? request.body.username.trim() : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    if (isLocalDevelopment(request)) {
      const demoRoles: Record<string, Role> = {
        'demo-admin': 'server',
        'demo-student': 'client',
        'demo-dean': 'dean',
      };
      const demoRole = demoRoles[username.toLocaleLowerCase()];
      if (!demoRole) {
        response.status(400).json({ error: 'Use demo-admin, demo-student, or demo-dean for local demo sign-in.' });
        return;
      }
      const sessionToken = randomBytes(32).toString('base64url');
      const csrfToken = randomBytes(32).toString('base64url');
      const developmentUser: AuthUser = {
        id: nextDevelopmentUserId--,
        username,
        role: demoRole,
        display_name: username,
        department: '',
      };
      developmentSessions.set(hashSessionToken(sessionToken), {
        user: developmentUser,
        csrfHash: createHmac('sha256', duplicateSecret).update(`csrf:${csrfToken}`).digest('hex'),
        expiresAt: Date.now() + SESSION_DURATION_MS,
      });
      setCookie(response, 'olpcsmi_session', sessionToken, { httpOnly: true, maxAge: SESSION_DURATION_MS });
      setCookie(response, 'olpcsmi_csrf', csrfToken, { httpOnly: false, maxAge: SESSION_DURATION_MS });
      response.json({ user: publicUser(developmentUser), csrfToken });
      return;
    }
    const ipAddress = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const rate = rateLimits.get(ipAddress);
    if (rate && rate.resetAt > Date.now() && rate.failures >= LOGIN_LIMIT) {
      response.status(429).json({ error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });
      return;
    }
    const account = queryOne<AuthUser & { password_hash: string; password_salt: string; active: number; locked_until: number }>(
      'SELECT id, username, role, display_name, department, password_hash, password_salt, active, locked_until FROM users WHERE username = ?',
      [username],
    );
    if (!account || !account.active || account.locked_until > Date.now() || !await verifyPassword(password, account.password_hash, account.password_salt)) {
      const nextRate = rate && rate.resetAt > Date.now()
        ? { failures: rate.failures + 1, resetAt: rate.resetAt }
        : { failures: 1, resetAt: Date.now() + LOGIN_WINDOW_MS };
      rateLimits.set(ipAddress, nextRate);
      if (account) {
        const failures = queryOne<{ failed_attempts: number }>('SELECT failed_attempts FROM users WHERE id = ?', [account.id])?.failed_attempts ?? 0;
        const totalFailures = failures + 1;
        execute(
          'UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?',
          [totalFailures % LOGIN_LIMIT, totalFailures >= LOGIN_LIMIT ? Date.now() + LOGIN_WINDOW_MS : 0, account.id],
        );
        persistDatabase();
      }
      response.status(401).json({ error: 'Invalid username or password.' });
      return;
    }
    if (!roles.includes(account.role)) {
      response.status(403).json({ error: 'This account does not have a supported role.' });
      return;
    }
    rateLimits.delete(ipAddress);
    execute('UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?', [account.id]);
    const sessionToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const now = Date.now();
    execute('DELETE FROM sessions WHERE expires_at <= ?', [now]);
    execute(
      'INSERT INTO sessions(token_hash, user_id, csrf_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [
        hashSessionToken(sessionToken),
        account.id,
        createHmac('sha256', duplicateSecret).update(`csrf:${csrfToken}`).digest('hex'),
        now + SESSION_DURATION_MS,
        new Date(now).toISOString(),
      ],
    );
    persistDatabase();
    setCookie(response, 'olpcsmi_session', sessionToken, { httpOnly: true, maxAge: SESSION_DURATION_MS });
    setCookie(response, 'olpcsmi_csrf', csrfToken, { httpOnly: false, maxAge: SESSION_DURATION_MS });
    response.json({ user: publicUser(account), csrfToken });
  }));

  app.post('/api/auth/logout', requireRoles(...roles), (request, response) => {
    const tokenHash = hashSessionToken(readCookie(request, 'olpcsmi_session'));
    developmentSessions.delete(tokenHash);
    execute('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
    persistDatabase();
    setCookie(response, 'olpcsmi_session', '', { httpOnly: true, maxAge: 0 });
    setCookie(response, 'olpcsmi_csrf', '', { httpOnly: false, maxAge: 0 });
    response.json({ status: 'signed_out' });
  });

  app.get('/api/catalog', requireRoles(...roles), (_request, response) => {
    const user = response.locals.user as AuthUser;
    const scopedToDean = user.role === 'dean';
    const teachers = queryAll<{ id: number; name: string; department: string }>(
      'SELECT id, name, department FROM teachers WHERE ? = 0 OR department = ? ORDER BY name',
      [scopedToDean ? 1 : 0, user.department],
    );
    const subjects = queryAll<{ id: number; name: string; department: string }>(
      'SELECT id, name, department FROM subjects WHERE ? = 0 OR department = ? ORDER BY name',
      [scopedToDean ? 1 : 0, user.department],
    );
    const assignments = queryAll<{
      teacher: string; subject: string; department: string; semester: string; academicYear: string;
    }>(
      `SELECT teachers.name AS teacher, subjects.name AS subject,
       CASE WHEN teachers.department = '' THEN subjects.department ELSE teachers.department END AS department,
       assignments.semester, assignments.academic_year AS academicYear
       FROM assignments JOIN teachers ON teachers.id = assignments.teacher_id
       JOIN subjects ON subjects.id = assignments.subject_id
       WHERE ? = 0 OR (CASE WHEN teachers.department = '' THEN subjects.department ELSE teachers.department END) = ?
       ORDER BY teachers.name, subjects.name`,
      [scopedToDean ? 1 : 0, user.department],
    );
    const periods = queryAll<{ id: number; name: string; semester: string; academic_year: string; starts_at: string; ends_at: string; status: string }>(
      'SELECT id, name, semester, academic_year, starts_at, ends_at, status FROM periods ORDER BY starts_at DESC',
    );
    const departments = scopedToDean
      ? (user.department ? [user.department] : [])
      : queryAll<{ department: string }>(
        "SELECT DISTINCT department FROM teachers WHERE department <> '' UNION SELECT DISTINCT department FROM subjects WHERE department <> '' ORDER BY department",
      ).map((item) => item.department);
    response.json({ teachers, subjects, assignments, periods, departments });
  });

  app.get('/api/my-submissions', requireRoles('client'), (_request, response) => {
    const user = response.locals.user as AuthUser;
    response.json(queryAll<{ teacher: string; subject: string; period: string; created_at: string }>(
      `SELECT DISTINCT teacher_name AS teacher, subject_name AS subject, period_name AS period, created_at
       FROM submission_guards WHERE student_hash = ? ORDER BY created_at DESC`,
      [hashDuplicateKey(String(user.id))],
    ));
  });

  app.post('/api/responses', requireRoles('client'), (request, response) => {
    const user = response.locals.user as AuthUser;
    const teacherName = typeof request.body?.teacher === 'string' ? request.body.teacher.trim() : '';
    const subjectName = typeof request.body?.subject === 'string' ? request.body.subject.trim() : '';
    const periodId = Number(request.body?.periodId);
    const ratings = request.body?.ratings;
    const comment = typeof request.body?.comment === 'string' ? request.body.comment.trim().slice(0, 2000) : '';

    if (!teacherName || !subjectName || !Number.isInteger(periodId) || !ratings || typeof ratings !== 'object' || Array.isArray(ratings)) {
      response.status(400).json({ error: 'Choose a teacher, subject, evaluation period, and complete all evaluation questions.' });
      return;
    }
    const questionIds = Array.from({ length: 29 }, (_item, index) => String(index + 1));
    const hasAllQuestions = questionIds.every((questionId) => Object.prototype.hasOwnProperty.call(ratings, questionId));
    if (!hasAllQuestions) {
      response.status(400).json({ error: 'Please complete all evaluation questions.' });
      return;
    }
    const invalidAnswer = questionIds.find((questionId) => {
      const value = ratings[questionId];
      if (questionId === '29') return value !== 'yes' && value !== 'no';
      const numericValue = Number(value);
      return !Number.isInteger(numericValue) || numericValue < 1 || numericValue > 5;
    });
    if (invalidAnswer) {
      response.status(400).json({ error: `Question ${invalidAnswer} is missing a valid rating.` });
      return;
    }

    const period = queryOne<{ id: number; name: string; status: string; starts_at: string; ends_at: string }>(
      'SELECT id, name, status, starts_at, ends_at FROM periods WHERE id = ?',
      [periodId],
    );
    if (!period || period.status !== 'open' || Date.parse(period.starts_at) > Date.now() || Date.parse(period.ends_at) < Date.now()) {
      response.status(409).json({ error: 'This evaluation period is not currently open.' });
      return;
    }
    const assignment = queryOne<{ teacher_id: number; teacher: string; subject_id: number; subject: string; department: string }>(
      `SELECT teachers.id AS teacher_id, teachers.name AS teacher, subjects.id AS subject_id,
       subjects.name AS subject, CASE WHEN teachers.department = '' THEN subjects.department ELSE teachers.department END AS department
       FROM assignments JOIN teachers ON teachers.id = assignments.teacher_id
       JOIN subjects ON subjects.id = assignments.subject_id
       WHERE teachers.name = ? AND subjects.name = ?`,
      [teacherName, subjectName],
    );
    if (!assignment) {
      response.status(400).json({ error: 'That teacher and subject are not in the active evaluation catalog.' });
      return;
    }

    const studentHash = hashDuplicateKey(String(user.id));
    const createdAt = new Date().toISOString();
    database.run('BEGIN');
    try {
      execute(
        'INSERT INTO submission_guards(student_hash, teacher_name, subject_name, period_name, created_at) VALUES (?, ?, ?, ?, ?)',
        [studentHash, assignment.teacher, assignment.subject, period.name, createdAt],
      );
      execute(
        'INSERT INTO responses(teacher_id, teacher_name, subject_id, subject_name, department, period_id, period_name, ratings, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [assignment.teacher_id, assignment.teacher, assignment.subject_id, assignment.subject, assignment.department, period.id, period.name, JSON.stringify(ratings), comment, createdAt],
      );
      database.run('COMMIT');
    } catch (error) {
      database.run('ROLLBACK');
      if (error instanceof Error && error.message.toLowerCase().includes('unique constraint failed')) {
        response.status(409).json({ error: 'You have already evaluated this teacher and subject for this period.' });
        return;
      }
      throw error;
    }
    persistDatabase();
    response.status(201).json({ status: 'submitted', created_at: createdAt });
  });

  app.get('/api/reports/filters', requireRoles('server', 'dean'), (_request, response) => {
    const user = response.locals.user as AuthUser;
    if (user.role === 'dean' && !user.department) {
      response.json({ teacher: [], subject: [], department: [], period: [], semester: [], academicYear: [] });
      return;
    }
    const where = user.role === 'dean' ? 'WHERE department = ?' : '';
    const values: SqlValue[] = user.role === 'dean' ? [user.department] : [];
    const filters = {
      teacher: queryAll<{ value: string }>(`SELECT DISTINCT teacher_name AS value FROM responses ${where} ORDER BY value`, values).map((row) => row.value),
      subject: queryAll<{ value: string }>(`SELECT DISTINCT subject_name AS value FROM responses ${where} ORDER BY value`, values).map((row) => row.value),
      department: queryAll<{ value: string }>(`SELECT DISTINCT department AS value FROM responses ${where ? `${where} AND department <> ''` : "WHERE department <> ''"} ORDER BY value`, values).map((row) => row.value),
      period: queryAll<{ value: string }>(`SELECT DISTINCT period_name AS value FROM responses ${where} ORDER BY value`, values).map((row) => row.value),
      semester: queryAll<{ value: string }>(
        `SELECT DISTINCT periods.semester AS value FROM responses JOIN periods ON periods.id = responses.period_id ${where} ${where ? 'AND' : 'WHERE'} periods.semester <> '' ORDER BY value`,
        values,
      ).map((row) => row.value),
      academicYear: queryAll<{ value: string }>(
        `SELECT DISTINCT periods.academic_year AS value FROM responses JOIN periods ON periods.id = responses.period_id ${where} ${where ? 'AND' : 'WHERE'} periods.academic_year <> '' ORDER BY value`,
        values,
      ).map((row) => row.value),
    };
    response.json(filters);
  });

  app.get('/api/reports', requireRoles('server', 'dean'), (request, response) => {
    const user = response.locals.user as AuthUser;
    const filters = {
      teacher: typeof request.query.teacher === 'string' ? request.query.teacher : undefined,
      department: user.role === 'dean' ? user.department || '\u0000' : typeof request.query.department === 'string' ? request.query.department : undefined,
      subject: typeof request.query.subject === 'string' ? request.query.subject : undefined,
      period: typeof request.query.period === 'string' ? request.query.period : undefined,
      semester: typeof request.query.semester === 'string' ? request.query.semester : undefined,
      academicYear: typeof request.query.academicYear === 'string' ? request.query.academicYear : undefined,
    };
    response.json(groupResponses(filters));
  });

  app.post('/api/reports/submit', requireRoles('server', 'dean'), (_request, response) => {
    const user = response.locals.user as AuthUser;
    response.json({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      reports: groupResponses({ department: user.role === 'dean' ? user.department || '\u0000' : undefined }),
      submitted_by: publicUser(user).displayName,
    });
  });

  app.get('/api/settings/criteria', requireRoles(...roles), (_request, response) => {
    const setting = queryOne<{ value: string }>("SELECT value FROM settings WHERE key = 'evaluation_criteria'");
    response.json({ criteria: setting ? JSON.parse(setting.value) as EvaluationCriterion[] : DEFAULT_CRITERIA });
  });

  app.put('/api/admin/settings/criteria', requireRoles('server'), (request, response) => {
    const criteria = request.body?.criteria as unknown;
    if (!Array.isArray(criteria) || criteria.length < 1 || criteria.length > 20) {
      response.status(400).json({ error: 'Provide 1 to 20 evaluation criteria.' });
      return;
    }
    const parsedCriteria: EvaluationCriterion[] = [];
    const usedQuestions = new Set<number>();
    for (const item of criteria) {
      if (!item || typeof item.name !== 'string' || item.name.trim().length < 2 || item.name.trim().length > 80 || !Array.isArray(item.questionIds) || item.questionIds.length === 0) {
        response.status(400).json({ error: 'Each criterion needs a name and at least one question number.' });
        return;
      }
      const ids = item.questionIds as unknown[];
      if (ids.some((id) => !Number.isInteger(id) || Number(id) < 1 || Number(id) > 29 || usedQuestions.has(Number(id)))) {
        response.status(400).json({ error: 'Each existing question number from 1 to 29 must appear once only. Question text cannot be changed.' });
        return;
      }
      ids.forEach((id) => usedQuestions.add(Number(id)));
      parsedCriteria.push({ name: item.name.trim(), questionIds: ids.map(Number) });
    }
    if (usedQuestions.size !== 29) {
      response.status(400).json({ error: 'Criteria must cover all 29 existing questions exactly once.' });
      return;
    }
    execute(
      "INSERT INTO settings(key, value) VALUES ('evaluation_criteria', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [JSON.stringify(parsedCriteria)],
    );
    persistDatabase();
    response.json({ status: 'updated', criteria: parsedCriteria });
  });

  app.get('/api/admin/users', requireRoles('server'), (_request, response) => {
    response.json(queryAll<Omit<AuthUser, 'id'> & { id: number; active: number; created_at: string }>(
      "SELECT id, username, role, display_name, department, active, created_at FROM users WHERE role IN ('server', 'client', 'dean') ORDER BY role, display_name",
    ));
  });

  app.post('/api/admin/users', requireRoles('server'), asyncHandler(async (request, response) => {
    const { username, password, role, displayName, department = '' } = request.body ?? {};
    if (!validateUsername(username) || !validatePassword(password) || !roles.includes(role) || typeof displayName !== 'string' || displayName.trim().length < 2 || displayName.trim().length > 120 || typeof department !== 'string' || (department !== '' && !departmentSet.has(department)) || (role === 'dean' && !department)) {
      response.status(400).json({ error: 'Provide a valid username, password (at least 12 characters), role, display name, and department.' });
      return;
    }
    const { hash, salt } = await createPasswordHash(password);
    try {
      execute(
        'INSERT INTO users(username, password_hash, password_salt, role, display_name, department, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [username, hash, salt, role, displayName.trim(), department.trim(), new Date().toISOString()],
      );
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('unique constraint failed')) {
        response.status(409).json({ error: 'That username is already in use.' });
        return;
      }
      throw error;
    }
    persistDatabase();
    response.status(201).json({ status: 'created' });
  }));

  app.patch('/api/admin/users/:id', requireRoles('server'), (request, response) => {
    const userId = Number(request.params.id);
    const active = request.body?.active;
    if (!Number.isInteger(userId) || typeof active !== 'boolean') {
      response.status(400).json({ error: 'Provide a valid account ID and active status.' });
      return;
    }
    if (userId === (response.locals.user as AuthUser).id && !active) {
      response.status(400).json({ error: 'You cannot disable your own account.' });
      return;
    }
    const result = queryOne<{ id: number }>('SELECT id FROM users WHERE id = ?', [userId]);
    if (!result) {
      response.status(404).json({ error: 'Account not found.' });
      return;
    }
    execute('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, userId]);
    if (!active) execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
    persistDatabase();
    response.json({ status: 'updated' });
  });

  app.post('/api/admin/periods', requireRoles('server'), (request, response) => {
    const { name, semester = '', academicYear = '', startsAt, endsAt } = request.body ?? {};
    const startTime = typeof startsAt === 'string' ? Date.parse(startsAt) : NaN;
    const endTime = typeof endsAt === 'string' ? Date.parse(endsAt) : NaN;
    if (typeof name !== 'string' || name.trim().length < 3 || name.trim().length > 120 || !semesters.includes(semester) || typeof academicYear !== 'string' || !Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
      response.status(400).json({ error: 'Provide a period name, semester, academic year, and a valid start/end date range.' });
      return;
    }
    try {
      execute(
        "INSERT INTO periods(name, semester, academic_year, starts_at, ends_at, status) VALUES (?, ?, ?, ?, ?, 'closed')",
        [name.trim(), semester.trim(), academicYear.trim(), new Date(startTime).toISOString(), new Date(endTime).toISOString()],
      );
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('unique constraint failed')) {
        response.status(409).json({ error: 'An evaluation period with that name already exists.' });
        return;
      }
      throw error;
    }
    persistDatabase();
    response.status(201).json({ status: 'created' });
  });

  app.patch('/api/admin/periods/:id', requireRoles('server'), (request, response) => {
    const periodId = Number(request.params.id);
    const status = request.body?.status;
    if (!Number.isInteger(periodId) || !['open', 'closed'].includes(status)) {
      response.status(400).json({ error: 'Provide a valid period ID and open/closed status.' });
      return;
    }
    const exists = queryOne<{ id: number }>('SELECT id FROM periods WHERE id = ?', [periodId]);
    if (!exists) {
      response.status(404).json({ error: 'Evaluation period not found.' });
      return;
    }
    database.run('BEGIN');
    if (status === 'open') execute("UPDATE periods SET status = 'closed' WHERE status = 'open'");
    execute('UPDATE periods SET status = ? WHERE id = ?', [status, periodId]);
    database.run('COMMIT');
    persistDatabase();
    response.json({ status: 'updated' });
  });

  app.post('/api/admin/subjects', requireRoles('server'), (request, response) => {
    const { name, department = '', teacher } = request.body ?? {};
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 160 || typeof department !== 'string' || (department !== '' && !departmentSet.has(department)) || typeof teacher !== 'string' || !teacher.trim()) {
      response.status(400).json({ error: 'Provide a valid subject name, department, and assigned teacher.' });
      return;
    }
    const teacherRecord = queryOne<{ id: number; name: string }>('SELECT id, name FROM teachers WHERE name = ?', [teacher.trim()]);
    if (!teacherRecord) {
      response.status(400).json({ error: 'Choose an existing teacher account from the catalog.' });
      return;
    }
    const subject = findOrCreateSubject(name.trim(), department.trim());
    execute(
      'INSERT OR IGNORE INTO assignments(teacher_id, subject_id, semester, academic_year) VALUES (?, ?, ?, ?)',
      [teacherRecord.id, subject.id, '', ''],
    );
    persistDatabase();
    response.status(201).json({ status: 'created' });
  });

  app.use('/api', (_request, response) => response.status(404).json({ error: 'API endpoint not found.' }));
  app.use((error: unknown, _request: Request, response: Response, _next: express.NextFunction) => {
    console.error('API request failed:', error);
    if (response.headersSent) return;
    response.status(500).json({ error: 'The request could not be completed. Please try again or contact the system administrator.' });
  });

  app.listen(port, () => console.log(`Evaluation API running on http://localhost:${port}`));
}

startServer().catch((error: unknown) => {
  console.error('Unable to initialize evaluation database:', error);
  process.exitCode = 1;
});
