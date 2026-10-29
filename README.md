# OLPC-SMI Evaluation System

Full-stack teacher evaluation system built with React/Vite, an Express/TypeScript API, and a local SQLite database powered by `sql.js`. The database is stored at `server/data/olpcsmi.sqlite` by default and does not require native database build tooling.

## Requirements

- Node.js 20+
- npm 10+

## Local development

From the project root:

```bash
npm install
npm install --prefix server
npm install --prefix client
npm run dev
```

The frontend runs at `http://localhost:5173` and the API at `http://localhost:4000`.

Only local development supports temporary demo logins: `demo-admin`, `demo-student`, and `demo-dean`, with any password. These sessions are kept in memory and cannot be used by the production server.

## Roles and access

- **Admin** manages accounts, evaluation periods, teacher/subject assignments, and evaluation criteria, and can review reports.
- **Dean** can review anonymous reports for the Dean account's assigned department. Dean accounts must have a department assigned.
- **Student** can submit one evaluation for each teacher, subject, and open evaluation period. The server also rejects duplicate submissions.

The API enforces these permissions; hiding management pages in the UI is not the only access control.

## Prepare real accounts for production

1. Start the server once in development to create or migrate the database, then stop it.
2. From the project root, run `npm run reset:accounts --prefix server`. Enter a unique username for Admin, Student, and Dean; choose the Dean's department; then set and confirm each password. Password input is hidden.
3. Start production with `npm run build` followed by `npm start --prefix server`.

Production startup requires at least one active, non-demo account for each role and a department for the Dean. It fails with an actionable message if setup is incomplete. The production command explicitly sets production mode, so it never enables the local demo login bypass. Do not use `npm run dev` for production.

The optional `OLPCSMI_DATABASE_FILE` environment variable can point the server, account setup utility, or backup utility to a different SQLite file. Use the same value consistently for all three.

## Database backups

Create a timestamped, size-verified backup with:

```bash
npm run backup --prefix server
```

Backups are saved under `server/data/backups` (or beside the database file specified by `OLPCSMI_DATABASE_FILE`). Schedule this command daily in Windows Task Scheduler: use `npm.cmd` as the program, `run backup --prefix server` as the arguments, and the project root as **Start in**. Keep periodic copies on a separate drive or protected storage; a backup on the same disk does not protect against disk failure.

Before opening an evaluation period to students, verify that a recent backup exists and that it is stored separately.

## Student-flow verification

Before an actual evaluation, use a local test database and a demo Student account to verify:

1. An open evaluation period is selectable.
2. The assigned teacher and subject can be selected.
3. All 29 questions are required and a complete evaluation is accepted.
4. Repeating the same teacher, subject, and period is rejected as a duplicate.
5. The new response appears only as an anonymous aggregate in the appropriate Dean/Admin report.

Do not use real student information for test submissions. The server enforces both the open-period requirement and duplicate-submission rule.

## Build

```bash
npm run build
```
