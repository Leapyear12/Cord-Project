// One-off move of data/cord.db (SQLite) into the PostgreSQL database set by DATABASE_URL.
// Usage: node scripts/import-sqlite.mjs [path-to-cord.db] [--force]
// Without --force the script refuses to run if the target already has users.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool, initDb, closeDb } from '../src/server/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlitePath = process.argv[2] && !process.argv[2].startsWith('--')
  ? path.resolve(process.argv[2])
  : path.join(here, '..', '..', 'data', 'cord.db');
const force = process.argv.includes('--force');

if (!existsSync(sqlitePath)) {
  console.error(`SQLite file not found: ${sqlitePath}`);
  process.exit(1);
}

const TABLES = [
  'users', 'sessions', 'servers', 'server_members', 'channels', 'messages',
  'attachments', 'docs', 'merge_requests', 'merge_voters', 'merge_votes',
];

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const present = new Set(
  sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
);

const readTable = (table) => {
  if (!present.has(table)) return [];
  return sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
};

const columnsOf = (table) => new Set(
  sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name),
);

await initDb();
const client = await pool.connect();

try {
  const { rows } = await client.query('SELECT EXISTS (SELECT 1 FROM users) AS has_users');
  if (rows[0].has_users && !force) {
    console.error('Target database already has users. Re-run with --force to replace it.');
    process.exitCode = 1;
  } else {
    await client.query('BEGIN');
    await client.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);

    for (const table of TABLES) {
      const rowsIn = readTable(table);
      if (!rowsIn.length) continue;
      const cols = columnsOf(table);
      const names = [...cols];
      const colsSql = names.map((c) => `"${c}"`).join(', ');
      const placeholders = names.map((_, i) => `$${i + 1}`).join(', ');
      for (const row of rowsIn) {
        await client.query(
          `INSERT INTO ${table} (${colsSql}) VALUES (${placeholders})`,
          names.map((c) => row[c] ?? null),
        );
      }
      if (cols.has('id')) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1),
                         MAX(id) IS NOT NULL) FROM ${table}`,
        );
      }
      console.log(`${table}: ${rowsIn.length} rows`);
    }

    await client.query('COMMIT');
    console.log('Import complete.');
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Import failed:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  sqlite.close();
  await closeDb();
}
