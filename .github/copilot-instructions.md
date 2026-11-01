# Project Instructions

- Use JavaScript (`.js` / `.jsx`) for the React frontend in `client/src`.
- Keep the API in PHP under `server/api`; use PDO and MySQL for persistence.
- Apache and MySQL are provided locally by XAMPP. Node.js is used only for the Vite frontend.
- Do not add TypeScript, SQLite, or Express.js runtime requirements.
- Preserve the original OLPC-SMI login page, warm yellow accent, charcoal navigation, compact tables, and responsive layout.
- Keep the three supported roles and their permissions: Admin manages the system, Dean views and prints department reports, and Student submits one evaluation per assigned teacher per evaluation period.
- Run `npm run build --prefix server` and `npm run build --prefix client` after code changes. PHP must be available on `PATH`.
