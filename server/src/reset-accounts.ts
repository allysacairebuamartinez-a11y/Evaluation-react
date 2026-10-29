import initSqlJs, { type Database } from 'sql.js';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databaseFile = resolve(process.env.OLPCSMI_DATABASE_FILE ?? resolve(serverRoot, 'data', 'olpcsmi.sqlite'));
const require = createRequire(import.meta.url);
const wasmFile = require.resolve('sql.js/dist/sql-wasm.wasm');
const scrypt = promisify(scryptCallback);
const passwordPattern = /^.{12,256}$/s;
const usernamePattern = /^[a-zA-Z0-9._-]{3,64}$/;
const departments = [
  'College of Accountancy',
  'College of Business Administration',
  'College of Criminology',
  'College of Hospitality Management',
  'College of Information Technology',
  'College of Teacher Education',
] as const;
const roles = [
  { role: 'server', label: 'Admin', defaultUsername: 'admin', defaultName: 'System Administrator' },
  { role: 'client', label: 'Student', defaultUsername: 'student', defaultName: 'Student Account' },
  { role: 'dean', label: 'Dean', defaultUsername: 'dean', defaultName: 'Dean Account' },
] as const;

type RoleSetup = typeof roles[number] & { id?: number; username: string; displayName: string; department: string };

function queryAll<T extends Record<string, unknown>>(database: Database, sql: string): T[] {
  const statement = database.prepare(sql);
  try {
    const rows: T[] = [];
    while (statement.step()) rows.push(statement.getAsObject() as T);
    return rows;
  } finally {
    statement.free();
  }
}

function readHiddenPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.reject(new Error('Run this command in an interactive terminal so passwords can be entered securely.'));
  }

  return new Promise((resolvePassword, reject) => {
    let password = '';
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const finish = (error?: Error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolvePassword(password);
    };

    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          finish(new Error('Password setup cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          password = Array.from(password).slice(0, -1).join('');
          continue;
        }
        if (character >= ' ' && character !== '\u007f') password += character;
      }
    };

    process.stdin.on('data', onData);
  });
}

async function confirmedPassword(label: string) {
  const password = await readHiddenPassword(`${label} new password (12-256 characters; input hidden): `);
  if (!passwordPattern.test(password)) throw new Error(`${label} password must be between 12 and 256 characters.`);
  const confirmation = await readHiddenPassword(`Confirm ${label} password: `);
  if (password !== confirmation) throw new Error(`${label} password confirmation did not match.`);

  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64) as Buffer;
  return { hash: hash.toString('hex'), salt: salt.toString('hex') };
}

async function main() {
  if (!existsSync(databaseFile)) {
    throw new Error(`Database not found at ${databaseFile}. Start the server once before running account setup.`);
  }

  const SQL = await initSqlJs({ locateFile: () => wasmFile });
  const database = new SQL.Database(readFileSync(databaseFile));
  try {
    const existingAccounts = queryAll<{ id: number; username: string; role: string; display_name: string; department: string }>(
      database,
      "SELECT id, username, role, display_name, department FROM users WHERE role IN ('server', 'client', 'dean') ORDER BY id",
    );

    const readline = createInterface({ input: process.stdin, output: process.stdout });
    const setups: RoleSetup[] = [];
    try {
      for (const roleSetup of roles) {
        const existing = existingAccounts.find((account) => account.role === roleSetup.role);
        const defaultUsername = existing?.username ?? roleSetup.defaultUsername;
        const enteredUsername = (await readline.question(`${roleSetup.label} username [${defaultUsername}]: `)).trim();
        const username = enteredUsername || defaultUsername;
        if (!usernamePattern.test(username)) {
          throw new Error(`${roleSetup.label} username must be 3-64 characters using letters, numbers, dots, underscores, or hyphens.`);
        }
        const existingDepartment = existing?.department ?? '';
        const enteredDepartment = roleSetup.role === 'dean'
          ? (await readline.question(`Dean department [${existingDepartment || 'required'}]: `)).trim()
          : '';
        const department = enteredDepartment || existingDepartment;
        if (roleSetup.role === 'dean' && !departments.includes(department as typeof departments[number])) {
          throw new Error(`Dean department must be one of: ${departments.join(', ')}.`);
        }
        setups.push({
          ...roleSetup,
          id: existing?.id,
          username,
          displayName: existing?.display_name ?? roleSetup.defaultName,
          department,
        });
      }
    } finally {
      readline.close();
    }

    if (new Set(setups.map((setup) => setup.username.toLocaleLowerCase())).size !== setups.length) {
      throw new Error('Each role must use a different username.');
    }

    const credentials: { hash: string; salt: string }[] = [];
    try {
      for (const setup of setups) credentials.push(await confirmedPassword(setup.label));

      let transactionOpen = false;
      try {
        database.run('BEGIN TRANSACTION');
        transactionOpen = true;
        for (const [index, setup] of setups.entries()) {
          const { hash, salt } = credentials[index];
          if (setup.id !== undefined) {
            database.run(
              'UPDATE users SET username = ?, password_hash = ?, password_salt = ?, role = ?, display_name = ?, department = ?, active = 1, failed_attempts = 0, locked_until = 0 WHERE id = ?',
              [setup.username, hash, salt, setup.role, setup.displayName, setup.department, setup.id],
            );
            database.run('DELETE FROM sessions WHERE user_id = ?', [setup.id]);
          } else {
            database.run(
              'INSERT INTO users(username, password_hash, password_salt, role, display_name, department, active, failed_attempts, locked_until, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0, ?)',
              [setup.username, hash, salt, setup.role, setup.displayName, setup.department, new Date().toISOString()],
            );
          }
        }
        database.run('COMMIT');
        transactionOpen = false;
        const temporaryFile = `${databaseFile}.tmp`;
        writeFileSync(temporaryFile, Buffer.from(database.export()));
        renameSync(temporaryFile, databaseFile);
      } catch (error) {
        if (transactionOpen) database.run('ROLLBACK');
        throw error;
      }

      console.log('Account setup complete. Use the usernames above and the passwords you entered. Passwords were not displayed.');
    } finally {
      credentials.forEach((credential) => {
        credential.hash = '';
        credential.salt = '';
      });
    }
  } finally {
    database.close();
  }
}

void main().catch((error: unknown) => {
  console.error('Unable to set up role accounts:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
