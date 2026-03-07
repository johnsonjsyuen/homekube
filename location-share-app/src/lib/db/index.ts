import { migrations } from './migrations';

export interface QueryResult {
  rowsAffected: number;
  lastInsertId: number;
}

export interface Database {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  execute(query: string, bindValues?: unknown[]): Promise<QueryResult>;
  close(): Promise<void>;
}

let dbInstance: Database | null = null;

async function runMigrations(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = await db.select<{ version: number }[]>('SELECT version FROM _migrations');
  const appliedVersions = new Set(applied.map((r) => r.version));

  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      // Execute each statement separately (SQLite doesn't support multi-statement exec in all drivers)
      const statements = migration.sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        await db.execute(stmt);
      }

      await db.execute('INSERT INTO _migrations (version) VALUES ($1)', [migration.version]);
      console.log(`[DB] Applied migration v${migration.version}`);
    }
  }
}

async function loadTauriDatabase(): Promise<Database> {
  const { default: TauriDatabase } = await import('@tauri-apps/plugin-sql');
  const tauriDb = await TauriDatabase.load('sqlite:location-share.db');
  return {
    select: <T>(query: string, bindValues?: unknown[]) =>
      tauriDb.select<T>(query, bindValues),
    execute: async (query: string, bindValues?: unknown[]) => {
      const result = await tauriDb.execute(query, bindValues);
      return { rowsAffected: result.rowsAffected, lastInsertId: result.lastInsertId ?? 0 };
    },
    close: async () => { await tauriDb.close(); },
  };
}

// In-memory fallback for browser dev (no Tauri runtime)
function createInMemoryDatabase(): Database {
  let autoIncrement = 0;
  console.log('[DB] Using in-memory fallback (no Tauri runtime)');

  return {
    select: async <T>(_query: string, _bindValues?: unknown[]) => {
      return [] as unknown as T;
    },
    execute: async (_query: string, _bindValues?: unknown[]) => {
      return { rowsAffected: 0, lastInsertId: ++autoIncrement };
    },
    close: async () => {},
  };
}

export async function initDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;

  try {
    dbInstance = await loadTauriDatabase();
  } catch {
    console.warn('[DB] Tauri SQL plugin not available, using in-memory fallback');
    dbInstance = createInMemoryDatabase();
  }

  await runMigrations(dbInstance);
  return dbInstance;
}

export function getDatabase(): Database | null {
  return dbInstance;
}
