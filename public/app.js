let authToken = '';
let clientsCache = [];
let currentUser = null;
let commercialUsersCache = [];
let commercialGoalsCache = [];
let myGoalStatus = null;
let followUpsTodayCache = [];
let followUpsWeekCache = [];
let outcomesStatsByCommercialCache = new Map();
let syncStatus = null;

const loginSection = document.getElementById('loginSection');
const enterLocalModeBtn = document.getElementById('enterLocalModeBtn');
const mainSection = document.getElementById('mainSection');

const dashboard = document.getElementById('dashboard');
const syncPanel = document.getElementById('syncPanel');
const runSyncBtn = document.getElementById('runSyncBtn');
const syncStatusText = document.getElementById('syncStatusText');
const commercialStats = document.getElementById('commercialStats');
const followUpSection = document.getElementById('followUpSection');
const followUpList = document.getElementById('followUpList');
const clientForm = document.getElementById('clientForm');
const clientsList = document.getElementById('clientsList');
const clientSearch = document.getElementById('clientSearch');
const clientTypeFilter = document.getElementById('clientTypeFilter');
const exportClientsBtn = document.getElementById('exportClientsBtn');
const commercialUsersSection = document.getElementById('commercialUsersSection');
const commercialUserForm = document.getElementById('commercialUserForm');
const commercialUsersList = document.getElementById('commercialUsersList');
const commercialUserFullName = document.getElementById('commercialUserFullName');
const commercialUserUsername = document.getElementById('commercialUserUsername');
const commercialUserPassword = document.getElementById('commercialUserPassword');
const goalsAdminSection = document.getElementById('goalsAdminSection');
const goalForm = document.getElementById('goalForm');
const goalCommercialUser = document.getElementById('goalCommercialUser');
const goalWeekly = document.getElementById('goalWeekly');
const goalMonthly = document.getElementById('goalMonthly');
const goalsList = document.getElementById('goalsList');

const clientEditId = document.getElementById('clientEditId');
const clientSubmitBtn = document.getElementById('clientSubmitBtn');
const clientCancelEdit = document.getElementById('clientCancelEdit');

const clientName = document.getElementById('clientName');
const clientCommercialName = document.getElementById('clientCommercialName');
const clientIsSeller = document.getElementById('clientIsSeller');
const clientIsBuyer = document.getElementById('clientIsBuyer');
const clientPhone = document.getElementById('clientPhone');
const clientAddress = document.getElementById('clientAddress');
const clientProperty = document.getElementById('clientProperty');
const clientNotes = document.getElementById('clientNotes');

const contactsModal = document.getElementById('contactsModal');
const closeContactsModal = document.getElementById('closeContactsModal');
const contactsModalTitle = document.getElementById('contactsModalTitle');
const contactsList = document.getElementById('contactsList');
const contactForm = document.getElementById('contactForm');
const contactClientId = document.getElementById('contactClientId');
const contactChannel = document.getElementById('contactChannel');
const contactSummary = document.getElementById('contactSummary');
const contactNextStep = document.getElementById('contactNextStep');
const contactDate = document.getElementById('contactDate');
const goalAlertModal = document.getElementById('goalAlertModal');
const closeGoalAlertModal = document.getElementById('closeGoalAlertModal');
const goalAlertContent = document.getElementById('goalAlertContent');
const followUpReminderModal = document.getElementById('followUpReminderModal');
const closeFollowUpReminderModal = document.getElementById('closeFollowUpReminderModal');
const followUpReminderContent = document.getElementById('followUpReminderContent');
const installPanel = document.getElementById('installPanel');
const installAppBtn = document.getElementById('installAppBtn');
const installStatusText = document.getElementById('installStatusText');
const offlinePanel = document.getElementById('offlinePanel');
const offlineModeText = document.getElementById('offlineModeText');
const offlineQueueText = document.getElementById('offlineQueueText');
const offlineSyncBtn = document.getElementById('offlineSyncBtn');

let deferredInstallPrompt = null;
let pendingActionsQueue = [];
let autoSyncInFlight = false;

const LOCAL_SESSION_KEY = 'crm:session:v1';
const LOCAL_CACHE_KEY = 'crm:cache:v1';
const LOCAL_QUEUE_KEY = 'crm:queue:v1';

