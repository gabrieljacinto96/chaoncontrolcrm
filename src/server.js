const path = require('path');
const crypto = require('crypto');
const os = require('os');
const express = require('express');
const cors = require('cors');
const { run, get, all, initializeDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ID = String(process.env.SYNC_NODE_ID || os.hostname() || 'node-local').trim();
const SYNC_UPSTREAM_URL = String(process.env.SYNC_UPSTREAM_URL || '').trim().replace(/\/$/, '');
const SYNC_SHARED_KEY = String(process.env.SYNC_SHARED_KEY || '').trim();

const sessions = new Map();

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

function getCommercialIdentities(user) {
  const fullName = normalizeIdentity(user && user.full_name);
  const username = normalizeIdentity(user && user.username);
  return [fullName, username].filter(Boolean);
}

function appendClientScopeFilters(req, filters, params, alias = '') {
  if (req.user && req.user.role === 'admin') {
    return;
  }

  const scopedColumn = `${alias}commercial_user_id`;
  const nameColumn = `lower(COALESCE(${alias}commercial_name, ''))`;
  const identities = getCommercialIdentities(req.user);

  if (identities.length > 0) {
    const identityPlaceholders = identities.map(() => '?').join(', ');
    filters.push(
      `(${scopedColumn} = ? OR (${scopedColumn} IS NULL AND ${nameColumn} IN (${identityPlaceholders})))`
    );
    params.push(req.user.id, ...identities);
    return;
  }

  filters.push(`${scopedColumn} = ?`);
  params.push(req.user.id);
}

async function resolveCommercialOwnerId(rawCommercialName) {
  const normalized = normalizeIdentity(rawCommercialName);
  if (!normalized) {
    return null;
  }

  const matchedUser = await get(
    `SELECT id
     FROM users
     WHERE role = 'commercial'
       AND (lower(username) = ? OR lower(COALESCE(full_name, '')) = ?)
     LIMIT 1`,
    [normalized, normalized]
  );

  return matchedUser ? matchedUser.id : null;
}

async function getScopedClient(req, id) {
  const filters = ['id = ?', 'deleted_at IS NULL'];
  const params = [id];
  appendClientScopeFilters(req, filters, params);

  return get(`SELECT * FROM clients WHERE ${filters.join(' AND ')}`, params);
}

function toTimestampValue(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isIncomingNewer(incomingUpdatedAt, localUpdatedAt) {
  return toTimestampValue(incomingUpdatedAt) >= toTimestampValue(localUpdatedAt);
}

function getSyncHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-sync-key': SYNC_SHARED_KEY,
  };
}

function assertSyncConfigured() {
  if (!SYNC_UPSTREAM_URL) {
    const error = new Error('SYNC_UPSTREAM_URL não configurado');
    error.statusCode = 400;
    throw error;
  }

  if (!SYNC_SHARED_KEY) {
    const error = new Error('SYNC_SHARED_KEY não configurado');
    error.statusCode = 500;
    throw error;
  }
}

function syncMachineAuth(req, res, next) {
  if (!SYNC_SHARED_KEY) {
    res.status(503).json({ message: 'Sincronização entre nós não está configurada neste servidor.' });
    return;
  }

  const incomingKey = String(req.headers['x-sync-key'] || '').trim();
  if (!incomingKey || incomingKey !== SYNC_SHARED_KEY) {
    res.status(401).json({ message: 'Acesso de sincronização negado.' });
    return;
  }

  next();
}

async function getSyncState(upstreamUrl) {
  return get('SELECT * FROM sync_state WHERE upstream_url = ?', [upstreamUrl]);
}

async function setSyncState(upstreamUrl, lastSuccessAt) {
  await run(
    `INSERT INTO sync_state (upstream_url, last_success_at, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(upstream_url)
     DO UPDATE SET
       last_success_at = excluded.last_success_at,
       updated_at = CURRENT_TIMESTAMP`,
    [upstreamUrl, lastSuccessAt]
  );
}

async function collectLocalChanges(since) {
  const hasSince = Boolean(String(since || '').trim());
  const clientRows = await all(
    hasSince
      ? `SELECT
          uuid,
          name,
          is_seller,
          is_buyer,
          commercial_name,
          phone,
          address,
          property,
          notes,
          created_at,
          updated_at,
          deleted_at
         FROM clients
         WHERE datetime(updated_at) > datetime(?)`
      : `SELECT
          uuid,
          name,
          is_seller,
          is_buyer,
          commercial_name,
          phone,
          address,
          property,
          notes,
          created_at,
          updated_at,
          deleted_at
         FROM clients`,
    hasSince ? [since] : []
  );

  const contactRows = await all(
    hasSince
      ? `SELECT
          cc.uuid,
          cc.client_uuid,
          cc.channel,
          cc.summary,
          cc.next_step,
          cc.contact_date,
          cc.created_at,
          cc.updated_at,
          cc.deleted_at
         FROM client_contacts cc
         WHERE datetime(cc.updated_at) > datetime(?)`
      : `SELECT
          cc.uuid,
          cc.client_uuid,
          cc.channel,
          cc.summary,
          cc.next_step,
          cc.contact_date,
          cc.created_at,
          cc.updated_at,
          cc.deleted_at
         FROM client_contacts cc`,
    hasSince ? [since] : []
  );

  return {
    clients: clientRows,
    contacts: contactRows,
  };
}

