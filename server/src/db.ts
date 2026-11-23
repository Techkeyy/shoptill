import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

export function openDb(path: string): DB {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS shops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_chat INTEGER NOT NULL,
      name TEXT,
      address TEXT,
      stage TEXT NOT NULL DEFAULT 'name',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      code TEXT,
      shop_id INTEGER,
      last_poll INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      secret_hash TEXT,
      code_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      shop_id INTEGER NOT NULL,
      amount_raw TEXT NOT NULL,
      asset TEXT NOT NULL,
      decimals INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      voided_at INTEGER,
      state TEXT NOT NULL DEFAULT 'WAITING',
      paid_raw TEXT NOT NULL DEFAULT '0',
      extra_raw TEXT NOT NULL DEFAULT '0',
      missing_raw TEXT NOT NULL DEFAULT '0',
      from_addr TEXT,
      paid_tx TEXT,
      paid_ref TEXT,
      paid_at INTEGER,
      notified_state TEXT,
      receipt_sent INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS sales_shop ON sales(shop_id, created_at);
    CREATE TABLE IF NOT EXISTS sale_events (
      sale_id TEXT NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS refs (
      ref TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      chat_id INTEGER,
      message_id INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      tx_hash TEXT PRIMARY KEY,
      shop_id INTEGER NOT NULL,
      sale_id TEXT,
      ref TEXT,
      payload TEXT NOT NULL,
      seen_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS payments_shop ON payments(shop_id, sale_id);
  `);
  // migrate databases created before device secrets / code expiry existed
  const cols = (db.prepare('PRAGMA table_info(devices)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('secret_hash')) db.exec('ALTER TABLE devices ADD COLUMN secret_hash TEXT');
  if (!cols.includes('code_at')) db.exec('ALTER TABLE devices ADD COLUMN code_at INTEGER');
  const sCols = (db.prepare('PRAGMA table_info(sales)').all() as { name: string }[]).map((c) => c.name);
  // per-sale timings: wall-clock ms when a matching payment was first seen / when PAID was detected, chain utime of that payment
  for (const c of ['first_seen_at', 'paid_detected_at', 'pay_utime']) {
    if (!sCols.includes(c)) db.exec(`ALTER TABLE sales ADD COLUMN ${c} INTEGER`);
  }
  return db;
}

export const one = <T = any>(db: DB, sql: string, ...p: any[]): T | undefined =>
  db.prepare(sql).get(...p) as T | undefined;
export const all = <T = any>(db: DB, sql: string, ...p: any[]): T[] =>
  db.prepare(sql).all(...p) as T[];
export const run = (db: DB, sql: string, ...p: any[]) => db.prepare(sql).run(...p);