function loadJson(key, fallbackValue) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallbackValue;
  } catch (_error) {
    return fallbackValue;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function isOfflineError(error) {
  return Boolean(error && error.code === 'OFFLINE');
}

function isLocalOfflineMode() {
  return Boolean(currentUser && currentUser.offline_mode);
}

function nextLocalId() {
  return -Math.floor(Date.now() + Math.random() * 1000);
}

function saveSessionLocally() {
  if (!authToken || !currentUser) {
    return;
  }

  saveJson(LOCAL_SESSION_KEY, {
    token: authToken,
    user: currentUser,
    offline_mode: isLocalOfflineMode(),
    saved_at: new Date().toISOString(),
  });
}

function restoreSessionFromStorage() {
  const saved = loadJson(LOCAL_SESSION_KEY, null);
  if (!saved || !saved.token || !saved.user) {
    return false;
  }

  authToken = String(saved.token);
  currentUser = saved.user;
  if (saved.offline_mode && currentUser) {
    currentUser.offline_mode = true;
  }
  return true;
}

function enterLocalOfflineMode() {
  authToken = `local-${Date.now()}`;
  currentUser = {
    id: 'local-offline',
    username: 'local',
    full_name: 'Modo local',
    role: 'guest',
    offline_mode: true,
  };
  saveSessionLocally();
}

function saveOfflineSnapshot() {
  saveJson(LOCAL_CACHE_KEY, {
    clients: clientsCache,
    followups_today: followUpsTodayCache,
    followups_week: followUpsWeekCache,
    goals_admin: commercialGoalsCache,
    users_commercial: commercialUsersCache,
    my_goal_status: myGoalStatus,
    sync_status: syncStatus,
    outcomes_stats: Array.from(outcomesStatsByCommercialCache.entries()),
    saved_at: new Date().toISOString(),
  });
}

function renderDashboardFromClients() {
  const total = clientsCache.length;
  const sellers = clientsCache.filter((row) => Boolean(row.is_seller)).length;
  const buyers = clientsCache.filter((row) => Boolean(row.is_buyer)).length;
  const both = clientsCache.filter((row) => Boolean(row.is_seller && row.is_buyer)).length;

  dashboard.innerHTML = `
    <div class="metric"><span>Total de clientes</span><strong>${total}</strong></div>
    <div class="metric"><span>Vendedores</span><strong>${sellers}</strong></div>
    <div class="metric"><span>Compradores</span><strong>${buyers}</strong></div>
    <div class="metric"><span>Vendedor e Comprador</span><strong>${both}</strong></div>
  `;
}

function loadOfflineSnapshot() {
  const snapshot = loadJson(LOCAL_CACHE_KEY, null);
  if (!snapshot) {
    clientsCache = [];
    followUpsTodayCache = [];
    followUpsWeekCache = [];
    commercialGoalsCache = [];
    commercialUsersCache = [];
    myGoalStatus = null;
    syncStatus = null;
    outcomesStatsByCommercialCache = new Map();
    return;
  }

  clientsCache = Array.isArray(snapshot.clients) ? snapshot.clients : [];
  followUpsTodayCache = Array.isArray(snapshot.followups_today) ? snapshot.followups_today : [];
  followUpsWeekCache = Array.isArray(snapshot.followups_week) ? snapshot.followups_week : [];
  commercialGoalsCache = Array.isArray(snapshot.goals_admin) ? snapshot.goals_admin : [];
  commercialUsersCache = Array.isArray(snapshot.users_commercial) ? snapshot.users_commercial : [];
  myGoalStatus = snapshot.my_goal_status || null;
  syncStatus = snapshot.sync_status || null;
  outcomesStatsByCommercialCache = new Map(Array.isArray(snapshot.outcomes_stats) ? snapshot.outcomes_stats : []);

  renderDashboardFromClients();
  renderClients();
  renderFollowUpList(followUpsTodayCache);
  renderCommercialStats();
  renderCommercialUsers();
  renderGoalsAdmin();
  renderSyncStatus();
}

function saveQueue() {
  saveJson(LOCAL_QUEUE_KEY, pendingActionsQueue);
}

function loadQueue() {
  pendingActionsQueue = loadJson(LOCAL_QUEUE_KEY, []);
  if (!Array.isArray(pendingActionsQueue)) {
    pendingActionsQueue = [];
  }
}

function queueAction(action) {
  pendingActionsQueue.push({
    ...action,
    queued_at: new Date().toISOString(),
  });
  saveQueue();
  updateOfflinePanel();
}

function upsertClientInCache(client) {
  const index = clientsCache.findIndex((row) => Number(row.id) === Number(client.id));
  if (index === -1) {
    clientsCache.unshift(client);
    return;
  }

  clientsCache[index] = { ...clientsCache[index], ...client };
}

function removeClientFromCache(clientId) {
  clientsCache = clientsCache.filter((row) => Number(row.id) !== Number(clientId));
  localStorage.removeItem(contactsStorageKey(clientId));
}

function updateOfflinePanel() {
  if (!offlinePanel || !offlineModeText || !offlineQueueText || !offlineSyncBtn) {
    return;
  }

  if (!authToken) {
    offlinePanel.classList.add('hidden');
    return;
  }

  offlinePanel.classList.remove('hidden');

  const pendingCount = pendingActionsQueue.length;
  const offline = !navigator.onLine;
  const localMode = isLocalOfflineMode();

  if (localMode) {
    offlineModeText.textContent = offline ? 'Modo local sem servidor' : 'Modo local ativo';
  } else {
    offlineModeText.textContent = offline ? 'Modo offline ativo' : 'Modo online ativo';
  }
  offlineQueueText.textContent =
    pendingCount > 0
      ? `${pendingCount} ação(ões) pendente(s) para sincronizar.`
      : localMode
        ? 'Estás a trabalhar localmente. Entra com uma conta real quando o servidor voltar para sincronizar.'
        : offline
        ? 'Sem ações pendentes. Podes continuar a trabalhar offline.'
        : 'Sem ações pendentes.';

  offlineSyncBtn.disabled = offline || pendingCount === 0 || localMode;
}

function contactsStorageKey(clientId) {
  return `crm:contacts:${clientId}`;
}

function getCachedContacts(clientId) {
  const rows = loadJson(contactsStorageKey(clientId), []);
  return Array.isArray(rows) ? rows : [];
}

function setCachedContacts(clientId, contacts) {
  saveJson(contactsStorageKey(clientId), Array.isArray(contacts) ? contacts : []);
}

function addCachedContact(clientId, payload) {
  const rows = getCachedContacts(clientId);
  rows.unshift({
    id: nextLocalId(),
    channel: payload.channel || null,
    summary: payload.summary,
    next_step: payload.next_step || null,
    contact_date: payload.contact_date || new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  setCachedContacts(clientId, rows);
}

function replaceQueuedClientId(oldClientId, newClientId) {
  pendingActionsQueue = pendingActionsQueue.map((action) => {
    if (Number(action.clientId) !== Number(oldClientId)) {
      return action;
    }

    return { ...action, clientId: newClientId };
  });
}

async function flushPendingActionsQueue() {
  if (!authToken || !navigator.onLine || pendingActionsQueue.length === 0 || isLocalOfflineMode()) {
    updateOfflinePanel();
    return;
  }

  let changed = false;

  let index = 0;
  while (index < pendingActionsQueue.length) {
    const action = pendingActionsQueue[index];
    try {
      if (action.type === 'createClient') {
        const created = await api('/api/clients', {
          method: 'POST',
          body: JSON.stringify(action.payload),
        });
        replaceQueuedClientId(action.clientId, created.id);

        const cachedContacts = getCachedContacts(action.clientId);
        if (cachedContacts.length > 0) {
          setCachedContacts(created.id, cachedContacts);
          localStorage.removeItem(contactsStorageKey(action.clientId));
        }
        upsertClientInCache({ ...action.payload, id: created.id });
      } else if (action.type === 'updateClient') {
        await api(`/api/clients/${action.clientId}`, {
          method: 'PUT',
          body: JSON.stringify(action.payload),
        });
      } else if (action.type === 'deleteClient') {
        await api(`/api/clients/${action.clientId}`, { method: 'DELETE' });
      } else if (action.type === 'createContact') {
        await api(`/api/clients/${action.clientId}/contacts`, {
          method: 'POST',
          body: JSON.stringify(action.payload),
        });
      } else {
        pendingActionsQueue.splice(index, 1);
        continue;
      }

      pendingActionsQueue.splice(index, 1);
      changed = true;
    } catch (error) {
      if (isOfflineError(error)) {
        break;
      }

      alert(`Falha ao sincronizar uma ação pendente: ${error.message}`);
      break;
    }
  }

  saveQueue();

  if (changed) {
    await refreshAll();
  }

  updateOfflinePanel();
}

async function isServerReachable() {
  if (!authToken || isLocalOfflineMode()) {
    return false;
  }

  try {
    await api('/api/me');
    return true;
  } catch (error) {
    if (isOfflineError(error)) {
      return false;
    }

    return false;
  }
}

async function tryAutoSyncOnReconnect() {
  if (autoSyncInFlight || !authToken || pendingActionsQueue.length === 0 || isLocalOfflineMode()) {
    return;
  }

  autoSyncInFlight = true;
  try {
    if (!navigator.onLine) {
      return;
    }

    if (!(await isServerReachable())) {
      return;
    }

    await flushPendingActionsQueue();
    await runSyncNow();
  } finally {
    autoSyncInFlight = false;
  }
}

function isAndroidDevice() {
  return /android/i.test(navigator.userAgent || '');
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent || '');
}

function isRunningStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function hasPwaSecureContext() {
  if (window.isSecureContext) {
    return true;
  }

  const host = String(window.location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

function refreshInstallPanel() {
  if (!installPanel || !installAppBtn || !installStatusText) {
    return;
  }

  if (isRunningStandalone()) {
    installPanel.classList.add('hidden');
    return;
  }

  installPanel.classList.remove('hidden');

  if (deferredInstallPrompt) {
    installAppBtn.disabled = false;
    installStatusText.textContent = 'Este CRM está pronto para ser instalado neste dispositivo.';
    return;
  }

  installAppBtn.disabled = true;
  if (!hasPwaSecureContext()) {
    installStatusText.textContent =
      'Instalação automática indisponível neste endereço. Usa HTTPS ou acede por localhost para ativar a instalação.';
    return;
  }

  if (isIosDevice()) {
    installStatusText.textContent = 'No Safari, usa Partilhar > Adicionar ao ecrã principal para instalar.';
    return;
  }

  if (isAndroidDevice()) {
    installStatusText.textContent = 'Se o botão não ativar automaticamente, usa o menu do Chrome (⋮) > Instalar app/Adicionar ao ecrã principal.';
    return;
  }

  installStatusText.textContent = 'No computador, podes instalar pelo ícone na barra de endereço ou pelo menu do navegador (Instalar app).';
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch (_error) {
    const offlineError = new Error('Sem ligação ao servidor. Operação guardada para sincronizar depois.');
    offlineError.code = 'OFFLINE';
    throw offlineError;
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: 'Erro de comunicação' }));
    throw new Error(err.message || 'Erro na API');
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function roleLabel(client) {
  if (client.is_seller && client.is_buyer) return 'Vendedor e Comprador';
  if (client.is_seller) return 'Vendedor';
  if (client.is_buyer) return 'Comprador';
  return '-';
}

function isAdmin() {
  return Boolean(currentUser && currentUser.role === 'admin');
}

function isCommercial() {
  return Boolean(currentUser && currentUser.role === 'commercial');
}

function applyRoleUi() {
  if (isCommercial()) {
    const commercialDisplayName = String(currentUser.full_name || currentUser.username || '').trim();
    clientCommercialName.value = commercialDisplayName;
    clientCommercialName.readOnly = true;
  } else {
    clientCommercialName.readOnly = false;
  }

  commercialUsersSection.classList.toggle('hidden', !isAdmin());
  goalsAdminSection.classList.toggle('hidden', !isAdmin());
  followUpSection.classList.toggle('hidden', !authToken);
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('pt-PT');
}

function formatShortDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('pt-PT');
}

function formatSyncDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('pt-PT');
}

function getPeriodStarts(referenceDate = new Date()) {
  const now = new Date(referenceDate);

  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const startOfWeek = new Date(now);
  const day = startOfWeek.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  startOfWeek.setDate(startOfWeek.getDate() + diff);
  startOfWeek.setHours(0, 0, 0, 0);

  return {
    startOfWeek,
    startOfMonth,
    startOfYear,
  };
}

function renderCommercialStats() {
  const groupedByCommercial = new Map();
  const periods = getPeriodStarts();
  const followUpsByCommercial = new Map();
  const weeklyFollowUpsByCommercial = new Map();

  for (const followUp of followUpsTodayCache) {
    const commercialName = String(followUp.commercial_name || '').trim() || 'Sem comercial atribuído';
    const currentTotal = followUpsByCommercial.get(commercialName) || 0;
    followUpsByCommercial.set(commercialName, currentTotal + 1);
  }

  for (const followUp of followUpsWeekCache) {
    const commercialName = String(followUp.commercial_name || '').trim() || 'Sem comercial atribuído';
    const currentTotal = weeklyFollowUpsByCommercial.get(commercialName) || 0;
    weeklyFollowUpsByCommercial.set(commercialName, currentTotal + 1);
  }

  for (const client of clientsCache) {
    const commercialName = String(client.commercial_name || '').trim() || 'Sem comercial atribuído';
    const clientDate = client.created_at ? new Date(client.created_at) : null;

    if (!groupedByCommercial.has(commercialName)) {
      groupedByCommercial.set(commercialName, {
        week: 0,
        month: 0,
        year: 0,
        followups: 0,
        weeklyFollowups: 0,
        acquisitions: 0,
        visits: 0,
      });
    }

    const totals = groupedByCommercial.get(commercialName);
    totals.followups = followUpsByCommercial.get(commercialName) || 0;
    totals.weeklyFollowups = weeklyFollowUpsByCommercial.get(commercialName) || 0;
    const outcomeStats = outcomesStatsByCommercialCache.get(commercialName) || { acquisitions: 0, visits: 0 };
    totals.acquisitions = outcomeStats.acquisitions;
    totals.visits = outcomeStats.visits;

    if (!clientDate || Number.isNaN(clientDate.getTime())) {
      continue;
    }

    if (clientDate >= periods.startOfYear) totals.year += 1;
    if (clientDate >= periods.startOfMonth) totals.month += 1;
    if (clientDate >= periods.startOfWeek) totals.week += 1;
  }

  for (const [commercialName, followUpTotal] of followUpsByCommercial.entries()) {
    if (!groupedByCommercial.has(commercialName)) {
      groupedByCommercial.set(commercialName, {
        week: 0,
        month: 0,
        year: 0,
        followups: followUpTotal,
        weeklyFollowups: weeklyFollowUpsByCommercial.get(commercialName) || 0,
        acquisitions: (outcomesStatsByCommercialCache.get(commercialName) || { acquisitions: 0 }).acquisitions,
        visits: (outcomesStatsByCommercialCache.get(commercialName) || { visits: 0 }).visits,
      });
    }
  }

  for (const [commercialName, weeklyFollowUpTotal] of weeklyFollowUpsByCommercial.entries()) {
    if (!groupedByCommercial.has(commercialName)) {
      groupedByCommercial.set(commercialName, {
        week: 0,
        month: 0,
        year: 0,
        followups: 0,
        weeklyFollowups: weeklyFollowUpTotal,
        acquisitions: (outcomesStatsByCommercialCache.get(commercialName) || { acquisitions: 0 }).acquisitions,
        visits: (outcomesStatsByCommercialCache.get(commercialName) || { visits: 0 }).visits,
      });
    }
  }

  for (const [commercialName, outcomeStats] of outcomesStatsByCommercialCache.entries()) {
    if (!groupedByCommercial.has(commercialName)) {
      groupedByCommercial.set(commercialName, {
        week: 0,
        month: 0,
        year: 0,
        followups: 0,
        weeklyFollowups: 0,
        acquisitions: Number(outcomeStats.acquisitions || 0),
        visits: Number(outcomeStats.visits || 0),
      });
      continue;
    }

    const totals = groupedByCommercial.get(commercialName);
    totals.acquisitions = Number(outcomeStats.acquisitions || 0);
    totals.visits = Number(outcomeStats.visits || 0);
  }

  const sortedCommercials = [...groupedByCommercial.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-PT'));

  if (sortedCommercials.length === 0) {
    commercialStats.innerHTML = '<p>Sem dados para apresentar estatísticas por comercial.</p>';
    return;
  }

  commercialStats.innerHTML = `
    <div class="stats-table-wrap">
      <table class="stats-table">
        <thead>
          <tr>
            <th>Comercial</th>
            <th>Semana</th>
            <th>Mês</th>
            <th>Ano</th>
            <th>Follow-ups Hoje</th>
            <th>Follow-ups Semana</th>
            <th>Angariações</th>
            <th>Visitas Marcadas</th>
          </tr>
        </thead>
        <tbody>
          ${sortedCommercials
            .map(
              ([name, totals]) => `
                <tr>
                  <td>${name}</td>
                  <td>${totals.week}</td>
                  <td>${totals.month}</td>
                  <td>${totals.year}</td>
                  <td>${totals.followups}</td>
                  <td>${totals.weeklyFollowups}</td>
                  <td>${totals.acquisitions}</td>
                  <td>${totals.visits}</td>
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function resetClientForm() {
  clientForm.reset();
  clientEditId.value = '';
  clientSubmitBtn.textContent = 'Adicionar Cliente';
  clientCancelEdit.classList.add('hidden');
  applyRoleUi();
}

function startClientEdit(client) {
  clientEditId.value = String(client.id);
  clientName.value = client.name || '';
  if (isCommercial()) {
    clientCommercialName.value = String(currentUser.full_name || currentUser.username || '').trim();
  } else {
    clientCommercialName.value = client.commercial_name || '';
  }
  clientIsSeller.checked = Boolean(client.is_seller);
  clientIsBuyer.checked = Boolean(client.is_buyer);
  clientPhone.value = client.phone || '';
  clientAddress.value = client.address || '';
  clientProperty.value = client.property || '';
  clientNotes.value = client.notes || '';

  clientSubmitBtn.textContent = 'Guardar Alterações';
  clientCancelEdit.classList.remove('hidden');
}

function roleMatches(client, roleFilter) {
  if (roleFilter === 'seller') return Boolean(client.is_seller);
  if (roleFilter === 'buyer') return Boolean(client.is_buyer);
  if (roleFilter === 'both') return Boolean(client.is_seller && client.is_buyer);
  return true;
}

async function loadContacts(clientId, clientNameText) {
  contactClientId.value = String(clientId);
  contactsModalTitle.textContent = `Histórico de Contactos - ${clientNameText}`;
  contactsList.innerHTML = '<p>A carregar contactos...</p>';

  let contacts = [];
  try {
    contacts = await api(`/api/clients/${clientId}/contacts`);
    setCachedContacts(clientId, contacts || []);
  } catch (error) {
    if (!isOfflineError(error)) {
      throw error;
    }

    contacts = getCachedContacts(clientId);
  }

  if (!contacts || contacts.length === 0) {
    contactsList.innerHTML = '<p>Sem contactos registados.</p>';
    return;
  }

  contactsList.innerHTML = contacts
    .map(
      (contact) => `
        <div class="list-item">
          <small>Data: ${formatDate(contact.contact_date)}</small>
          <small>Canal: ${contact.channel || '-'}</small>
          <small>Resumo: ${contact.summary || '-'}</small>
          <small>Próximo passo: ${contact.next_step || '-'}</small>
        </div>
      `
    )
    .join('');
}

function setContactsModalVisibility(isVisible) {
  contactsModal.classList.toggle('hidden', !isVisible);
}

function renderClients() {
  const search = String(clientSearch.value || '').trim().toLowerCase();
  const roleFilter = clientTypeFilter.value;

  const filtered = clientsCache.filter((client) => {
    if (!roleMatches(client, roleFilter)) {
      return false;
    }

    if (!search) return true;

    const haystack = [
      client.name,
      client.commercial_name,
      client.phone,
      client.address,
      client.property,
      client.notes,
      roleLabel(client),
    ]
      .map((value) => String(value || '').toLowerCase())
      .join(' ');

    return haystack.includes(search);
  });

  if (filtered.length === 0) {
    clientsList.innerHTML = '<p>Sem clientes encontrados.</p>';
    return;
  }

  clientsList.innerHTML = filtered
    .map(
      (client) => `
        <div class="list-item">
          <strong>${client.name}</strong>
          <small>Comercial: ${client.commercial_name || '-'}</small>
          <small>Tipo: ${roleLabel(client)}</small>
          <small>Telemóvel: ${client.phone || '-'}</small>
          <small>Morada: ${client.address || '-'}</small>
          <small>Imóvel: ${client.property || '-'}</small>
          <small>Observações: ${client.notes || '-'}</small>
          <div class="item-actions">
            <button type="button" class="secondary contacts-client" data-id="${client.id}">Contactos</button>
            <button type="button" class="secondary edit-client" data-id="${client.id}">Editar</button>
            <button type="button" class="danger delete-client" data-id="${client.id}">Eliminar</button>
          </div>
        </div>
      `
    )
    .join('');

  document.querySelectorAll('.contacts-client').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const clientId = Number(button.dataset.id);
        const client = clientsCache.find((item) => item.id === clientId);
        if (!client) return;

        setContactsModalVisibility(true);
        await loadContacts(clientId, client.name);
      } catch (error) {
        alert(error.message);
      }
    });
  });

  document.querySelectorAll('.edit-client').forEach((button) => {
    button.addEventListener('click', () => {
      const clientId = Number(button.dataset.id);
      const client = clientsCache.find((item) => item.id === clientId);
      if (client) {
        startClientEdit(client);
      }
    });
  });

  document.querySelectorAll('.delete-client').forEach((button) => {
    button.addEventListener('click', async () => {
      const clientId = Number(button.dataset.id);
      if (!clientId) return;

      const confirmation = window.confirm('Tem a certeza que pretende eliminar este cliente?');
      if (!confirmation) return;

      try {
        await api(`/api/clients/${clientId}`, { method: 'DELETE' });
        await refreshAll();
      } catch (error) {
        if (isOfflineError(error)) {
          removeClientFromCache(clientId);
          queueAction({ type: 'deleteClient', clientId });
          saveOfflineSnapshot();
          renderClients();
          renderCommercialStats();
          alert('Sem ligação. Eliminação guardada para sincronizar automaticamente quando voltares online.');
          return;
        }

        alert(error.message);
      }
    });
  });
}