async function upsertClientFromSync(clientData) {
  const clientUuid = String(clientData.uuid || '').trim();
  if (!clientUuid) {
    return { action: 'skipped' };
  }

  const local = await get('SELECT id, updated_at FROM clients WHERE uuid = ?', [clientUuid]);
  if (local && !isIncomingNewer(clientData.updated_at, local.updated_at)) {
    return { action: 'ignored' };
  }

  const resolvedCommercialName = String(clientData.commercial_name || '').trim();
  const commercialOwnerId = await resolveCommercialOwnerId(resolvedCommercialName);

  const values = [
    clientData.name || null,
    clientData.is_seller ? 1 : 0,
    clientData.is_buyer ? 1 : 0,
    resolvedCommercialName || null,
    commercialOwnerId,
    clientData.phone || null,
    clientData.address || null,
    clientData.property || null,
    clientData.notes || null,
    clientData.created_at || toSqliteDateTime(new Date()),
    clientData.updated_at || toSqliteDateTime(new Date()),
    clientData.deleted_at || null,
  ];

  if (!local) {
    await run(
      `INSERT INTO clients (
        uuid,
        name,
        is_seller,
        is_buyer,
        commercial_name,
        commercial_user_id,
        phone,
        address,
        property,
        notes,
        created_at,
        updated_at,
        deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [clientUuid, ...values]
    );
    return { action: 'inserted' };
  }

  await run(
    `UPDATE clients
     SET
       name = ?,
       is_seller = ?,
       is_buyer = ?,
       commercial_name = ?,
       commercial_user_id = ?,
       phone = ?,
       address = ?,
       property = ?,
       notes = ?,
       created_at = ?,
       updated_at = ?,
       deleted_at = ?
     WHERE uuid = ?`,
    [...values, clientUuid]
  );

  return { action: 'updated' };
}

async function upsertContactFromSync(contactData) {
  const contactUuid = String(contactData.uuid || '').trim();
  const clientUuid = String(contactData.client_uuid || '').trim();
  if (!contactUuid || !clientUuid) {
    return { action: 'skipped' };
  }

  const targetClient = await get('SELECT id FROM clients WHERE uuid = ?', [clientUuid]);
  if (!targetClient) {
    return { action: 'skipped' };
  }

  const local = await get('SELECT id, updated_at FROM client_contacts WHERE uuid = ?', [contactUuid]);
  if (local && !isIncomingNewer(contactData.updated_at, local.updated_at)) {
    return { action: 'ignored' };
  }

  const values = [
    targetClient.id,
    clientUuid,
    contactData.channel || null,
    contactData.summary || '',
    contactData.next_step || null,
    contactData.contact_date || null,
    contactData.created_at || toSqliteDateTime(new Date()),
    contactData.updated_at || toSqliteDateTime(new Date()),
    contactData.deleted_at || null,
  ];

  if (!local) {
    await run(
      `INSERT INTO client_contacts (
        uuid,
        client_id,
        client_uuid,
        channel,
        summary,
        next_step,
        contact_date,
        created_at,
        updated_at,
        deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?)`,
      [contactUuid, ...values]
    );
    return { action: 'inserted' };
  }

  await run(
    `UPDATE client_contacts
     SET
       client_id = ?,
       client_uuid = ?,
       channel = ?,
       summary = ?,
       next_step = ?,
       contact_date = COALESCE(?, contact_date),
       created_at = ?,
       updated_at = ?,
       deleted_at = ?
     WHERE uuid = ?`,
    [...values, contactUuid]
  );

  return { action: 'updated' };
}

async function applySyncBatch(payload) {
  const clients = Array.isArray(payload && payload.clients) ? payload.clients : [];
  const contacts = Array.isArray(payload && payload.contacts) ? payload.contacts : [];

  const result = {
    clients: { inserted: 0, updated: 0, ignored: 0, skipped: 0 },
    contacts: { inserted: 0, updated: 0, ignored: 0, skipped: 0 },
  };

  for (const clientData of clients) {
    const action = await upsertClientFromSync(clientData);
    result.clients[action.action] += 1;
  }

  for (const contactData of contacts) {
    const action = await upsertContactFromSync(contactData);
    result.contacts[action.action] += 1;
  }

  return result;
}

async function runSyncWithUpstream() {
  assertSyncConfigured();

  const state = await getSyncState(SYNC_UPSTREAM_URL);
  const since = state && state.last_success_at ? state.last_success_at : null;
  const localChanges = await collectLocalChanges(since);

  const pushResponse = await fetch(`${SYNC_UPSTREAM_URL}/api/sync/batch`, {
    method: 'POST',
    headers: getSyncHeaders(),
    body: JSON.stringify({
      node_id: NODE_ID,
      sent_at: new Date().toISOString(),
      clients: localChanges.clients,
      contacts: localChanges.contacts,
    }),
  });

  if (!pushResponse.ok) {
    const remoteError = await pushResponse.json().catch(() => ({ message: 'Falha no push de sincronização.' }));
    const error = new Error(remoteError.message || 'Falha no push de sincronização.');
    error.statusCode = pushResponse.status;
    throw error;
  }

  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  const pullResponse = await fetch(`${SYNC_UPSTREAM_URL}/api/sync/changes${query}`, {
    headers: getSyncHeaders(),
  });

  if (!pullResponse.ok) {
    const remoteError = await pullResponse.json().catch(() => ({ message: 'Falha no pull de sincronização.' }));
    const error = new Error(remoteError.message || 'Falha no pull de sincronização.');
    error.statusCode = pullResponse.status;
    throw error;
  }

  const pulledPayload = await pullResponse.json();
  const applied = await applySyncBatch(pulledPayload);
  const completedAt = new Date().toISOString();
  await setSyncState(SYNC_UPSTREAM_URL, completedAt);

  return {
    upstream_url: SYNC_UPSTREAM_URL,
    node_id: NODE_ID,
    since,
    completed_at: completedAt,
    pushed: {
      clients: localChanges.clients.length,
      contacts: localChanges.contacts.length,
    },
    pulled: {
      clients: Array.isArray(pulledPayload.clients) ? pulledPayload.clients.length : 0,
      contacts: Array.isArray(pulledPayload.contacts) ? pulledPayload.contacts.length : 0,
    },
    applied,
  };
}

function csvEscape(value) {
  const raw = String(value == null ? '' : value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function toSqliteDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function getNetworkUrls(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];

  for (const addresses of Object.values(interfaces)) {
    if (!addresses) {
      continue;
    }

    for (const addressInfo of addresses) {
      if (addressInfo.internal) {
        continue;
      }

      if (addressInfo.family === 'IPv4') {
        urls.push(`http://${addressInfo.address}:${port}`);
      }
    }
  }

  return urls;
}

