const BACKEND = 'http://localhost:3000';

const statusText = document.getElementById('statusText');
const lastSyncEl = document.getElementById('lastSync');
const lastConvEl = document.getElementById('lastConv');
const headerBadge = document.getElementById('headerBadge');
const logEl = document.getElementById('logEl');
const scanProgressEl = document.getElementById('scanProgress');
const scanProgressText = document.getElementById('scanProgressText');
const btnScan = document.getElementById('btnScan');
const btnStopScan = document.getElementById('btnStopScan');

// ── Date filter pills ─────────────────────────────────────────────────────
let selectedDays = 2;

document.querySelectorAll('.pill:not(.batch-pill)').forEach((pill) => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.pill:not(.batch-pill)').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    selectedDays = parseInt(pill.dataset.days);
    chrome.storage.local.set({ selectedDays });
  });
});

chrome.storage.local.get(['selectedDays'], (r) => {
  if (r.selectedDays) {
    selectedDays = r.selectedDays;
    document.querySelectorAll('.pill:not(.batch-pill)').forEach((p) => {
      p.classList.toggle('active', parseInt(p.dataset.days) === selectedDays);
    });
  }
});

// ── Batch size pills ──────────────────────────────────────────────────────
let selectedBatch = 5;

document.querySelectorAll('.batch-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.batch-pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    selectedBatch = parseInt(pill.dataset.batch);
    chrome.storage.local.set({ selectedBatch });
  });
});

chrome.storage.local.get(['selectedBatch'], (r) => {
  if (r.selectedBatch) {
    selectedBatch = r.selectedBatch;
    document.querySelectorAll('.batch-pill').forEach((p) => {
      p.classList.toggle('active', parseInt(p.dataset.batch) === selectedBatch);
    });
  }
});

// ── Log ───────────────────────────────────────────────────────────────────
function log(msg) {
  const time = new Date().toLocaleTimeString('vi-VN');
  logEl.innerHTML = `[${time}] ${msg}<br>` + logEl.innerHTML;
}

// ── Status render ─────────────────────────────────────────────────────────
function renderStatus(status) {
  const map = {
    active:          { label: 'Đang theo dõi', cls: 'active' },
    stopped:         { label: 'Đã dừng',        cls: 'stopped' },
    backend_offline: { label: 'Backend offline', cls: 'offline' },
  };
  const s = map[status] || { label: status, cls: '' };
  statusText.textContent = s.label;
  statusText.className = `status-value ${s.cls}`;
  headerBadge.className = `badge ${s.cls === 'active' ? '' : s.cls}`;
}

// ── Load state ────────────────────────────────────────────────────────────
function loadState() {
  chrome.storage.local.get(
    ['status', 'lastSync', 'lastConversation', 'scanStatus', 'scanProgress', 'lastScanTotal'],
    (r) => {
      renderStatus(r.status || 'stopped');
      if (r.lastSync) lastSyncEl.textContent = new Date(r.lastSync).toLocaleTimeString('vi-VN');
      if (r.lastConversation) lastConvEl.textContent = r.lastConversation;

      const scanning = r.scanStatus === 'scanning';
      const stopping = r.scanStatus === 'stopping';
      const active = scanning || stopping;
      scanProgressEl.classList.toggle('visible', active || r.scanStatus === 'done' || r.scanStatus === 'stopped');
      btnScan.disabled = active;
      btnStopScan.classList.toggle('visible', active);

      if (scanning) {
        const prog = r.scanProgress ?? '...';
        const isLoading = typeof prog === 'string' && prog.includes('Tải');
        scanProgressText.textContent = isLoading ? prog : `Đang scan hội thoại ${prog}`;
      } else if (stopping) {
        scanProgressText.textContent = 'Đang dừng...';
        btnStopScan.disabled = true;
      } else if (r.scanStatus === 'stopped') {
        scanProgressText.textContent = `⏹ Đã dừng — đã lưu ${r.lastScanTotal ?? 0} kết quả`;
        btnScan.disabled = false;
        btnStopScan.classList.remove('visible');
        btnStopScan.disabled = false;
        setTimeout(() => {
          scanProgressEl.classList.remove('visible');
          chrome.storage.local.set({ scanStatus: '' });
        }, 5000);
      } else if (r.scanStatus === 'done') {
        scanProgressText.textContent = `✓ Xong — ${r.lastScanTotal ?? 0} hội thoại`;
        btnScan.disabled = false;
        btnStopScan.classList.remove('visible');
        setTimeout(() => {
          scanProgressEl.classList.remove('visible');
          chrome.storage.local.set({ scanStatus: '' });
        }, 5000);
      } else if (r.scanStatus === 'no_conversations') {
        log(`Không có hội thoại nào trong ${selectedDays} ngày gần đây.`);
        chrome.storage.local.set({ scanStatus: '' });
        btnScan.disabled = false;
      }
    },
  );
}

