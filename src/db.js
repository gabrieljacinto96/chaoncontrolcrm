const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'sistema.db');
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

async function ensureColumn(tableName, columnName, columnDefinition) {
  const columns = await all(`PRAGMA table_info(${tableName})`);
  const hasColumn = columns.some((column) => column.name === columnName);

  if (!hasColumn) {
    await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

async function initializeDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT,
      role TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_seller INTEGER NOT NULL DEFAULT 0,
      is_buyer INTEGER NOT NULL DEFAULT 0,
      commercial_name TEXT,
      phone TEXT,
      address TEXT,
      property TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS client_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      client_uuid TEXT,
      channel TEXT,
      summary TEXT NOT NULL,
      next_step TEXT,
      contact_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS commercial_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commercial_user_id INTEGER NOT NULL UNIQUE,
      weekly_goal INTEGER NOT NULL DEFAULT 0,
      monthly_goal INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (commercial_user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS client_followup_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      outcome_type TEXT NOT NULL,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      upstream_url TEXT NOT NULL UNIQUE,
      last_success_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Keep compatibility with existing databases by adding new real-estate fields when missing.
  await ensureColumn('clients', 'is_seller', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('clients', 'is_buyer', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('clients', 'commercial_name', 'TEXT');
  await ensureColumn('clients', 'commercial_user_id', 'INTEGER');
  await ensureColumn('clients', 'address', 'TEXT');
  await ensureColumn('clients', 'property', 'TEXT');
  await ensureColumn('clients', 'uuid', 'TEXT');
  await ensureColumn('clients', 'updated_at', 'TEXT');
  await ensureColumn('clients', 'deleted_at', 'TEXT');
  await ensureColumn('client_contacts', 'uuid', 'TEXT');
  await ensureColumn('client_contacts', 'client_uuid', 'TEXT');
  await ensureColumn('client_contacts', 'updated_at', 'TEXT');
  await ensureColumn('client_contacts', 'deleted_at', 'TEXT');
  await ensureColumn('users', 'full_name', 'TEXT');

  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_uuid ON clients(uuid)');
  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_client_contacts_uuid ON client_contacts(uuid)');
  await run('CREATE INDEX IF NOT EXISTS idx_clients_updated_at ON clients(updated_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_client_contacts_updated_at ON client_contacts(updated_at)');

  const clientsWithoutUuid = await all('SELECT id FROM clients WHERE uuid IS NULL OR trim(uuid) = ""');
  for (const client of clientsWithoutUuid) {
    await run('UPDATE clients SET uuid = ? WHERE id = ?', [crypto.randomUUID(), client.id]);
  }

  await run('UPDATE clients SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)');

  const contactsWithoutUuid = await all('SELECT id FROM client_contacts WHERE uuid IS NULL OR trim(uuid) = ""');
  for (const contact of contactsWithoutUuid) {
    await run('UPDATE client_contacts SET uuid = ? WHERE id = ?', [crypto.randomUUID(), contact.id]);
  }

  await run(
    `UPDATE client_contacts
     SET client_uuid = (
       SELECT c.uuid
       FROM clients c
       WHERE c.id = client_contacts.client_id
       LIMIT 1
     )
     WHERE client_uuid IS NULL OR trim(client_uuid) = ''`
  );

  await run('UPDATE client_contacts SET updated_at = COALESCE(updated_at, contact_date, created_at, CURRENT_TIMESTAMP)');

  await run(
    `UPDATE clients
     SET commercial_user_id = (
       SELECT u.id
       FROM users u
       WHERE u.role = 'commercial'
         AND (
           lower(u.username) = lower(COALESCE(clients.commercial_name, ''))
           OR lower(COALESCE(u.full_name, '')) = lower(COALESCE(clients.commercial_name, ''))
         )
       LIMIT 1
     )
     WHERE commercial_user_id IS NULL
       AND COALESCE(trim(commercial_name), '') <> ''`
  );

  const admin = await get('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!admin) {
    await run(
      'INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
      ['admin', 'admin123', 'Administrador', 'admin']
    );
  }
}

module.exports = {
  db,
  run,
  get,
  all,
  initializeDb,
};