function getPeriodBounds(referenceDate = new Date()) {
  const now = new Date(referenceDate);

  const startOfWeek = new Date(now);
  const day = startOfWeek.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  startOfWeek.setDate(startOfWeek.getDate() + diff);
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  startOfMonth.setHours(0, 0, 0, 0);

  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  endOfMonth.setHours(23, 59, 59, 999);

  return { now, startOfWeek, endOfWeek, startOfMonth, endOfMonth };
}

const FOLLOW_UP_BASE_PLAN = [
  { day: 0, stage: 'Criação' },
  { day: 1, stage: 'Primeira abordagem' },
  { day: 3, stage: 'Reforço de valor' },
  { day: 7, stage: 'Tentativa de reativação' },
];

function startOfDay(date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

function addDays(date, days) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function buildFollowUpCheckpoints(createdAtDate, referenceEndDate) {
  const createdStart = startOfDay(createdAtDate);
  const checkpoints = FOLLOW_UP_BASE_PLAN.map((item) => ({
    day: item.day,
    stage: item.stage,
    dueDate: addDays(createdStart, item.day),
  }));

  const msDay = 24 * 60 * 60 * 1000;
  const elapsedDays = Math.max(0, Math.floor((referenceEndDate.getTime() - createdStart.getTime()) / msDay));
  const maxDay = Math.max(14, elapsedDays + 14);

  for (let day = 14; day <= maxDay; day += 7) {
    checkpoints.push({
      day,
      stage: 'Seguimento semanal',
      dueDate: addDays(createdStart, day),
    });
  }

  return checkpoints;
}

function hasContactForCheckpoint(contactDates, dueDate) {
  const dueStart = startOfDay(dueDate).getTime();
  return contactDates.some((date) => date.getTime() >= dueStart);
}

function getClientSituationFromLatestContact(latestContact, totalContacts) {
  if (!latestContact) {
    return 'Sem contacto registado';
  }

  if (latestContact.next_step && String(latestContact.next_step).trim()) {
    return String(latestContact.next_step).trim();
  }

  if (latestContact.summary && String(latestContact.summary).trim()) {
    return String(latestContact.summary).trim();
  }

  if (totalContacts > 0) {
    return 'Em acompanhamento';
  }

  return 'Sem situação definida';
}

function getNextPendingFollowUp(createdAt, contacts, referenceEndDate) {
  const createdAtDate = new Date(createdAt);
  if (Number.isNaN(createdAtDate.getTime())) {
    return null;
  }

  const contactDates = contacts
    .map((contact) => new Date(contact.contact_date || contact.created_at))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const checkpoints = buildFollowUpCheckpoints(createdAtDate, referenceEndDate);
  for (const checkpoint of checkpoints) {
    if (!hasContactForCheckpoint(contactDates, checkpoint.dueDate)) {
      return checkpoint;
    }
  }

  return null;
}

async function getCommercialProgressByUser(userId, username, fullName, referenceDate = new Date()) {
  const bounds = getPeriodBounds(referenceDate);
  const identities = [normalizeIdentity(username), normalizeIdentity(fullName)].filter(Boolean);
  const placeholders = identities.map(() => '?').join(', ');

  const countSqlBase =
    identities.length > 0
      ? `(commercial_user_id = ? OR (commercial_user_id IS NULL AND lower(COALESCE(commercial_name, '')) IN (${placeholders})))`
      : 'commercial_user_id = ?';

  const weekSql = `
    SELECT COUNT(*) AS total
    FROM clients
    WHERE ${countSqlBase}
      AND deleted_at IS NULL
      AND datetime(created_at) >= datetime(?)
      AND datetime(created_at) <= datetime(?)
  `;

  const monthSql = `
    SELECT COUNT(*) AS total
    FROM clients
    WHERE ${countSqlBase}
      AND deleted_at IS NULL
      AND datetime(created_at) >= datetime(?)
      AND datetime(created_at) <= datetime(?)
  `;

  const baseParams = identities.length > 0 ? [userId, ...identities] : [userId];
  const weekCount = await get(weekSql, [
    ...baseParams,
    toSqliteDateTime(bounds.startOfWeek),
    toSqliteDateTime(bounds.endOfWeek),
  ]);
  const monthCount = await get(monthSql, [
    ...baseParams,
    toSqliteDateTime(bounds.startOfMonth),
    toSqliteDateTime(bounds.endOfMonth),
  ]);

  return {
    achieved_week: Number((weekCount && weekCount.total) || 0),
    achieved_month: Number((monthCount && monthCount.total) || 0),
    week_start: toSqliteDateTime(bounds.startOfWeek),
    week_end: toSqliteDateTime(bounds.endOfWeek),
    month_start: toSqliteDateTime(bounds.startOfMonth),
    month_end: toSqliteDateTime(bounds.endOfMonth),
    is_end_of_week: bounds.now.toDateString() === bounds.endOfWeek.toDateString(),
    is_end_of_month: bounds.now.toDateString() === bounds.endOfMonth.toDateString(),
  };
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || !sessions.has(token)) {
    res.status(401).json({ message: 'Não autenticado' });
    return;
  }

  req.user = sessions.get(token);
  next();
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ message: 'Acesso negado' });
    return;
  }

  next();
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ message: 'Utilizador e palavra-passe são obrigatórios' });
    return;
  }

  const user = await get(
    'SELECT id, username, role, full_name FROM users WHERE username = ? AND password = ?',
    [username, password]
  );

  if (!user) {
    res.status(401).json({ message: 'Credenciais inválidas' });
    return;
  }

  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, user);

  res.json({ token, user });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json(req.user);
});