function renderSyncStatus() {
  if (isLocalOfflineMode()) {
    syncStatusText.textContent = 'Modo local ativo. Liga o servidor e entra com a tua conta para sincronizar os dados.';
    runSyncBtn.disabled = true;
    return;
  }

  if (!syncStatus) {
    syncStatusText.textContent = 'Sem dados de sincronização.';
    runSyncBtn.disabled = true;
    return;
  }

  if (!syncStatus.configured) {
    syncStatusText.textContent = 'Sincronização remota não configurada neste nó. Defina SYNC_UPSTREAM_URL e SYNC_SHARED_KEY.';
    runSyncBtn.disabled = true;
    return;
  }

  const pending = Number(syncStatus.pending_changes || 0);
  syncStatusText.textContent = `Nó: ${syncStatus.node_id} | Última sync: ${formatSyncDate(syncStatus.last_sync_at)} | Pendentes locais: ${pending}`;
  runSyncBtn.disabled = false;
}

async function loadSyncStatus() {
  if (!navigator.onLine || isLocalOfflineMode()) {
    if (isLocalOfflineMode()) {
      syncStatusText.textContent = 'Modo local ativo. Liga o servidor e entra com a tua conta para sincronizar.';
      runSyncBtn.disabled = true;
    }
    renderSyncStatus();
    return;
  }

  syncStatus = await api('/api/sync/status');
  renderSyncStatus();
}

