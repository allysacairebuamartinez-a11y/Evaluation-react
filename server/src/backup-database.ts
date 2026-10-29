import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databaseFile = resolve(process.env.OLPCSMI_DATABASE_FILE ?? resolve(serverRoot, 'data', 'olpcsmi.sqlite'));
const backupDirectory = resolve(dirname(databaseFile), 'backups');

function backupDatabase() {
  if (!existsSync(databaseFile)) {
    throw new Error(`Database not found at ${databaseFile}. Start the server once before creating a backup.`);
  }

  mkdirSync(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = resolve(backupDirectory, `olpcsmi-${timestamp}.sqlite`);
  copyFileSync(databaseFile, backupFile);

  const sourceSize = statSync(databaseFile).size;
  const backupSize = statSync(backupFile).size;
  if (sourceSize === 0 || backupSize !== sourceSize) {
    throw new Error(`Database backup verification failed: ${backupFile}`);
  }

  console.log(`Database backup created and verified: ${backupFile}`);
}

try {
  backupDatabase();
} catch (error) {
  console.error('Unable to create database backup:', error);
  process.exitCode = 1;
}