app.get('/api/users/commercials', authMiddleware, adminOnly, async (_req, res) => {
  const rows = await all(
    `SELECT id, username, full_name, role
     FROM users
     WHERE role = 'commercial'
     ORDER BY COALESCE(full_name, username) COLLATE NOCASE ASC`
  );

  res.json(rows);
});

app.post('/api/users/commercials', authMiddleware, adminOnly, async (req, res) => {
  const { username, password, full_name } = req.body;

  const normalizedUsername = String(username || '').trim().toLowerCase();
  const normalizedPassword = String(password || '').trim();
  const normalizedFullName = String(full_name || '').trim();

  if (!normalizedUsername || !normalizedPassword || !normalizedFullName) {
    res.status(400).json({ message: 'Nome, utilizador e palavra-passe são obrigatórios' });
    return;
  }

  const existing = await get('SELECT id FROM users WHERE username = ?', [normalizedUsername]);
  if (existing) {
    res.status(409).json({ message: 'Já existe um utilizador com esse nome' });
    return;
  }

  const result = await run(
    'INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
    [normalizedUsername, normalizedPassword, normalizedFullName, 'commercial']
  );

  const created = await get('SELECT id, username, full_name, role FROM users WHERE id = ?', [result.lastID]);
  res.status(201).json(created);
});

app.delete('/api/users/commercials/:id', authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;

  const existing = await get('SELECT id, role FROM users WHERE id = ?', [id]);
  if (!existing) {
    res.status(404).json({ message: 'Utilizador não encontrado' });
    return;
  }

  if (existing.role !== 'commercial') {
    res.status(400).json({ message: 'Só pode remover contas de comercial' });
    return;
  }

  await run('DELETE FROM users WHERE id = ?', [id]);
  res.status(204).send();
});

app.get('/api/goals/commercials', authMiddleware, adminOnly, async (_req, res) => {
  const rows = await all(
    `SELECT
      u.id,
      u.username,
      u.full_name,
      COALESCE(g.weekly_goal, 0) AS weekly_goal,
      COALESCE(g.monthly_goal, 0) AS monthly_goal,
      g.updated_at
     FROM users u
     LEFT JOIN commercial_goals g ON g.commercial_user_id = u.id
     WHERE u.role = 'commercial'
     ORDER BY COALESCE(u.full_name, u.username) COLLATE NOCASE ASC`
  );

  const enriched = [];
  for (const row of rows) {
    const progress = await getCommercialProgressByUser(row.id, row.username, row.full_name);
    enriched.push({
      ...row,
      achieved_week: progress.achieved_week,
      achieved_month: progress.achieved_month,
    });
  }

  res.json(enriched);
});

