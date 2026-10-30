const SETTINGS_KEY = 'devicelink-irrigation-settings';
const MODE_KEY = 'devicelink-preview-mode';
const EVENTS_KEY = 'devicelink-dashboard-events';
const EVENT_LIMIT = 8;
const RECORD_LIMIT = 5;
const POLL_INTERVAL_MS = 5000;

const lastUpdated = document.getElementById('last-updated');
const eventList = document.getElementById('event-list');
const modeExplanation = document.getElementById('mode-explanation');
let polling = false;
let connectionState = null;
let previousFaultSignature = null;
let latestPayload = null;
let latestContentType = '';
let dashboardSettings = { soilThreshold: 35, tankThreshold: 25, runTime: 10 };
let settingsSaved = false;
let settingsStatusKey = 'Settings stay in this browser only.';
const t = (message, variables) => window.t(message, variables);

function readLocalValue(key, fallback) {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch (error) {
    console.error(`Could not read local setting "${key}":`, error);
    window.showNotification(t('Local browser storage is unavailable. Changes may not persist.'), 'warning');
    return fallback;
  }
}

function writeLocalValue(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Could not save local setting "${key}":`, error);
    window.showNotification(t('Could not save this setting in browser storage.'), 'error');
    return false;
  }
}

function readEvents() {
  const events = readLocalValue(EVENTS_KEY, []);
  return Array.isArray(events) ? events : [];
}

function renderEvents() {
  const events = readEvents();
  eventList.replaceChildren();

  if (events.length === 0) {
    const emptyState = document.createElement('li');
    emptyState.className = 'event-empty';
    emptyState.textContent = t('No local events yet.');
    eventList.append(emptyState);
    return;
  }

  for (const event of events.slice(0, EVENT_LIMIT)) {
    const item = document.createElement('li');
    item.className = 'event-item';

    const dot = document.createElement('span');
    dot.className = 'event-dot';
    dot.setAttribute('aria-hidden', 'true');

    const content = document.createElement('div');
    const message = document.createElement('strong');
    const variables = { ...event.variables };
    if (variables.faults) {
      variables.faults = String(variables.faults)
        .split(', ')
        .map((fault) => window.translateDeviceValue(fault))
        .join(', ');
    }
    message.textContent = t(event.message, variables);

    const timestamp = document.createElement('time');
    timestamp.dateTime = event.at;
    timestamp.textContent = new Date(event.at).toLocaleString(window.getCurrentLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      hourCycle: 'h23'
    });
    content.append(message, timestamp);
    item.append(dot, content);
    eventList.append(item);
  }
}

function addEvent(message, variables = {}) {
  const events = readEvents();
  events.unshift({ message, variables, at: new Date().toISOString() });
  if (writeLocalValue(EVENTS_KEY, events.slice(0, EVENT_LIMIT))) {
    renderEvents();
  }
}

function normalizedText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function percentage(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

function updateMetricBadge(elementId, label, isKnown) {
  const badge = document.getElementById(elementId);
  badge.textContent = t(label);
  badge.className = `metric-state ${isKnown ? 'state-live' : 'state-muted'}`;
}

function updateActionStatus(elementId, state) {
  const element = document.getElementById(elementId);
  const label = normalizedText(state);
  element.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'state-indicator';
  element.append(dot, document.createTextNode(label ? window.translateDeviceValue(label) : t('Status unavailable')));
  element.classList.toggle('is-running', Boolean(label && /running|active|on/i.test(label)));
  element.classList.toggle('is-stopped', Boolean(label && /stopped|idle|off/i.test(label)));
}

function updateAcknowledgement(elementId, acknowledgement) {
  const element = document.getElementById(elementId);
  const value = normalizedText(acknowledgement);
  element.replaceChildren();

  const indicator = document.createElement('span');
  indicator.textContent = value ? '✓' : '○';
  element.append(
    indicator,
    document.createTextNode(value ? window.translateDeviceValue(value) : t('Command acknowledgement unavailable'))
  );
}

function clearLiveTelemetry() {
  document.getElementById('tank-level').textContent = '—';
  document.getElementById('tank-meter').style.width = '0%';
  document.getElementById('tank-note').textContent = t('Waiting for device connection');
  updateMetricBadge('tank-badge', 'Awaiting data', false);
  document.getElementById('soil-state').textContent = t('Unknown');
  document.getElementById('soil-note').textContent = t('Waiting for device connection');
  updateMetricBadge('soil-badge', 'Awaiting data', false);
  document.getElementById('rain-state').textContent = t('Unknown');
  document.getElementById('rain-note').textContent = t('Waiting for device connection');
  updateMetricBadge('rain-badge', 'Awaiting data', false);
  document.getElementById('controller-state').textContent = t('Offline');
  document.getElementById('controller-note').textContent = t('Last device check failed');
  document.getElementById('controller-badge').textContent = t('Offline');
  document.getElementById('controller-badge').className = 'metric-state state-warn';
  updateActionStatus('irrigation-status', null);
  updateActionStatus('refill-status', null);
  updateAcknowledgement('irrigation-ack', null);
  updateAcknowledgement('refill-ack', null);
  updateFaults(undefined);
}

function clearSensorTelemetry(note) {
  document.getElementById('tank-level').textContent = '—';
  document.getElementById('tank-meter').style.width = '0%';
  document.getElementById('tank-note').textContent = t(note);
  updateMetricBadge('tank-badge', 'Awaiting data', false);
  document.getElementById('soil-state').textContent = t('Unknown');
  document.getElementById('soil-note').textContent = t(note);
  updateMetricBadge('soil-badge', 'Awaiting data', false);
  document.getElementById('rain-state').textContent = t('Unknown');
  document.getElementById('rain-note').textContent = t(note);
  updateMetricBadge('rain-badge', 'Awaiting data', false);
  updateActionStatus('irrigation-status', null);
  updateActionStatus('refill-status', null);
  updateAcknowledgement('irrigation-ack', null);
  updateAcknowledgement('refill-ack', null);
  updateFaults(undefined);
  document.getElementById('auto-mode').setAttribute('aria-pressed', 'false');
  document.getElementById('manual-mode').setAttribute('aria-pressed', 'false');
  modeExplanation.textContent = t('Controller mode unavailable in the device response.');
}

function updateFaults(faultValue) {
  const faultTitle = document.getElementById('fault-title');
  const faultDetail = document.getElementById('fault-detail');
  const faultCount = document.getElementById('fault-count');
  const faultIcon = document.getElementById('fault-icon');

  if (faultValue === undefined || faultValue === null) {
    faultCount.textContent = '—';
    faultTitle.textContent = t('Fault state unavailable');
    faultDetail.textContent = t('No recognized fault field in the device response.');
    faultIcon.classList.remove('has-fault');
    previousFaultSignature = null;
    return;
  }

  const faults = Array.isArray(faultValue)
    ? faultValue.map(normalizedText).filter(Boolean)
    : typeof faultValue === 'string' && faultValue.trim()
      ? faultValue.split(',').map((fault) => fault.trim()).filter(Boolean)
      : faultValue === false || faultValue === 0
        ? []
        : faultValue === true
            ? ['Fault reported']
          : null;

  if (!faults) {
    faultCount.textContent = '—';
    faultTitle.textContent = t('Fault data unrecognized');
    faultDetail.textContent = t('Expected a fault list or a true/false fault flag.');
    faultIcon.classList.remove('has-fault');
    previousFaultSignature = null;
    return;
  }

  const localizedFaults = faults.map((fault) => window.translateDeviceValue(fault));
  const signature = JSON.stringify(faults);
  faultCount.textContent = new Intl.NumberFormat(window.getCurrentLocale()).format(faults.length);
  faultIcon.classList.toggle('has-fault', faults.length > 0);
  faultTitle.textContent = faults.length > 0
    ? t(faults.length === 1 ? '{count} fault reported' : '{count} faults reported', { count: faults.length })
    : t('No faults reported');
  faultDetail.textContent = faults.length > 0 ? localizedFaults.join(' · ') : t('The controller reports normal operation.');

  if (faults.length > 0 && signature !== previousFaultSignature) {
    addEvent('Device fault reported: {faults}', { faults: faults.join(', ') });
    window.showNotification('Device fault: {faults}', 'error', { faults: faults.join(', ') });
  }
  previousFaultSignature = signature;
}

function updateTelemetry(payload, contentType) {
  if (!contentType.includes('application/json')) {
    document.getElementById('controller-note').textContent = t('Device responded; response is not JSON.');
    clearSensorTelemetry('No structured sensor data in device response');
    return;
  }

  let data;
  try {
    data = JSON.parse(payload);
  } catch (error) {
    console.warn('Device response is not valid JSON; sensor values remain unavailable.', error);
    document.getElementById('controller-note').textContent = t('Device responded; response is not valid JSON.');
    clearSensorTelemetry('No structured sensor data in device response');
    return;
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    document.getElementById('controller-note').textContent = t('Device responded; expected a JSON object.');
    clearSensorTelemetry('Expected a JSON object from the device');
    return;
  }

  const tankLevel = percentage(data.tank_percent);
  const tankElement = document.getElementById('tank-level');
  const tankMeter = document.getElementById('tank-meter');
  tankElement.textContent = tankLevel === null ? '—' : new Intl.NumberFormat(window.getCurrentLocale()).format(tankLevel);
  tankMeter.style.width = tankLevel === null ? '0%' : `${tankLevel}%`;
  document.getElementById('tank-note').textContent = tankLevel === null
    ? t('No tank_percent reading in device JSON')
    : t(tankLevel < dashboardSettings.tankThreshold ? 'Below local refill threshold' : 'Current tank level');
  updateMetricBadge('tank-badge', tankLevel === null ? 'Awaiting data' : 'Live data', tankLevel !== null);

  const soilMoisture = percentage(data.soil_moisture_percent);
  const soilState = normalizedText(data.soil_state)
    || (soilMoisture === null ? null : soilMoisture < dashboardSettings.soilThreshold ? 'Dry' : 'Moist');
  document.getElementById('soil-state').textContent = soilState ? window.translateDeviceValue(soilState) : t('Unknown');
  document.getElementById('soil-note').textContent = soilMoisture === null
    ? t('No soil reading in device JSON')
    : t('{value}% moisture', { value: new Intl.NumberFormat(window.getCurrentLocale()).format(soilMoisture) });
  updateMetricBadge('soil-badge', soilState ? 'Live data' : 'Awaiting data', Boolean(soilState));

  let rainState = normalizedText(data.rain_state);
  if (!rainState && typeof data.rain_detected === 'boolean') {
    rainState = data.rain_detected ? 'Rain detected' : 'No rain';
  }
  document.getElementById('rain-state').textContent = rainState ? window.translateDeviceValue(rainState) : t('Unknown');
  document.getElementById('rain-note').textContent = rainState
    ? t('Current rain sensor state')
    : t('No rain_state or rain_detected field in JSON');
  updateMetricBadge('rain-badge', rainState ? 'Live data' : 'Awaiting data', Boolean(rainState));

  const controllerState = normalizedText(data.controller_status) || 'Online';
  document.getElementById('controller-state').textContent = window.translateDeviceValue(controllerState);
  document.getElementById('controller-note').textContent = normalizedText(data.controller_status)
    ? t('Reported by the ESP32')
    : t('ESP32 responded to the local check');
  const controllerOnline = !/offline|error|fault|disconnected/i.test(controllerState);
  const controllerBadge = document.getElementById('controller-badge');
  controllerBadge.textContent = t(controllerOnline ? 'Connected' : 'Attention');
  controllerBadge.className = `metric-state ${controllerOnline ? 'state-live' : 'state-warn'}`;

  const controllerMode = normalizedText(data.mode);
  if (controllerMode) {
    const normalizedMode = controllerMode.toLowerCase();
    if (normalizedMode === 'automatic' || normalizedMode === 'auto') {
      applyMode('automatic');
    } else if (normalizedMode === 'manual') {
      applyMode('manual');
    }
    modeExplanation.textContent = t('Controller-reported mode: {mode}.', { mode: controllerMode });
  } else {
    document.getElementById('auto-mode').setAttribute('aria-pressed', 'false');
    document.getElementById('manual-mode').setAttribute('aria-pressed', 'false');
    modeExplanation.textContent = t('Controller mode not reported by the ESP32.');
  }

  updateActionStatus('irrigation-status', data.irrigation_status);
  updateActionStatus('refill-status', data.refill_status);
  updateAcknowledgement('irrigation-ack', data.irrigation_ack);
  updateAcknowledgement('refill-ack', data.refill_ack);
  updateFaults(data.faults);
}

function renderRecords(records) {
  const recordsContainer = document.getElementById('sensor-records');
  recordsContainer.replaceChildren();

  if (records.length === 0) {
    const emptyState = document.createElement('p');
    emptyState.className = 'records-empty';
    emptyState.textContent = t('No successful device responses have been saved yet.');
    recordsContainer.append(emptyState);
    return;
  }

  for (const record of records) {
    const card = document.createElement('article');
    card.className = 'record-item';

    const metadata = document.createElement('div');
    metadata.className = 'record-meta';

    const timestamp = document.createElement('time');
    timestamp.dateTime = record.recorded_at;
    timestamp.textContent = new Date(record.recorded_at).toLocaleString(window.getCurrentLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      hourCycle: 'h23'
    });

    const type = document.createElement('span');
    type.textContent = record.content_type || 'text/plain';
    metadata.append(timestamp, type);

    const payload = document.createElement('pre');
    payload.className = 'record-payload';
    payload.textContent = formatPayload(record.payload, record.content_type || '');
    card.append(metadata, payload);
    recordsContainer.append(card);
  }
}

function formatPayload(payload, contentType) {
  if (contentType.includes('application/json')) {
    try {
      return JSON.stringify(JSON.parse(payload), null, 2);
    } catch (error) {
      console.warn('Device returned invalid JSON; showing its raw response.', error);
    }
  }
  return payload;
}

async function loadRecords() {
  const recordsContainer = document.getElementById('sensor-records');
  try {
    const response = await fetch(`/api/records?limit=${RECORD_LIMIT}`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Could not load records (HTTP ${response.status}).`);
    }
    renderRecords(result.records);
  } catch (error) {
    recordsContainer.textContent = t('Saved device records are unavailable. Start the local service with start-local.bat.');
    console.error('Loading saved device records failed:', error);
  }
}