// ── Lấy tab Messenger đang mở ─────────────────────────────────────────────
async function getMessengerTab() {
  // Tìm tab messenger.com trong tất cả windows
  const tabs = await chrome.tabs.query({ url: 'https://www.messenger.com/*' });
  if (tabs.length > 0) return tabs[0];

  // Fallback: tab đang active trong window hiện tại
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url?.includes('messenger.com')) return active;

  return null;
}

// ── Inject content script nếu chưa có ────────────────────────────────────
async function ensureContentScript(tabId) {
  try {
    // Ping thử — nếu content script đang chạy sẽ trả lời
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return true;
  } catch {
    // Content script chưa chạy → inject
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      await new Promise((r) => setTimeout(r, 500));
      return true;
    } catch (e) {
      log(`Không thể inject script: ${e.message}`);
      return false;
    }
  }
}

// ── Gửi lệnh đến tab Messenger ────────────────────────────────────────────
async function sendToMessenger(action, extra = {}) {
  const tab = await getMessengerTab();

  if (!tab) {
    log('Không tìm thấy tab messenger.com. Mở messenger.com trước.');
    return false;
  }

  const ready = await ensureContentScript(tab.id);
  if (!ready) return false;

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { action, ...extra }, (response) => {
      if (chrome.runtime.lastError) {
        log(`Lỗi gửi lệnh: ${chrome.runtime.lastError.message}`);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

// ── Buttons ───────────────────────────────────────────────────────────────
btnStopScan.onclick = async () => {
  btnStopScan.disabled = true;
  scanProgressText.textContent = 'Đang dừng...';
  await sendToMessenger('stopScan');
  log('Đã gửi lệnh dừng scan. Data đã thu thập được giữ nguyên.');
};

btnScan.onclick = async () => {
  btnScan.disabled = true;
  scanProgressEl.classList.add('visible');
  scanProgressText.textContent = 'Đang kết nối...';

  const ok = await sendToMessenger('autoScan', { days: selectedDays, batchSize: selectedBatch });
  if (ok) {
    log(`Bắt đầu scan ${selectedDays} ngày gần nhất (batch ${selectedBatch})...`);
    scanProgressText.textContent = 'Đang tải danh sách hội thoại...';
  } else {
    btnScan.disabled = false;
    scanProgressEl.classList.remove('visible');
  }
};

document.getElementById('btnStart').onclick = async () => {
  const ok = await sendToMessenger('start');
  if (ok) log('Đã bật chế độ theo dõi liên tục (2 phút/lần).');
};

document.getElementById('btnStop').onclick = async () => {
  const ok = await sendToMessenger('stop');
  if (ok) log('Đã dừng theo dõi.');
};

document.getElementById('btnReport').onclick = async () => {
  chrome.storage.local.get(['scanResults'], async (s) => {
    const records = s.scanResults ?? [];
    if (!records.length) {
      log('Chưa có dữ liệu. Chạy auto-scan trước.');
      return;
    }
    log(`Đang tạo báo cáo từ ${records.length} hội thoại...`);
    try {
      const res = await fetch(`${BACKEND}/api/report/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(records),
      });
      const data = await res.json();
      log(`Xuất xong: ${data.fileName}`);
      // Tự động download file
      chrome.downloads.download({ url: data.downloadUrl, filename: data.fileName });
    } catch {
      log('Backend offline. Chạy: npm run start:dev');
    }
  });
};

document.getElementById('btnClear').onclick = () => {
  chrome.storage.local.set({ scanResults: [] }, () => {
    log('Đã xóa dữ liệu scan.');
    document.getElementById('recordCount').textContent = '0';
  });
};

function updateRecordCount() {
  chrome.storage.local.get(['scanResults'], (s) => {
    document.getElementById('recordCount').textContent = (s.scanResults ?? []).length;
  });
}

loadState();
updateRecordCount();
setInterval(() => { loadState(); updateRecordCount(); }, 2000);