app.put('/api/goals/commercials/:id', authMiddleware, adminOnly, async (req, res) => {
  const { id } = req.params;
  const weeklyRaw = Number(req.body.weekly_goal);
  const monthlyRaw = Number(req.body.monthly_goal);

  const weeklyGoal = Number.isFinite(weeklyRaw) ? Math.max(0, Math.floor(weeklyRaw)) : NaN;
  const monthlyGoal = Number.isFinite(monthlyRaw) ? Math.max(0, Math.floor(monthlyRaw)) : NaN;

  if (!Number.isFinite(weeklyGoal) || !Number.isFinite(monthlyGoal)) {
    res.status(400).json({ message: 'Metas semanal e mensal devem ser números válidos.' });
    return;
  }

  const existingUser = await get('SELECT id, role FROM users WHERE id = ?', [id]);
  if (!existingUser || existingUser.role !== 'commercial') {
    res.status(404).json({ message: 'Comercial não encontrado.' });
    return;
  }

  await run(
    `INSERT INTO commercial_goals (commercial_user_id, weekly_goal, monthly_goal, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(commercial_user_id)
     DO UPDATE SET
       weekly_goal = excluded.weekly_goal,
       monthly_goal = excluded.monthly_goal,
       updated_at = CURRENT_TIMESTAMP`,
    [id, weeklyGoal, monthlyGoal]
  );

  const updated = await get(
    `SELECT commercial_user_id, weekly_goal, monthly_goal, updated_at
     FROM commercial_goals
     WHERE commercial_user_id = ?`,
    [id]
  );

  res.json(updated);
});

app.get('/api/goals/me', authMiddleware, async (req, res) => {
  if (!req.user || req.user.role !== 'commercial') {
    res.status(403).json({ message: 'Apenas comerciais têm metas individuais.' });
    return;
  }

  const goal = await get(
    `SELECT weekly_goal, monthly_goal, updated_at
     FROM commercial_goals
     WHERE commercial_user_id = ?`,
    [req.user.id]
  );

  const progress = await getCommercialProgressByUser(req.user.id, req.user.username, req.user.full_name);
  const weeklyGoal = Number((goal && goal.weekly_goal) || 0);
  const monthlyGoal = Number((goal && goal.monthly_goal) || 0);

  res.json({
    weekly_goal: weeklyGoal,
    monthly_goal: monthlyGoal,
    updated_at: goal ? goal.updated_at : null,
    ...progress,
    reached_weekly_goal: weeklyGoal > 0 ? progress.achieved_week >= weeklyGoal : false,
    reached_monthly_goal: monthlyGoal > 0 ? progress.achieved_month >= monthlyGoal : false,
  });
});

app.get('/api/followups/today', authMiddleware, async (req, res) => {
  const filters = [];
  const params = [];
  appendClientScopeFilters(req, filters, params, 'c.');

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const clients = await all(
    `SELECT c.id, c.name, c.commercial_name, c.is_seller, c.is_buyer, c.created_at
     FROM clients c
     ${whereClause}
     ${whereClause ? 'AND' : 'WHERE'} c.deleted_at IS NULL
     ORDER BY datetime(c.created_at) ASC`,
    params
  );

  if (!clients.length) {
    res.json({ date: toSqliteDateTime(startOfDay(new Date())), items: [] });
    return;
  }

  const clientIds = clients.map((client) => client.id);
  const placeholders = clientIds.map(() => '?').join(', ');
  const contacts = await all(
    `SELECT id, client_id, summary, next_step, contact_date, created_at
     FROM client_contacts
     WHERE client_id IN (${placeholders})
       AND deleted_at IS NULL
     ORDER BY datetime(contact_date) ASC, id ASC`,
    clientIds
  );

  const contactsByClientId = new Map();
  for (const contact of contacts) {
    if (!contactsByClientId.has(contact.client_id)) {
      contactsByClientId.set(contact.client_id, []);
    }
    contactsByClientId.get(contact.client_id).push(contact);
  }

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const { startOfWeek, endOfWeek } = getPeriodBounds(todayStart);
  const msDay = 24 * 60 * 60 * 1000;
  const items = [];
  const weeklyItems = [];

  for (const client of clients) {
    const clientContacts = contactsByClientId.get(client.id) || [];
    const pendingFollowUp = getNextPendingFollowUp(client.created_at, clientContacts, todayEnd);
    if (!pendingFollowUp) {
      continue;
    }

    const dueDate = startOfDay(pendingFollowUp.dueDate);
    const dueTime = dueDate.getTime();

    if (dueTime >= startOfWeek.getTime() && dueTime <= endOfWeek.getTime()) {
      weeklyItems.push({
        client_id: client.id,
        client_name: client.name,
        commercial_name: client.commercial_name,
        is_seller: Boolean(client.is_seller),
        is_buyer: Boolean(client.is_buyer),
        created_at: client.created_at,
        follow_up_stage: pendingFollowUp.stage,
        follow_up_day: pendingFollowUp.day,
        follow_up_due_date: toSqliteDateTime(dueDate),
      });
    }

    if (dueDate.getTime() > todayEnd.getTime()) {
      continue;
    }

    const latestContact = clientContacts.length > 0 ? clientContacts[clientContacts.length - 1] : null;
    const overdueDays = Math.max(0, Math.floor((todayStart.getTime() - dueDate.getTime()) / msDay));

    items.push({
      client_id: client.id,
      client_name: client.name,
      commercial_name: client.commercial_name,
      is_seller: Boolean(client.is_seller),
      is_buyer: Boolean(client.is_buyer),
      created_at: client.created_at,
      follow_up_stage: pendingFollowUp.stage,
      follow_up_day: pendingFollowUp.day,
      follow_up_due_date: toSqliteDateTime(dueDate),
      days_overdue: overdueDays,
      situation: getClientSituationFromLatestContact(latestContact, clientContacts.length),
      last_contact_date: latestContact ? latestContact.contact_date || latestContact.created_at : null,
      last_contact_summary: latestContact ? latestContact.summary : null,
      last_contact_next_step: latestContact ? latestContact.next_step : null,
    });
  }

  items.sort((a, b) => {
    if (b.days_overdue !== a.days_overdue) {
      return b.days_overdue - a.days_overdue;
    }
    return new Date(a.follow_up_due_date).getTime() - new Date(b.follow_up_due_date).getTime();
  });

  res.json({
    date: toSqliteDateTime(todayStart),
    items,
    weekly_items: weeklyItems,
  });
});

