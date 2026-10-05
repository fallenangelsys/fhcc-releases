// SQLite-Adapter.
//
// Das Backend nutzt bisher better-sqlite3, ein natives C++-Addon. Auf Android
// gibt es dafuer keine fertigen Binaries, deshalb scheitert der App-Start dort
// grundsaetzlich - unabhaengig davon, wie gut das Geraet ist.
//
// Node 22+ bringt `node:sqlite` mit, also dieselbe SQLite-Bibliothek, aber ohne
// Kompilierschritt. Zwei gebrauchte Methoden fehlen dort: `pragma()` und
// `transaction()`. Dieser Adapter ergaenzt sie, damit der restliche Code
// unveraendert bleibt und auf beiden Plattformen identisch laeuft.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const nodeSqlite = (() => {
  try {
    return require('node:sqlite');
  } catch {
    return null;
  }
})();

const loadBetterSqlite = () => {
  const Database = require('better-sqlite3');
  return { Database, flavour: 'better-sqlite3' };
};

const loadNodeSqlite = () => {
  if (!nodeSqlite) {
    throw new Error(
      'Kein SQLite verfuegbar: Weder better-sqlite3 noch node:sqlite konnten geladen werden. '
      + 'Unter Android wird Node 22 oder neuer benoetigt.'
    );
  }
  return { Database: nodeSqlite.DatabaseSync, flavour: 'node:sqlite' };
};

// node:sqlite kennt kein pragma(). Die Werte kommen dort als Zeilen zurueck.
// better-sqlite3 liefert bei { simple: true } dagegen einen einzelnen Skalar -
// genau dieses Verhalten muss nachgebildet werden, sonst brechen Aufrufer wie
// database.pragma('page_count', { simple: true }).
const decorateNodeSqlite = (database) => {
  if (typeof database.pragma === 'function') return database;

  database.pragma = (statement, options = {}) => {
    const text = String(statement || '').trim();
    if (!text) return options?.simple ? 0 : [];

    // Zuweisende Pragmas ('journal_mode = WAL') geben bei better-sqlite3 nichts
    // zurueck; prepare() wuerde daran ebenfalls scheitern.
    const rows = text.includes('=') ? [] : database.prepare(`PRAGMA ${text}`).all();

    if (options?.simple) {
      const values = Object.values(rows[0] || {});
      return values.length ? values[0] : 0;
    }

    return rows;
  };

  // Verschachtelte Transaktionen als Savepoints: SQLite kennt keine echten
  // verschachtelten BEGIN-Blocks, ein SAVEPOINT erfuellt aber denselben Zweck.
  let depth = 0;

  database.transaction = (fn) => {
    if (typeof fn !== 'function') return () => {
      throw new TypeError('transaction() erwartet eine Funktion.');
    };

    return (...args) => {
      const nested = depth > 0;
      const name = `fh_sp_${depth}`;
      database.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN');
      depth += 1;
      try {
        const result = fn(...args);
        database.exec(nested ? `RELEASE ${name}` : 'COMMIT');
        return result;
      } catch (error) {
        try {
          database.exec(nested ? `ROLLBACK TO ${name}` : 'ROLLBACK');
          if (nested) database.exec(`RELEASE ${name}`);
        } catch {
          /* Rollback-Fehler nicht ueber den urspruenglichen Fehler legen. */
        }
        throw error;
      } finally {
        depth -= 1;
      }
    };
  };

  return database;
};

const decorate = (database, flavour) => (
  flavour === 'node:sqlite' ? decorateNodeSqlite(database) : database
);

// Ohne Argument wie bisher: bevorzugt better-sqlite3, weil es auf dem Desktop
// bereits bewährt ist. Mit 'node' wird die eingebaute Bibliothek erzwungen.
export const createSqliteDatabase = (filename, options = {}) => {
  const requested = String(options.flavour || process.env.FH_SQLITE_FLAVOUR || 'auto').trim().toLowerCase();

  if (requested === 'node' || requested === 'node:sqlite') {
    const { Database, flavour } = loadNodeSqlite();
    return decorate(new Database(filename), flavour);
  }

  try {
    const { Database, flavour } = loadBetterSqlite();
    return decorate(new Database(filename, options), flavour);
  } catch (error) {
    // Auf Android schlaegt better-sqlite3 immer fehl. Dann auf node:sqlite
    // zurueckfallen, statt den Start abzubrechen.
    const { Database, flavour } = loadNodeSqlite();
    console.warn('[sqlite] better-sqlite3 nicht verfuegbar, weiche auf node:sqlite aus:', error?.message || error);
    return decorate(new Database(filename), flavour);
  }
};

export const sqliteFlavour = () => (
  nodeSqlite && !(() => {
    try {
      require('better-sqlite3');
      return true;
    } catch {
      return false;
    }
  })() ? 'node:sqlite' : 'better-sqlite3'
);