function updateConnection(isConnected) {
  if (connectionState === isConnected) {
    return;
  }

  if (connectionState !== null) {
    const messageKey = isConnected ? 'ESP32 connection restored' : 'ESP32 connection lost';
    addEvent(messageKey);
    window.showNotification(t(messageKey), isConnected ? 'success' : 'error');
  } else if (!isConnected) {
    window.showNotification(t('Could not reach the ESP32. Check its Wi-Fi connection.'), 'error');
  }

  connectionState = isConnected;
}

async function refreshDeviceResponse() {
  if (polling) {
    return;
  }

  polling = true;
  const refreshButton = document.getElementById('refresh-dashboard');
  refreshButton.setAttribute('aria-busy', 'true');

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch('/api/check', {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(t('The ESP32 request failed with HTTP {status}.', { status: response.status }));
    }

    const recordedAt = new Date(result.record.recorded_at);
    lastUpdated.dateTime = result.record.recorded_at;
    lastUpdated.textContent = recordedAt.toLocaleTimeString(window.getCurrentLocale(), {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    document.getElementById('sidebar-device-status').textContent = t('Connected · live updates');
    document.querySelector('.sidebar-status-dot').classList.add('is-connected');
    latestPayload = result.record.payload;
    latestContentType = result.record.content_type || '';
    updateTelemetry(latestPayload, latestContentType);
    updateConnection(true);
    await loadRecords();
  } catch (error) {
    const message = t(error.name === 'AbortError'
      ? 'The ESP32 request timed out. Check the device Wi-Fi connection.'
      : 'Could not reach the local service. Start it with start-local.bat.');
    document.getElementById('sidebar-device-status').textContent = t('Connection unavailable');
    document.querySelector('.sidebar-status-dot').classList.remove('is-connected');
    clearLiveTelemetry();
    updateConnection(false);
    console.error('Refreshing device response failed:', error);
  } finally {
    window.clearTimeout(timeout);
    refreshButton.removeAttribute('aria-busy');
    polling = false;
  }
}

function applyMode(mode) {
  document.getElementById('auto-mode').setAttribute('aria-pressed', String(mode === 'automatic'));
  document.getElementById('manual-mode').setAttribute('aria-pressed', String(mode === 'manual'));

  if (!mode) {
    modeExplanation.textContent = t('Controller mode: unknown. Choose a preview mode; this will not change the ESP32.');
    return;
  }

  const label = t(mode === 'automatic' ? 'Automatic' : 'Manual');
  modeExplanation.textContent = t('Preview selection: {mode}. The ESP32 controller mode remains unknown.', { mode: label });
}

function setMode(mode) {
  if (!writeLocalValue(MODE_KEY, mode)) {
    return;
  }

  applyMode(mode);
  addEvent(mode === 'automatic' ? 'Automatic mode selected (preview only)' : 'Manual mode selected (preview only)');
  window.showNotification(t('Saved as a local preview only; the controller mode did not change.'), 'warning');
}

function loadSettings() {
  const settings = readLocalValue(SETTINGS_KEY, null);
  if (!settings || typeof settings !== 'object') {
    return;
  }

  const fields = {
    soilThreshold: document.getElementById('soil-threshold'),
    tankThreshold: document.getElementById('tank-threshold'),
    runTime: document.getElementById('run-time')
  };

  for (const [key, field] of Object.entries(fields)) {
    const value = Number(settings[key]);
    if (Number.isFinite(value) && value >= Number(field.min) && value <= Number(field.max)) {
      field.value = String(value);
      dashboardSettings[key] = value;
    }
  }
  settingsSaved = true;
  settingsStatusKey = 'Loaded from this browser; not applied to the controller.';
  document.getElementById('settings-saved').textContent = t(settingsStatusKey);
}

document.getElementById('auto-mode').addEventListener('click', () => setMode('automatic'));
document.getElementById('manual-mode').addEventListener('click', () => setMode('manual'));

document.getElementById('settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) {
    return;
  }

  const settings = {
    soilThreshold: Number(document.getElementById('soil-threshold').value),
    tankThreshold: Number(document.getElementById('tank-threshold').value),
    runTime: Number(document.getElementById('run-time').value)
  };

  if (writeLocalValue(SETTINGS_KEY, settings)) {
    dashboardSettings = settings;
    settingsSaved = true;
    settingsStatusKey = 'Saved in this browser; not applied to the controller.';
    document.getElementById('settings-saved').textContent = t(settingsStatusKey);
    addEvent('Local thresholds and run time saved (not sent to controller)');
    window.showNotification(t('Settings saved in this browser only. The controller was not changed.'), 'warning');
  }
});