app.post('/api/clients/:id/followup-outcomes', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const outcomeType = String(req.body.outcome_type || '').trim().toLowerCase();

  if (!['acquisition', 'visit'].includes(outcomeType)) {
    res.status(400).json({ message: 'Tipo de registo inválido.' });
    return;
  }

  const client = await getScopedClient(req, id);
  if (!client) {
    res.status(404).json({ message: 'Cliente não encontrado ou sem permissão' });
    return;
  }

  if (outcomeType === 'acquisition' && !client.is_seller) {
    res.status(400).json({ message: 'Angariação só pode ser registada para clientes vendedores.' });
    return;
  }

  if (outcomeType === 'visit' && !client.is_buyer) {
    res.status(400).json({ message: 'Visita só pode ser registada para clientes compradores.' });
    return;
  }

  const result = await run(
    `INSERT INTO client_followup_outcomes (client_id, outcome_type, created_by_user_id)
     VALUES (?, ?, ?)`,
    [id, outcomeType, req.user.id]
  );

  const created = await get('SELECT * FROM client_followup_outcomes WHERE id = ?', [result.lastID]);
  res.status(201).json(created);
});

app.get('/api/stats/outcomes/commercials', authMiddleware, async (req, res) => {
  const filters = [];
  const params = [];
  appendClientScopeFilters(req, filters, params, 'c.');

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = await all(
    `SELECT
      COALESCE(NULLIF(trim(c.commercial_name), ''), 'Sem comercial atribuído') AS commercial_name,
      SUM(CASE WHEN o.outcome_type = 'acquisition' THEN 1 ELSE 0 END) AS acquisitions,
      SUM(CASE WHEN o.outcome_type = 'visit' THEN 1 ELSE 0 END) AS visits
     FROM clients c
     LEFT JOIN client_followup_outcomes o ON o.client_id = c.id
     ${whereClause}
    ${whereClause ? 'AND' : 'WHERE'} c.deleted_at IS NULL
     GROUP BY COALESCE(NULLIF(trim(c.commercial_name), ''), 'Sem comercial atribuído')
     ORDER BY commercial_name COLLATE NOCASE ASC`,
    params
  );

  res.json(
    rows.map((row) => ({
      commercial_name: row.commercial_name,
      acquisitions: Number(row.acquisitions || 0),
      visits: Number(row.visits || 0),
    }))
  );
});