async function runSyncNow() {
  if (!navigator.onLine || isLocalOfflineMode()) {
    alert('Sem ligação neste momento. A sincronização será feita quando voltares online.');
    return;
  }

  if (!syncStatus || !syncStatus.configured) {
    return;
  }

  runSyncBtn.disabled = true;
  syncStatusText.textContent = 'Sincronização em curso...';

  try {
    const result = await api('/api/sync/run', { method: 'POST' });
    alert(
      `Sincronização concluída. Enviados: ${result.pushed.clients} clientes e ${result.pushed.contacts} contactos. Recebidos: ${result.pulled.clients} clientes e ${result.pulled.contacts} contactos.`
    );
    await refreshAll();
  } catch (error) {
    alert(error.message);
    await loadSyncStatus();
  }
}

async function loadDashboard() {
  const data = await api('/api/dashboard/summary');

  dashboard.innerHTML = `
    <div class="metric"><span>Total de clientes</span><strong>${data.total_clients}</strong></div>
    <div class="metric"><span>Vendedores</span><strong>${data.total_sellers}</strong></div>
    <div class="metric"><span>Compradores</span><strong>${data.total_buyers}</strong></div>
    <div class="metric"><span>Vendedor e Comprador</span><strong>${data.total_both}</strong></div>
  `;
}

