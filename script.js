const DEVICE_URL = 'http://192.168.4.1/';
const STATUS_EL = document.getElementById('connection-status');
const STATUS_LABEL_EL = document.getElementById('status-label');
const OUTPUT_EL = document.getElementById('ip-output');
const CHECK_BUTTON = document.getElementById('check-button');
const COPY_BUTTON = document.getElementById('copy-button');
const RESPONSE_TIME_EL = document.getElementById('response-time');

function setStatus(state, label) {
  STATUS_EL.className = `status-pill${state ? ` is-${state}` : ''}`;
  STATUS_LABEL_EL.textContent = label;
}

async function checkDevice() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  CHECK_BUTTON.disabled = true;
  setStatus('checking', 'Checking device');
  OUTPUT_EL.textContent = 'Waiting for a response from http://192.168.4.1/ ...';
  RESPONSE_TIME_EL.textContent = '';

  try {
    const response = await fetch('/api/check', {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `The device request failed with HTTP ${response.status}.`);
    }

    OUTPUT_EL.textContent = result.record.payload
      ? formatPayload(result.record.payload, result.record.content_type)
      : '(The device returned an empty response.)';
    RESPONSE_TIME_EL.textContent = `Saved ${new Date(result.record.recorded_at).toLocaleTimeString()}`;
    setStatus('', 'Device reachable');
    window.showNotification('Device response received and saved to the local SQLite database.', 'success');
    await loadRecords();
  } catch (error) {
    const isAbort = error.name === 'AbortError';
    const message = isAbort
      ? 'The device request timed out. Check that you are connected to the ESP32 Wi-Fi network.'
      : error.message || 'Could not reach the local service. Start it with start-local.bat and try again.';
    OUTPUT_EL.textContent = message;
    setStatus('error', isAbort ? 'Timed out' : 'Could not read response');
    window.showNotification(message, 'error');
    console.error('Device check failed:', error);
  } finally {
    window.clearTimeout(timeout);
    CHECK_BUTTON.disabled = false;
  }
}

async function copyAddress() {
  try {
    await navigator.clipboard.writeText(DEVICE_URL);
    COPY_BUTTON.textContent = '✓ Copied';
    window.showNotification('Device address copied to clipboard.', 'success');
    window.setTimeout(() => {
      COPY_BUTTON.textContent = '▢ Copy address';
    }, 1800);
  } catch (error) {
    const message = 'Could not copy the address. Select it above and copy it manually.';
    OUTPUT_EL.textContent = message;
    window.showNotification(message, 'error');
    console.error('Address copy failed:', error);
  }
}

function renderRecords(records) {
  const recordList = document.getElementById('sensor-records');
  recordList.replaceChildren();

  if (records.length === 0) {
    const emptyState = document.createElement('p');
    emptyState.className = 'records-empty';
    emptyState.textContent = 'No records saved yet. Check the device to save its first response.';
    recordList.append(emptyState);
    return;
  }

  for (const record of records) {
    const card = document.createElement('article');
    card.className = 'record-item';

    const header = document.createElement('div');
    header.className = 'record-meta';

    const timestamp = document.createElement('time');
    timestamp.dateTime = record.recorded_at;
    timestamp.textContent = new Date(record.recorded_at).toLocaleString();

    const contentType = document.createElement('span');
    contentType.textContent = record.content_type || 'text/plain';
    header.append(timestamp, contentType);

    const payload = document.createElement('pre');
    payload.className = 'record-payload';
    payload.textContent = formatPayload(record.payload, record.content_type);
    card.append(header, payload);
    recordList.append(card);
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
  const recordList = document.getElementById('sensor-records');
  try {
    const response = await fetch('/api/records?limit=50', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Could not load records (HTTP ${response.status}).`);
    }
    renderRecords(result.records);
  } catch (error) {
    recordList.textContent = 'Saved records are unavailable. Make sure the local DeviceLink service is running.';
    console.error('Loading saved records failed:', error);
    window.showNotification('Could not load records from the local SQLite database.', 'error');
  }
}

CHECK_BUTTON.addEventListener('click', checkDevice);
COPY_BUTTON.addEventListener('click', copyAddress);
document.getElementById('refresh-records').addEventListener('click', loadRecords);
loadRecords();