app.get('/api/clients', authMiddleware, async (req, res) => {
  const { role, search } = req.query;
  const filters = [];
  const params = [];

  appendClientScopeFilters(req, filters, params);

  if (role === 'seller') {
    filters.push('is_seller = 1');
  } else if (role === 'buyer') {
    filters.push('is_buyer = 1');
  } else if (role === 'both') {
    filters.push('is_seller = 1 AND is_buyer = 1');
  }

  if (search) {
    filters.push(`(
      lower(name) LIKE ?
      OR lower(COALESCE(commercial_name, '')) LIKE ?
      OR lower(COALESCE(phone, '')) LIKE ?
      OR lower(COALESCE(address, '')) LIKE ?
      OR lower(COALESCE(property, '')) LIKE ?
      OR lower(COALESCE(notes, '')) LIKE ?
    )`);
    const term = `%${String(search).toLowerCase()}%`;
    params.push(term, term, term, term, term, term);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = await all(
    `SELECT * FROM clients ${whereClause} ${whereClause ? 'AND' : 'WHERE'} deleted_at IS NULL ORDER BY id DESC`,
    params
  );
  res.json(rows);
});

app.post('/api/clients', authMiddleware, async (req, res) => {
  const { name, is_seller, is_buyer, commercial_name, phone, address, property, notes } = req.body;

  if (!name) {
    res.status(400).json({ message: 'Nome é obrigatório' });
    return;
  }

  const seller = is_seller ? 1 : 0;
  const buyer = is_buyer ? 1 : 0;

  if (!seller && !buyer) {
    res.status(400).json({ message: 'Selecione pelo menos vendedor ou comprador' });
    return;
  }

  const normalizedPhone = phone ? String(phone).trim() : '';
  if (normalizedPhone) {
    const duplicate = await get('SELECT id FROM clients WHERE phone = ? AND deleted_at IS NULL LIMIT 1', [
      normalizedPhone,
    ]);
    if (duplicate) {
      res.status(409).json({ message: 'Cliente já existe!' });
      return;
    }
  }

  const commercialNameByRole =
    req.user.role === 'commercial'
      ? String(req.user.full_name || req.user.username || '').trim()
      : String(commercial_name || '').trim();

  const commercialOwnerId =
    req.user.role === 'commercial' ? req.user.id : await resolveCommercialOwnerId(commercialNameByRole);

  const result = await run(
    `INSERT INTO clients (
      uuid,
      name,
      is_seller,
      is_buyer,
      commercial_name,
      commercial_user_id,
      phone,
      address,
      property,
      notes,
      updated_at
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      crypto.randomUUID(),
      name,
      seller,
      buyer,
      commercialNameByRole || null,
      commercialOwnerId,
      normalizedPhone || null,
      address || null,
      property || null,
      notes || null,
    ]
  );

  const created = await get('SELECT * FROM clients WHERE id = ?', [result.lastID]);
  res.status(201).json(created);
});

app.put('/api/clients/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, is_seller, is_buyer, commercial_name, phone, address, property, notes } = req.body;

  if (!name) {
    res.status(400).json({ message: 'Nome é obrigatório' });
    return;
  }

  const seller = is_seller ? 1 : 0;
  const buyer = is_buyer ? 1 : 0;

  if (!seller && !buyer) {
    res.status(400).json({ message: 'Selecione pelo menos vendedor ou comprador' });
    return;
  }

  const normalizedPhone = phone ? String(phone).trim() : '';

  const existing = await getScopedClient(req, id);
  if (!existing) {
    res.status(404).json({ message: 'Cliente não encontrado ou sem permissão' });
    return;
  }

  if (normalizedPhone) {
    const duplicate = await get(
      'SELECT id FROM clients WHERE phone = ? AND id != ? AND deleted_at IS NULL LIMIT 1',
      [normalizedPhone, id]
    );
    if (duplicate) {
      res.status(409).json({ message: 'Cliente já existe!' });
      return;
    }
  }

  const commercialNameByRole =
    req.user.role === 'commercial'
      ? String(req.user.full_name || req.user.username || '').trim()
      : String(commercial_name || '').trim();

  const commercialOwnerId =
    req.user.role === 'commercial' ? req.user.id : await resolveCommercialOwnerId(commercialNameByRole);

  await run(
    `UPDATE clients
     SET name = ?, is_seller = ?, is_buyer = ?, commercial_name = ?, commercial_user_id = ?, phone = ?, address = ?, property = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      name,
      seller,
      buyer,
      commercialNameByRole || null,
      commercialOwnerId,
      normalizedPhone || null,
      address || null,
      property || null,
      notes || null,
      id,
    ]
  );

  const updated = await get('SELECT * FROM clients WHERE id = ?', [id]);
  res.json(updated);
});

app.delete('/api/clients/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  const existing = await getScopedClient(req, id);
  if (!existing) {
    res.status(404).json({ message: 'Cliente não encontrado ou sem permissão' });
    return;
  }

  await run(
    'UPDATE client_contacts SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE client_id = ? AND deleted_at IS NULL',
    [id]
  );
  await run('UPDATE clients SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
  res.status(204).send();
});

app.get('/api/clients/:id/contacts', authMiddleware, async (req, res) => {
  const { id } = req.params;

  const existing = await getScopedClient(req, id);
  if (!existing) {
    res.status(404).json({ message: 'Cliente não encontrado ou sem permissão' });
    return;
  }

  const rows = await all(
    `SELECT *
     FROM client_contacts
     WHERE client_id = ?
       AND deleted_at IS NULL
     ORDER BY datetime(contact_date) DESC, id DESC`,
    [id]
  );

  res.json(rows);
});

app.post('/api/clients/:id/contacts', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { channel, summary, next_step, contact_date } = req.body;

  const existing = await getScopedClient(req, id);
  if (!existing) {
    res.status(404).json({ message: 'Cliente não encontrado ou sem permissão' });
    return;
  }

  if (!summary || !String(summary).trim()) {
    res.status(400).json({ message: 'Resumo do contacto é obrigatório' });
    return;
  }

  const result = await run(
    `INSERT INTO client_contacts (uuid, client_id, client_uuid, channel, summary, next_step, contact_date, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)`,
    [
      crypto.randomUUID(),
      id,
      existing.uuid,
      channel ? String(channel).trim() : null,
      String(summary).trim(),
      next_step ? String(next_step).trim() : null,
      contact_date || null,
    ]
  );

  const created = await get('SELECT * FROM client_contacts WHERE id = ?', [result.lastID]);
  res.status(201).json(created);
});

