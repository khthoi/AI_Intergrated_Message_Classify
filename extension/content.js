(() => {
  const BACKEND_URL = 'http://localhost:3000/api/extract';
  const POLL_INTERVAL_MS = 2 * 60 * 1000;
  const SCAN_DELAY_MS = 2000;       // chờ DOM sau mỗi lần click conversation
  const SCROLL_DELAY_MS = 1200;     // chờ sau mỗi lần scroll sidebar
  const MAX_MESSAGES_PER_CONV = 40;

  let isRunning = false;
  let isScanning = false;
  let shouldStopScan = false;
  let pollTimer = null;

  // ── Parse timestamp hiển thị trong sidebar ────────────────────────────────
  // Messenger hiển thị: "Vừa xong", "5 phút", "2 giờ", "Hôm qua", "Thứ 2", "12 thg 5"
  function parseMessengerTime(text) {
    if (!text) return null;
    const t = text.trim().toLowerCase();
    const now = new Date();

    if (t.includes('vừa') || t.includes('just now') || t.includes('now')) return now;

    // "X phút" / "Xm"
    const mins = t.match(/(\d+)\s*(phút|m\b|min)/);
    if (mins) return new Date(now - parseInt(mins[1]) * 60000);

    // "X giờ" / "Xh" / "X hr"
    const hrs = t.match(/(\d+)\s*(giờ|h\b|hr)/);
    if (hrs) return new Date(now - parseInt(hrs[1]) * 3600000);

    // "Hôm qua" / "Yesterday"
    if (t.includes('hôm qua') || t.includes('yesterday')) {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return d;
    }

    // Thứ trong tuần (tối đa 7 ngày trước)
    const days = ['chủ nhật', 'thứ hai', 'thứ ba', 'thứ tư', 'thứ năm', 'thứ sáu', 'thứ bảy',
                  'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    for (let i = 0; i < days.length; i++) {
      if (t.includes(days[i])) {
        const targetDay = i % 7;
        const d = new Date(now);
        const diff = (now.getDay() - targetDay + 7) % 7 || 7;
        d.setDate(d.getDate() - diff);
        return d;
      }
    }

    // Ngày cụ thể "12 thg 5" / "12/5"
    const dateMatch = t.match(/(\d{1,2})\s*(?:thg|\/|-)\s*(\d{1,2})/);
    if (dateMatch) {
      const d = new Date(now.getFullYear(), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[1]));
      if (d > now) d.setFullYear(d.getFullYear() - 1);
      return d;
    }

    return null;
  }

  // ── Tính cutoff date từ setting ───────────────────────────────────────────
  function getCutoffDate(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // ── Lấy conversation ID từ URL ────────────────────────────────────────────
  function getConversationIdFromUrl() {
    const match = window.location.pathname.match(/\/t\/([^/?]+)/);
    return match ? match[1] : null;
  }

  // ── Lấy tên người đang chat ───────────────────────────────────────────────
  function getParticipantName() {
    const selectors = ['h1[dir="auto"]', '[role="main"] h1'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.innerText?.trim()) return el.innerText.trim();
    }
    return getConversationIdFromUrl() ?? 'Unknown';
  }

  // ── Extract tin nhắn trong conversation đang mở ───────────────────────────
  function extractMessages() {
    const messages = [];
    const main = document.querySelector('[role="main"]');
    if (!main) return messages;

    main.querySelectorAll('[dir="auto"]').forEach((textEl) => {
      const content = textEl.innerText?.trim();
      if (!content || content.length < 2) return;

      const bubble = textEl.closest('[data-testid*="message"], [role="row"]') ?? textEl.parentElement;
      if (!bubble) return;

      const isMe = !!bubble.closest('[class*="outgoing"], [data-testid*="outgoing"]') ||
        !!textEl.closest('[style*="flex-end"]');

      const senderName = isMe ? 'Me' : getParticipantName();
      const sentAt = new Date().toISOString();
      const id = btoa(unescape(encodeURIComponent(
        `${senderName}:${content.slice(0, 80)}:${getConversationIdFromUrl()}`
      ))).replace(/[+/=]/g, '').slice(0, 32);

      messages.push({ id, senderName, senderType: isMe ? 'me' : 'customer', content, sentAt });
    });

    const seen = new Set();
    return messages.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    }).slice(-MAX_MESSAGES_PER_CONV);
  }

  // ── Gửi lên backend (single), nhận kết quả AI, lưu vào storage ──────────
  async function sendToBackend(conversationId, participantName, messages) {
    if (!messages.length) return 0;
    try {
      const res = await fetch(BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, participantName, messages }),
      });
      if (!res.ok) return 0;

      const record = await res.json();
      await saveRecords([record]);
      return 1;
    } catch {
      chrome.storage.local.set({ status: 'backend_offline' });
      return 0;
    }
  }

  // ── Gửi batch lên backend, lưu tất cả kết quả vào storage ───────────────
  async function sendBatchToBackend(batch) {
    // batch: [{ conversationId, participantName, messages }]
    if (!batch.length) return 0;
    try {
      const res = await fetch(`${BACKEND_URL}/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversations: batch }),
      });
      if (!res.ok) return 0;

      const records = await res.json();
      if (!Array.isArray(records)) return 0;
      await saveRecords(records);
      return records.length;
    } catch {
      chrome.storage.local.set({ status: 'backend_offline' });
      return 0;
    }
  }

  // ── Lưu danh sách records vào storage (upsert theo conversationId) ────────
  function saveRecords(records) {
    return new Promise((resolve) => {
      // Timeout 8s — tránh treo vĩnh viễn khi extension context bị invalidate
      const guard = setTimeout(() => {
        console.warn('[AutoMSTool] saveRecords: timeout 8s, bỏ qua và tiếp tục');
        resolve();
      }, 8000);

      chrome.storage.local.get(['scanResults'], (s) => {
        if (chrome.runtime.lastError) {
          clearTimeout(guard);
          console.warn('[AutoMSTool] saveRecords get error:', chrome.runtime.lastError.message);
          resolve();
          return;
        }
        const existing = s.scanResults ?? [];
        for (const record of records) {
          const idx = existing.findIndex((r) => r.conversationId === record.conversationId);
          if (idx >= 0) existing[idx] = record;
          else existing.push(record);
        }
        chrome.storage.local.set({
          scanResults: existing,
          lastSync: new Date().toISOString(),
          lastConversation: records[records.length - 1]?.participantName ?? '',
        }, () => {
          clearTimeout(guard);
          if (chrome.runtime.lastError) {
            console.warn('[AutoMSTool] saveRecords set error:', chrome.runtime.lastError.message);
          }
          resolve();
        });
      });
    });
  }

  // ── Tìm container scroll của sidebar ─────────────────────────────────────
  function findSidebarScroller() {
    // Sidebar là element có overflow-y scroll chứa các link /t/
    const links = document.querySelectorAll('a[href*="/t/"]');
    if (!links.length) return null;
    let el = links[0].parentElement;
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      if ((style.overflow === 'auto' || style.overflowY === 'auto' ||
           style.overflow === 'scroll' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  // ── Lấy danh sách conversations từ sidebar (có timestamp) ─────────────────
  function collectSidebarConversations() {
    const links = document.querySelectorAll('a[href*="/t/"]');
    const seen = new Set();
    const result = [];

    links.forEach((link) => {
      const href = link.getAttribute('href') ?? '';
      const match = href.match(/\/t\/([^/?]+)/);
      if (!match) return;
      const convId = match[1];
      if (seen.has(convId)) return;
      seen.add(convId);

      // Tìm timestamp text gần nhất trong item
      const timeEl = link.querySelector('abbr, [aria-label*=":"], span[title]') ??
        Array.from(link.querySelectorAll('span')).find((s) => /\d/.test(s.innerText ?? ''));
      const timeText = timeEl?.getAttribute('title') ?? timeEl?.getAttribute('aria-label') ?? timeEl?.innerText ?? '';
      const parsedTime = parseMessengerTime(timeText);

      result.push({ convId, element: link, lastActivity: parsedTime });
    });

    return result;
  }

  // ── Lấy timestamp lớn nhất trong tất cả tin nhắn đang hiển thị ──────────
  function getLastMessageTime() {
    const main = document.querySelector('[role="main"]');
    if (!main) return null;

    // Thử data-utime (Messenger cũ) trước, sau đó tìm timestamp text hiện đại
    const utimeEls = [...main.querySelectorAll('abbr[data-utime]')];
    if (utimeEls.length) {
      const times = utimeEls
        .map((el) => parseInt(el.getAttribute('data-utime')))
        .filter((t) => !isNaN(t));
      if (times.length) return new Date(Math.max(...times) * 1000);
    }

    // Messenger hiện đại: tìm aria-label hoặc title chứa ngày giờ trên các abbr/span timestamp
    const timeEls = [...main.querySelectorAll('abbr[aria-label], span[aria-label]')]
      .filter((el) => /\d/.test(el.getAttribute('aria-label') ?? ''));
    const parsed = timeEls
      .map((el) => parseMessengerTime(el.getAttribute('aria-label') ?? ''))
      .filter(Boolean);

    if (!parsed.length) return null;
    return new Date(Math.max(...parsed.map((d) => d.getTime())));
  }

  // ── AUTO-SCAN: scroll sidebar lấy danh sách, lọc ngày khi mở từng conversation ──
  async function autoScan(scanDays, batchSize = 1) {
    if (isScanning) return;
    isScanning = true;
    shouldStopScan = false;

    const cutoff = getCutoffDate(scanDays);
    const cutoffStr = cutoff.toLocaleDateString('vi-VN');
    console.log(`[AutoMSTool] ══ BẮT ĐẦU SCAN ══ scanDays=${scanDays}, cutoff=${cutoffStr}, batchSize=${batchSize}`);
    chrome.storage.local.set({ scanStatus: 'scanning', scanProgress: 'Đang tải danh sách...' });

    // ── PHASE 1: scroll sidebar, dừng sớm khi vượt qua cutoff ───────────────
    console.log('[AutoMSTool] [Phase 1] Bắt đầu scroll sidebar...');
    const scroller = findSidebarScroller();
    if (!scroller) console.warn('[AutoMSTool] [Phase 1] Không tìm thấy sidebar scroller — sidebar có thể chưa hiển thị đủ.');

    let noNewCount = 0;
    let pastCutoffCount = 0; // số lần scroll liên tiếp mà batch cuối toàn conv cũ hơn cutoff

    while (noNewCount < 3) {
      if (shouldStopScan) break;

      const before = collectSidebarConversations().length;
      if (scroller) scroller.scrollTop += 600;
      await sleep(SCROLL_DELAY_MS);
      const convs = collectSidebarConversations();
      const after = convs.length;

      if (after === before) {
        noNewCount++;
      } else {
        noNewCount = 0;

        // Kiểm tra các conversation mới load ra có đều cũ hơn cutoff không
        const newlyLoaded = convs.slice(before);
        const allNewAreOld = newlyLoaded.length > 0 && newlyLoaded.every(
          (c) => c.lastActivity && c.lastActivity < cutoff,
        );
        if (allNewAreOld) {
          pastCutoffCount++;
          console.log(`[AutoMSTool] [Phase 1] Scroll ${after}: ${newlyLoaded.length} conv mới đều cũ hơn cutoff (${pastCutoffCount}/3)`);
          if (pastCutoffCount >= 3) {
            console.log(`[AutoMSTool] [Phase 1] 3 đợt scroll liên tiếp ra toàn conv cũ → dừng scroll sớm`);
            break;
          }
        } else {
          pastCutoffCount = 0;
        }
      }

      chrome.storage.local.set({
        scanStatus: 'scanning',
        scanProgress: `Tải được ${after} hội thoại...`,
      });
    }

    const allConversations = collectSidebarConversations();
    console.log(`[AutoMSTool] [Phase 1] Hoàn tất — tổng ${allConversations.length} hội thoại trong sidebar`);

    if (!allConversations.length) {
      console.warn('[AutoMSTool] Không tìm thấy hội thoại nào trong sidebar.');
      chrome.storage.local.set({ scanStatus: 'no_conversations', scanProgress: '' });
      isScanning = false;
      return;
    }

    // Đếm sơ bộ bao nhiêu conv có thể nằm trong range (dựa trên sidebar timestamp)
    const inRangeEstimate = allConversations.filter(
      (c) => !c.lastActivity || c.lastActivity >= cutoff,
    ).length;
    console.log(`[AutoMSTool] [Phase 1] Ước tính trong ${scanDays} ngày: ~${inRangeEstimate}/${allConversations.length} conv`);

    chrome.storage.local.set({
      scanStatus: 'scanning',
      scanProgress: `0/${allConversations.length}`,
    });

    // ── PHASE 2: mở từng conversation, buffer theo batchSize rồi gửi AI ─────
    console.log(`[AutoMSTool] [Phase 2] Bắt đầu xử lý ${allConversations.length} hội thoại...`);
    let totalSaved = 0;
    let skippedOld = 0;
    let skippedEmpty = 0;
    let convBuffer = [];

    const flushBuffer = async () => {
      if (!convBuffer.length) return;
      console.log(`[AutoMSTool] [Phase 2] Flush batch ${convBuffer.length} conv → API`);
      const saved = batchSize === 1
        ? await sendToBackend(convBuffer[0].conversationId, convBuffer[0].participantName, convBuffer[0].messages)
        : await sendBatchToBackend(convBuffer);
      totalSaved += saved;
      convBuffer = [];
    };

    for (let i = 0; i < allConversations.length; i++) {
      if (shouldStopScan) {
        console.log('[AutoMSTool] [Phase 2] Scan bị dừng bởi người dùng.');
        break;
      }

      const { convId, element, lastActivity } = allConversations[i];

      chrome.storage.local.set({
        scanStatus: 'scanning',
        scanProgress: `${i + 1}/${allConversations.length}`,
      });

      // Pre-filter từ sidebar timestamp — bỏ qua ngay, không cần mở conversation
      if (lastActivity && lastActivity < cutoff) {
        skippedOld++;
        console.log(`[AutoMSTool] [Phase 2] [${i + 1}/${allConversations.length}] SKIP (sidebar) — ${lastActivity.toLocaleDateString('vi-VN')} cũ hơn cutoff ${cutoffStr}`);
        if (skippedOld >= 5) {
          console.log('[AutoMSTool] [Phase 2] 5 conv liên tiếp cũ hơn cutoff → dừng sớm');
          break;
        }
        continue;
      }

      try {
        console.log(`[AutoMSTool] [Phase 2] [${i + 1}/${allConversations.length}] ${convId}: bắt đầu navigate...`);
        await navigateTo(convId, element);
        console.log(`[AutoMSTool] [Phase 2] [${i + 1}] URL ok, chờ DOM...`);

        const loaded = await waitForMessages(5, 10000);
        if (!loaded) {
          console.warn(`[AutoMSTool] [Phase 2] [${i + 1}] ${convId}: timeout chờ DOM, bỏ qua`);
          continue;
        }

        // Chờ thêm để Messenger render đủ tin nhắn (lazy-load)
        await sleep(600);

        // Xác nhận lại bằng timestamp thực từ DOM
        const lastMsgTime = getLastMessageTime();
        if (lastMsgTime && lastMsgTime < cutoff) {
          skippedOld++;
          console.log(`[AutoMSTool] [Phase 2] [${i + 1}/${allConversations.length}] SKIP (DOM) — tin cuối ${lastMsgTime.toLocaleDateString('vi-VN')} cũ hơn cutoff`);
          if (skippedOld >= 5) {
            console.log('[AutoMSTool] [Phase 2] 5 conv liên tiếp cũ hơn cutoff → dừng sớm');
            break;
          }
          continue;
        }
        skippedOld = 0;

        const messages = extractMessages();
        const name = getParticipantName();

        if (!messages.length) {
          skippedEmpty++;
          console.log(`[AutoMSTool] [Phase 2] [${i + 1}/${allConversations.length}] ${name}: không có tin nhắn, bỏ qua`);
          continue;
        }

        convBuffer.push({ conversationId: convId, participantName: name, messages });
        console.log(`[AutoMSTool] [Phase 2] [${i + 1}/${allConversations.length}] ${name}: buffered (${convBuffer.length}/${batchSize})`);

        if (convBuffer.length >= batchSize) await flushBuffer();

        await sleep(1200);
      } catch (err) {
        console.error(`[AutoMSTool] [Phase 2] [${i + 1}] Lỗi bất ngờ: ${err?.message ?? err} — bỏ qua conv này`);
      }
    }

    // Flush phần còn lại
    await flushBuffer();

    const status = shouldStopScan ? 'stopped' : 'done';
    console.log(
      `[AutoMSTool] ══ KẾT THÚC SCAN ══ ${status.toUpperCase()} — ` +
      `lưu: ${totalSaved} | bỏ qua (cũ): ${skippedOld} | bỏ qua (trống): ${skippedEmpty} | tổng: ${allConversations.length}`,
    );

    chrome.storage.local.set({
      scanStatus: status,
      scanProgress: `${allConversations.length}/${allConversations.length}`,
      lastScanTotal: totalSaved,
    });
    isScanning = false;
    shouldStopScan = false;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // ── Navigate đến conversation và chờ load xong ────────────────────────────
  async function navigateTo(convId, element) {
    const targetPath = `/t/${convId}`;

    // Thử 1: history.pushState + popstate (React Router lắng nghe sự kiện này)
    history.pushState({}, '', targetPath);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    if (await waitForUrl(convId, 1500)) return;

    // Thử 2: dispatch full mouse event sequence vào element thật
    for (const type of ['mousedown', 'mouseup', 'click']) {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    if (await waitForUrl(convId, 2000)) return;

    // Thử 3: click element gốc hoặc parent <a> gần nhất
    const anchor = element.closest('a[href*="/t/"]') ?? element;
    anchor.click();
    await waitForUrl(convId, 2500);
  }

  // Chờ URL chứa convId, timeout ms
  async function waitForUrl(convId, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (window.location.pathname.includes(convId)) return true;
      await sleep(150);
    }
    return false;
  }

  // Chờ DOM có ít nhất N tin nhắn xuất hiện trong [role="main"]
  async function waitForMessages(minCount = 3, timeout = 4000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const main = document.querySelector('[role="main"]');
      if (main && main.querySelectorAll('[dir="auto"]').length >= minCount) return true;
      await sleep(200);
    }
    return false;
  }

  // ── Poll conversation hiện tại ────────────────────────────────────────────
  async function pollCurrent() {
    console.trace('[AutoMSTool] pollCurrent called');
    const convId = getConversationIdFromUrl();
    if (!convId) return;
    const messages = extractMessages();
    await sendToBackend(convId, getParticipantName(), messages);
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    pollCurrent();
    pollTimer = setInterval(pollCurrent, POLL_INTERVAL_MS);
    chrome.storage.local.set({ status: 'active' });
  }

  function stop() {
    isRunning = false;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    chrome.storage.local.set({ status: 'stopped' });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'ping')     { sendResponse({ ok: true }); return; }
    if (msg.action === 'start')    start();
    if (msg.action === 'stop')     stop();
    if (msg.action === 'poll')     pollCurrent();
    if (msg.action === 'autoScan') autoScan(msg.days ?? 1, msg.batchSize ?? 1);
    if (msg.action === 'stopScan') {
      shouldStopScan = true;
      // Cập nhật storage ngay để popup phản hồi nhanh
      chrome.storage.local.set({ scanStatus: 'stopping' });
    }
    sendResponse({ ok: true });
  });

  // Luôn reset về stopped khi load — không bao giờ tự động polling
  chrome.storage.local.set({ status: 'stopped' });

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isRunning && !isScanning) setTimeout(pollCurrent, 1500);
    }
  }).observe(document.body, { subtree: true, childList: true });
})();