function renderCommercialUsers() {
  if (!isAdmin()) {
    commercialUsersList.innerHTML = '';
    return;
  }

  if (!commercialUsersCache.length) {
    commercialUsersList.innerHTML = '<p>Sem contas de comerciais criadas.</p>';
    return;
  }

  commercialUsersList.innerHTML = commercialUsersCache
    .map(
      (user) => `
        <div class="list-item">
          <strong>${user.full_name || user.username}</strong>
          <small>Utilizador: ${user.username}</small>
          <div class="item-actions">
            <button type="button" class="danger remove-commercial-user" data-id="${user.id}">Remover</button>
          </div>
        </div>
      `
    )
    .join('');

  document.querySelectorAll('.remove-commercial-user').forEach((button) => {
    button.addEventListener('click', async () => {
      const userId = Number(button.dataset.id);
      if (!userId) return;

      const confirmation = window.confirm('Tem a certeza que pretende remover esta conta de comercial?');
      if (!confirmation) return;

      try {
        await api(`/api/users/commercials/${userId}`, { method: 'DELETE' });
        await loadCommercialUsers();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function renderGoalsAdmin() {
  if (!isAdmin()) {
    goalCommercialUser.innerHTML = '<option value="">Selecione um comercial</option>';
    goalsList.innerHTML = '';
    return;
  }

  goalCommercialUser.innerHTML = [
    '<option value="">Selecione um comercial</option>',
    ...commercialGoalsCache.map(
      (row) =>
        `<option value="${row.id}">${row.full_name || row.username}</option>`
    ),
  ].join('');

  if (!commercialGoalsCache.length) {
    goalsList.innerHTML = '<p>Sem comerciais para definir objetivos.</p>';
    return;
  }

  goalsList.innerHTML = `
    <div class="stats-table-wrap">
      <table class="stats-table">
        <thead>
          <tr>
            <th>Comercial</th>
            <th>Meta Semana</th>
            <th>Atingido Semana</th>
            <th>Meta Mês</th>
            <th>Atingido Mês</th>
            <th>Ação</th>
          </tr>
        </thead>
        <tbody>
          ${commercialGoalsCache
            .map(
              (row) => `
                <tr>
                  <td>${row.full_name || row.username}</td>
                  <td>${Number(row.weekly_goal || 0)}</td>
                  <td>${Number(row.achieved_week || 0)}</td>
                  <td>${Number(row.monthly_goal || 0)}</td>
                  <td>${Number(row.achieved_month || 0)}</td>
                  <td>
                    <button type="button" class="secondary fill-goal-form" data-id="${row.id}">Editar</button>
                  </td>
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;

  document.querySelectorAll('.fill-goal-form').forEach((button) => {
    button.addEventListener('click', () => {
      const userId = Number(button.dataset.id);
      const selected = commercialGoalsCache.find((item) => item.id === userId);
      if (!selected) return;

      goalCommercialUser.value = String(selected.id);
      goalWeekly.value = String(Number(selected.weekly_goal || 0));
      goalMonthly.value = String(Number(selected.monthly_goal || 0));
    });
  });
}

function formatGoalDateLabel(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('pt-PT');
}

function setGoalAlertModalVisibility(isVisible) {
  goalAlertModal.classList.toggle('hidden', !isVisible);
}

function showGoalAlerts(messages) {
  if (!messages || messages.length === 0) return;

  goalAlertContent.innerHTML = `
    <div class="grid">
      ${messages.map((message) => `<p>${message}</p>`).join('')}
    </div>
  `;
  setGoalAlertModalVisibility(true);
}

function setFollowUpReminderModalVisibility(isVisible) {
  followUpReminderModal.classList.toggle('hidden', !isVisible);
}

function buildFollowUpActions(item) {
  const actions = [];

  if (item.is_seller) {
    actions.push(
      `<button type="button" class="secondary register-followup-outcome" data-client-id="${item.client_id}" data-outcome-type="acquisition">Angariação</button>`
    );
  }

  if (item.is_buyer) {
    actions.push(
      `<button type="button" class="secondary register-followup-outcome" data-client-id="${item.client_id}" data-outcome-type="visit">Marcação de visita</button>`
    );
  }

  if (actions.length === 0) {
    return '-';
  }

  return `<div class="followup-actions">${actions.join('')}</div>`;
}

async function registerFollowUpOutcome(clientId, outcomeType, buttonElement) {
  try {
    buttonElement.disabled = true;
    await api(`/api/clients/${clientId}/followup-outcomes`, {
      method: 'POST',
      body: JSON.stringify({ outcome_type: outcomeType }),
    });

    const successMessage = outcomeType === 'acquisition' ? 'Angariação registada com sucesso.' : 'Marcação de visita registada com sucesso.';
    alert(successMessage);
    await refreshAll();
  } catch (error) {
    alert(error.message);
  } finally {
    buttonElement.disabled = false;
  }
}

function renderFollowUpList(items) {
  if (!items || items.length === 0) {
    followUpList.innerHTML = '<p>Sem follow-ups pendentes para hoje.</p>';
    return;
  }

  followUpList.innerHTML = `
    <div class="stats-table-wrap">
      <table class="stats-table">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Etapa</th>
            <th>Data prevista</th>
            <th>Atraso</th>
            <th>Situação</th>
            <th>Último contacto</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (item) => `
                <tr>
                  <td>${item.client_name}</td>
                  <td>${item.follow_up_stage}</td>
                  <td>${formatShortDate(item.follow_up_due_date)}</td>
                  <td>${item.days_overdue > 0 ? `${item.days_overdue} dia(s)` : 'Hoje'}</td>
                  <td>${item.situation || '-'}</td>
                  <td>${formatDate(item.last_contact_date)}</td>
                  <td>${buildFollowUpActions(item)}</td>
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;

  document.querySelectorAll('.register-followup-outcome').forEach((button) => {
    button.addEventListener('click', async () => {
      const clientId = Number(button.dataset.clientId);
      const outcomeType = String(button.dataset.outcomeType || '');

      if (!clientId || !outcomeType) {
        return;
      }

      await registerFollowUpOutcome(clientId, outcomeType, button);
    });
  });
}

function maybeShowDailyFollowUpReminder(items) {
  if (!items || items.length === 0 || !currentUser) {
    return;
  }

  const todayKey = new Date().toISOString().slice(0, 10);
  const storageKey = `follow-up-reminder:${currentUser.id}:${todayKey}`;
  if (localStorage.getItem(storageKey)) {
    return;
  }

  const previewItems = items.slice(0, 8);
  followUpReminderContent.innerHTML = `
    <p><strong>${items.length}</strong> contacto(s) pendente(s) para follow-up hoje.</p>
    <div class="spaced-list">
      ${previewItems
        .map(
          (item) => `
            <div class="list-item">
              <strong>${item.client_name}</strong>
              <small>Etapa: ${item.follow_up_stage}</small>
              <small>Situação: ${item.situation || '-'}</small>
              <small>Data prevista: ${formatShortDate(item.follow_up_due_date)}</small>
            </div>
          `
        )
        .join('')}
    </div>
  `;

  localStorage.setItem(storageKey, '1');
  setFollowUpReminderModalVisibility(true);
}

async function loadFollowUpsToday() {
  const data = await api('/api/followups/today');
  followUpsTodayCache = (data && data.items) || [];
  followUpsWeekCache = (data && data.weekly_items) || [];
  renderFollowUpList(followUpsTodayCache);
  renderCommercialStats();
  maybeShowDailyFollowUpReminder(followUpsTodayCache);
}

async function loadOutcomesCommercialStats() {
  const rows = await api('/api/stats/outcomes/commercials');
  outcomesStatsByCommercialCache = new Map(
    (rows || []).map((row) => [String(row.commercial_name || '').trim() || 'Sem comercial atribuído', {
      acquisitions: Number(row.acquisitions || 0),
      visits: Number(row.visits || 0),
    }])
  );
  renderCommercialStats();
}

function getGoalKey(prefix, period, goalValue) {
  return `goal:${prefix}:${currentUser.id}:${period}:${goalValue}`;
}

function maybeShowGoalPopups() {
  if (!isCommercial() || !myGoalStatus) {
    return;
  }

  const messages = [];

  const weeklyGoal = Number(myGoalStatus.weekly_goal || 0);
  const monthlyGoal = Number(myGoalStatus.monthly_goal || 0);
  const weekReached = Boolean(myGoalStatus.reached_weekly_goal);
  const monthReached = Boolean(myGoalStatus.reached_monthly_goal);

  if (weeklyGoal > 0 && weekReached) {
    const key = getGoalKey('hit-week', myGoalStatus.week_start, weeklyGoal);
    if (!localStorage.getItem(key)) {
      messages.push(`Parabéns! Já atingiste a meta semanal (${weeklyGoal}) com ${myGoalStatus.achieved_week} clientes.`);
      localStorage.setItem(key, '1');
    }
  }

  if (monthlyGoal > 0 && monthReached) {
    const key = getGoalKey('hit-month', myGoalStatus.month_start, monthlyGoal);
    if (!localStorage.getItem(key)) {
      messages.push(`Excelente! Já atingiste a meta mensal (${monthlyGoal}) com ${myGoalStatus.achieved_month} clientes.`);
      localStorage.setItem(key, '1');
    }
  }

  if (weeklyGoal > 0 && !weekReached && myGoalStatus.is_end_of_week) {
    const key = getGoalKey('reminder-week', myGoalStatus.week_start, weeklyGoal);
    if (!localStorage.getItem(key)) {
      messages.push(
        `Lembrete de fim de semana (${formatGoalDateLabel(myGoalStatus.week_end)}): meta semanal não atingida. Faltam ${weeklyGoal - myGoalStatus.achieved_week} clientes.`
      );
      localStorage.setItem(key, '1');
    }
  }

  if (monthlyGoal > 0 && !monthReached && myGoalStatus.is_end_of_month) {
    const key = getGoalKey('reminder-month', myGoalStatus.month_start, monthlyGoal);
    if (!localStorage.getItem(key)) {
      messages.push(
        `Lembrete de fim de mês (${formatGoalDateLabel(myGoalStatus.month_end)}): meta mensal não atingida. Faltam ${monthlyGoal - myGoalStatus.achieved_month} clientes.`
      );
      localStorage.setItem(key, '1');
    }
  }

  showGoalAlerts(messages);
}

async function loadGoalsAdmin() {
  if (!isAdmin() || isLocalOfflineMode()) {
    commercialGoalsCache = [];
    renderGoalsAdmin();
    return;
  }

  commercialGoalsCache = await api('/api/goals/commercials');
  renderGoalsAdmin();
}

async function loadMyGoalStatus() {
  if (!isCommercial() || isLocalOfflineMode()) {
    myGoalStatus = null;
    return;
  }

  myGoalStatus = await api('/api/goals/me');
  maybeShowGoalPopups();
}

async function loadCommercialUsers() {
  if (!isAdmin() || isLocalOfflineMode()) {
    commercialUsersCache = [];
    renderCommercialUsers();
    return;
  }

  commercialUsersCache = await api('/api/users/commercials');
  renderCommercialUsers();
}

async function loadClients() {
  if (isLocalOfflineMode()) {
    renderClients();
    renderCommercialStats();
    return;
  }

  clientsCache = await api('/api/clients');
  renderClients();
  renderCommercialStats();
}

async function refreshAll() {
  if (!authToken) {
    return;
  }

  if (!navigator.onLine || isLocalOfflineMode()) {
    loadOfflineSnapshot();
    if (isLocalOfflineMode()) {
      renderSyncStatus();
    }
    updateOfflinePanel();
    return;
  }

  try {
    await Promise.all([
      loadDashboard(),
      loadSyncStatus(),
      loadClients(),
      loadOutcomesCommercialStats(),
      loadCommercialUsers(),
      loadGoalsAdmin(),
      loadMyGoalStatus(),
      loadFollowUpsToday(),
    ]);

    saveOfflineSnapshot();
    updateOfflinePanel();
  } catch (error) {
    if (isOfflineError(error)) {
      loadOfflineSnapshot();
      updateOfflinePanel();
    } else {
      throw error;
    }
  }
}

async function openMainApp() {
  loginSection.classList.add('hidden');
  mainSection.classList.remove('hidden');
  applyRoleUi();
  await refreshAll();
}

async function bootstrapSession() {
  loadQueue();
  if (!restoreSessionFromStorage()) {
    updateOfflinePanel();
    return;
  }

  try {
    await openMainApp();
  } catch (error) {
    if (isOfflineError(error)) {
      loadOfflineSnapshot();
      updateOfflinePanel();
    } else {
      throw error;
    }
  }
}

document.getElementById('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  try {
    const result = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    authToken = result.token;
    currentUser = result.user || null;
    if (pendingActionsQueue.length > 0) {
      await flushPendingActionsQueue();
    }
    saveSessionLocally();
    await openMainApp();
  } catch (error) {
    if (isOfflineError(error) && restoreSessionFromStorage()) {
      await openMainApp();
      alert('Entraste em modo offline com a sessão guardada neste dispositivo.');
      return;
    }

    if (isOfflineError(error)) {
      enterLocalOfflineMode();
      await openMainApp();
      alert('Servidor indisponível. Entraste em modo local: podes trabalhar offline e sincronizar quando o servidor voltar.');
      return;
    }

    alert(error.message);
  }
});

if (enterLocalModeBtn) {
  enterLocalModeBtn.addEventListener('click', async () => {
    enterLocalOfflineMode();
    await openMainApp();
    alert('Modo local iniciado. Quando o servidor voltar, entra com a tua conta para sincronizar os dados.');
  });
}

clientForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    name: clientName.value,
    commercial_name: clientCommercialName.value,
    is_seller: clientIsSeller.checked,
    is_buyer: clientIsBuyer.checked,
    phone: clientPhone.value,
    address: clientAddress.value,
    property: clientProperty.value,
    notes: clientNotes.value,
  };

  if (!payload.is_seller && !payload.is_buyer) {
    alert('Selecione pelo menos vendedor ou comprador.');
    return;
  }

  const editId = clientEditId.value;

  if (isLocalOfflineMode()) {
    if (editId) {
      const existing = clientsCache.find((row) => Number(row.id) === Number(editId));
      if (!existing) {
        alert('Cliente não encontrado para edição offline.');
        return;
      }

      upsertClientInCache({
        ...existing,
        ...payload,
        id: Number(editId),
        updated_at: new Date().toISOString(),
      });
      queueAction({
        type: 'updateClient',
        clientId: Number(editId),
        payload,
      });
    } else {
      const localId = nextLocalId();
      const localClient = {
        id: localId,
        ...payload,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      upsertClientInCache(localClient);
      queueAction({
        type: 'createClient',
        clientId: localId,
        payload,
      });
    }

    saveOfflineSnapshot();
    resetClientForm();
    renderClients();
    renderDashboardFromClients();
    renderCommercialStats();
    alert('Modo local: alteração guardada para sincronizar mais tarde.');
    return;
  }

  try {
    if (editId) {
      await api(`/api/clients/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/api/clients', { method: 'POST', body: JSON.stringify(payload) });
    }

    resetClientForm();
    await refreshAll();
  } catch (error) {
    if (error.message === 'Cliente já existe!') {
      alert('Cliente já existe!');
      return;
    }

    if (isOfflineError(error)) {
      if (editId) {
        const existing = clientsCache.find((row) => Number(row.id) === Number(editId));
        if (!existing) {
          alert('Cliente não encontrado para edição offline.');
          return;
        }

        upsertClientInCache({
          ...existing,
          ...payload,
          id: Number(editId),
          updated_at: new Date().toISOString(),
        });
        queueAction({
          type: 'updateClient',
          clientId: Number(editId),
          payload,
        });
      } else {
        const localId = nextLocalId();
        const localClient = {
          id: localId,
          ...payload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        upsertClientInCache(localClient);
        queueAction({
          type: 'createClient',
          clientId: localId,
          payload,
        });
      }

      saveOfflineSnapshot();
      resetClientForm();
      renderClients();
      renderDashboardFromClients();
      renderCommercialStats();
      alert('Sem ligação. Alteração guardada e será sincronizada quando voltares online.');
      return;
    }

    alert(error.message);
  }
});

contactForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const clientId = Number(contactClientId.value);
  if (!clientId) {
    alert('Cliente inválido para registo de contacto.');
    return;
  }

  const payload = {
    channel: contactChannel.value,
    summary: contactSummary.value,
    next_step: contactNextStep.value,
    contact_date: contactDate.value ? new Date(contactDate.value).toISOString() : null,
  };

  if (isLocalOfflineMode()) {
    addCachedContact(clientId, payload);
    queueAction({
      type: 'createContact',
      clientId,
      payload,
    });
    saveOfflineSnapshot();
    alert('Contacto guardado no modo local. Será sincronizado quando ligares o servidor e entrares com a tua conta.');

    contactForm.reset();
    const client = clientsCache.find((item) => item.id === clientId);
    await loadContacts(clientId, client ? client.name : 'Cliente');
    return;
  }

  try {
    await api(`/api/clients/${clientId}/contacts`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (!isOfflineError(error)) {
      alert(error.message);
      return;
    }

    addCachedContact(clientId, payload);
    queueAction({
      type: 'createContact',
      clientId,
      payload,
    });
    saveOfflineSnapshot();
    alert('Contacto guardado offline. Será sincronizado quando houver ligação.');
  }

  contactForm.reset();
  const client = clientsCache.find((item) => item.id === clientId);
  await loadContacts(clientId, client ? client.name : 'Cliente');
});

clientCancelEdit.addEventListener('click', () => {
  resetClientForm();
});

clientSearch.addEventListener('input', () => {
  renderClients();
});

clientTypeFilter.addEventListener('change', () => {
  renderClients();
});

exportClientsBtn.addEventListener('click', async () => {
  if (isLocalOfflineMode()) {
    alert('A exportação CSV só fica disponível depois de sincronizar com o servidor.');
    return;
  }

  const query = new URLSearchParams();
  if (clientTypeFilter.value && clientTypeFilter.value !== 'all') {
    query.set('role', clientTypeFilter.value);
  }

  const searchTerm = String(clientSearch.value || '').trim();
  if (searchTerm) {
    query.set('search', searchTerm);
  }

  const endpoint = query.toString() ? `/api/clients/export.csv?${query.toString()}` : '/api/clients/export.csv';
  try {
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: 'Falha ao exportar CSV' }));
      throw new Error(err.message || 'Falha ao exportar CSV');
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = 'clientes-imobiliario.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    alert(error.message);
  }
});

closeContactsModal.addEventListener('click', () => {
  setContactsModalVisibility(false);
});

contactsModal.addEventListener('click', (event) => {
  if (event.target === contactsModal) {
    setContactsModalVisibility(false);
  }
});

commercialUserForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (isLocalOfflineMode()) {
    alert('Esta área só está disponível quando estiveres ligado ao servidor.');
    return;
  }

  try {
    await api('/api/users/commercials', {
      method: 'POST',
      body: JSON.stringify({
        full_name: commercialUserFullName.value,
        username: commercialUserUsername.value,
        password: commercialUserPassword.value,
      }),
    });

    commercialUserForm.reset();
    await loadCommercialUsers();
    alert('Conta de comercial criada com sucesso.');
  } catch (error) {
    alert(error.message);
  }
});

goalForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (isLocalOfflineMode()) {
    alert('Esta área só está disponível quando estiveres ligado ao servidor.');
    return;
  }

  const userId = Number(goalCommercialUser.value);
  const weeklyGoalValue = Number(goalWeekly.value);
  const monthlyGoalValue = Number(goalMonthly.value);

  if (!userId) {
    alert('Selecione um comercial.');
    return;
  }

  if (!Number.isFinite(weeklyGoalValue) || weeklyGoalValue < 0 || !Number.isFinite(monthlyGoalValue) || monthlyGoalValue < 0) {
    alert('As metas devem ser números iguais ou superiores a zero.');
    return;
  }

  try {
    await api(`/api/goals/commercials/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({
        weekly_goal: Math.floor(weeklyGoalValue),
        monthly_goal: Math.floor(monthlyGoalValue),
      }),
    });

    await loadGoalsAdmin();
    alert('Objetivos guardados com sucesso.');
  } catch (error) {
    alert(error.message);
  }
});

closeGoalAlertModal.addEventListener('click', () => {
  setGoalAlertModalVisibility(false);
});

goalAlertModal.addEventListener('click', (event) => {
  if (event.target === goalAlertModal) {
    setGoalAlertModalVisibility(false);
  }
});

closeFollowUpReminderModal.addEventListener('click', () => {
  setFollowUpReminderModalVisibility(false);
});

followUpReminderModal.addEventListener('click', (event) => {
  if (event.target === followUpReminderModal) {
    setFollowUpReminderModalVisibility(false);
  }
});

runSyncBtn.addEventListener('click', async () => {
  await flushPendingActionsQueue();
  await runSyncNow();
});

if (offlineSyncBtn) {
  offlineSyncBtn.addEventListener('click', async () => {
    await flushPendingActionsQueue();
  });
}

if (installAppBtn) {
  installAppBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      if (installStatusText) {
        installStatusText.textContent = 'A instalação automática não está disponível neste momento. Usa o menu do navegador para instalar esta app.';
      }
      return;
    }

    try {
      deferredInstallPrompt.prompt();
      const choiceResult = await deferredInstallPrompt.userChoice;

      if (installStatusText) {
        installStatusText.textContent =
          choiceResult && choiceResult.outcome === 'accepted'
            ? 'App instalada com sucesso. Agora podes abrir pelo ecrã inicial.'
            : 'Instalação cancelada. Podes voltar a tentar quando quiseres.';
      }
    } finally {
      deferredInstallPrompt = null;
      installAppBtn.disabled = true;
    }
  });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  refreshInstallPanel();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;

  if (installPanel && installStatusText) {
    installStatusText.textContent = 'App instalada com sucesso no dispositivo.';
    installPanel.classList.remove('hidden');
  }
  if (installAppBtn) installAppBtn.disabled = true;
});

window.addEventListener('load', () => {
  refreshInstallPanel();
  updateOfflinePanel();
  tryAutoSyncOnReconnect();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refreshInstallPanel();
    updateOfflinePanel();
    tryAutoSyncOnReconnect();
  }
});

window.addEventListener('online', async () => {
  updateOfflinePanel();
  await tryAutoSyncOnReconnect();
});

window.addEventListener('offline', () => {
  updateOfflinePanel();
});

bootstrapSession();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (error) {
      console.error('Falha ao registar service worker:', error);
    }
  });
}