app.get('/api/clients/export.csv', authMiddleware, async (req, res) => {
  const { role, search } = req.query;
  const filters = [];
  const params = [];

  appendClientScopeFilters(req, filters, params);

  if (role === 'seller') {
    filters.push('is_seller = 1');
  } else if (role === 'buyer') {
    filters.push('is_buyer = 1');
  } else if (role === 'both') {
    filters.push('is_seller = 1 AND is_buyer = 1');
  }

  if (search) {
    filters.push(`(
      lower(name) LIKE ?
      OR lower(COALESCE(commercial_name, '')) LIKE ?
      OR lower(COALESCE(phone, '')) LIKE ?
      OR lower(COALESCE(address, '')) LIKE ?
      OR lower(COALESCE(property, '')) LIKE ?
      OR lower(COALESCE(notes, '')) LIKE ?
    )`);
    const term = `%${String(search).toLowerCase()}%`;
    params.push(term, term, term, term, term, term);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = await all(
    `SELECT * FROM clients ${whereClause} ${whereClause ? 'AND' : 'WHERE'} deleted_at IS NULL ORDER BY id DESC`,
    params
  );

  const header = ['id', 'nome', 'comercial', 'tipo_cliente', 'telemovel', 'morada', 'imovel', 'observacoes', 'criado_em'];
  const lines = [header.join(',')];

  for (const row of rows) {
    const tipoCliente = row.is_seller && row.is_buyer ? 'Vendedor e Comprador' : row.is_seller ? 'Vendedor' : row.is_buyer ? 'Comprador' : '-';
    lines.push(
      [
        csvEscape(row.id),
        csvEscape(row.name),
        csvEscape(row.commercial_name),
        csvEscape(tipoCliente),
        csvEscape(row.phone),
        csvEscape(row.address),
        csvEscape(row.property),
        csvEscape(row.notes),
        csvEscape(row.created_at),
      ].join(',')
    );
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="clientes-imobiliario.csv"');
  res.send(`\uFEFF${lines.join('\n')}`);
});

app.get('/api/dashboard/summary', authMiddleware, async (_req, res) => {
  const filters = [];
  const params = [];
  appendClientScopeFilters(_req, filters, params);
  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const totals = await get(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN is_seller = 1 THEN 1 ELSE 0 END) AS sellers,
      SUM(CASE WHEN is_buyer = 1 THEN 1 ELSE 0 END) AS buyers,
      SUM(CASE WHEN is_seller = 1 AND is_buyer = 1 THEN 1 ELSE 0 END) AS both
     FROM clients
     ${whereClause}
     ${whereClause ? 'AND' : 'WHERE'} deleted_at IS NULL`,
    params
  );

  res.json({
    total_clients: Number(totals.total || 0),
    total_sellers: Number(totals.sellers || 0),
    total_buyers: Number(totals.buyers || 0),
    total_both: Number(totals.both || 0),
  });
});

app.get('/api/sync/status', authMiddleware, async (_req, res) => {
  const configured = Boolean(SYNC_UPSTREAM_URL && SYNC_SHARED_KEY);
  if (!configured) {
    res.json({
      configured: false,
      node_id: NODE_ID,
      upstream_url: SYNC_UPSTREAM_URL || null,
      last_sync_at: null,
      pending_changes: null,
    });
    return;
  }

  const state = await getSyncState(SYNC_UPSTREAM_URL);
  const since = state && state.last_success_at ? state.last_success_at : null;
  const pending = await collectLocalChanges(since);

  res.json({
    configured: true,
    node_id: NODE_ID,
    upstream_url: SYNC_UPSTREAM_URL,
    last_sync_at: since,
    pending_changes: pending.clients.length + pending.contacts.length,
  });
});

app.post('/api/sync/run', authMiddleware, async (_req, res) => {
  try {
    const result = await runSyncWithUpstream();
    res.json(result);
  } catch (error) {
    const statusCode = Number(error.statusCode || 500);
    res.status(statusCode).json({ message: error.message || 'Falha na sincronização.' });
  }
});

app.get('/api/sync/changes', syncMachineAuth, async (req, res) => {
  const since = String(req.query.since || '').trim() || null;
  const changes = await collectLocalChanges(since);
  res.json({
    node_id: NODE_ID,
    generated_at: new Date().toISOString(),
    clients: changes.clients,
    contacts: changes.contacts,
  });
});

app.post('/api/sync/batch', syncMachineAuth, async (req, res) => {
  const payload = req.body || {};
  const applied = await applySyncBatch(payload);
  res.json({
    node_id: NODE_ID,
    received_at: new Date().toISOString(),
    applied,
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: 'Erro interno no servidor' });
});

async function start() {
  await initializeDb();

  app.listen(PORT, HOST, () => {
    console.log(`Servidor ativo em http://localhost:${PORT}`);
    if (HOST === '0.0.0.0' || HOST === '::') {
      const urls = getNetworkUrls(PORT);
      if (urls.length > 0) {
        console.log('Acesso em rede local:');
        for (const url of urls) {
          console.log(`- ${url}`);
        }
      }
    }
  });
}

start().catch((error) => {
  console.error('Falha ao iniciar aplicação:', error);
  process.exit(1);
});