document.getElementById('clear-events').addEventListener('click', () => {
  if (writeLocalValue(EVENTS_KEY, [])) {
    renderEvents();
    window.showNotification(t('Local event history cleared.'), 'success');
  }
});

document.getElementById('refresh-dashboard').addEventListener('click', refreshDeviceResponse);
document.getElementById('refresh-records').addEventListener('click', loadRecords);

window.addEventListener('devicelink-language-change', () => {
  renderEvents();
  if (connectionState === true) {
    document.getElementById('sidebar-device-status').textContent = t('Connected · live updates');
  } else if (connectionState === false) {
    document.getElementById('sidebar-device-status').textContent = t('Connection unavailable');
  } else {
    document.getElementById('sidebar-device-status').textContent = t('Integration needed');
  }
  if (latestPayload !== null) {
    updateTelemetry(latestPayload, latestContentType);
  } else if (connectionState === false) {
    clearLiveTelemetry();
  } else {
    const mode = readLocalValue(MODE_KEY, null);
    applyMode(mode === 'automatic' || mode === 'manual' ? mode : null);
  }
  if (settingsSaved) {
    document.getElementById('settings-saved').textContent = t(settingsStatusKey);
  }
  if (lastUpdated.dateTime) {
    lastUpdated.textContent = new Date(lastUpdated.dateTime).toLocaleTimeString(window.getCurrentLocale(), {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
  }
  loadRecords();
});

const savedMode = readLocalValue(MODE_KEY, null);
applyMode(savedMode === 'automatic' || savedMode === 'manual' ? savedMode : null);
loadSettings();
renderEvents();
loadRecords();
refreshDeviceResponse();
window.setInterval(refreshDeviceResponse, POLL_INTERVAL_MS);
