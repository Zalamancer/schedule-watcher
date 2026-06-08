// background.js (MV3 service worker)

const STORAGE_KEY = "schedule_ext_state_v31";
const TOAST_DOM_ID = "schedule-ext-global-toast";
const ALARM_NAME = "schedule-helper-tick";

// Run every ~6 seconds
const TICK_MINUTES = 0.1;

let currentToastKey = null;

// ---------- State ----------
async function getState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const s = data[STORAGE_KEY] || {};

  // Defaults tailored to your URL:
  return {
    enabled: typeof s.enabled === "boolean" ? s.enabled : true,
    watchlist: Array.isArray(s.watchlist) ? s.watchlist : [],
    targetUrlContains: typeof s.targetUrlContains === "string" && s.targetUrlContains.trim()
      ? s.targetUrlContains.trim()
      : "utdallas.collegescheduler.com/terms/2026%20Spring/options",
    hiddenColumns: Array.isArray(s.hiddenColumns) ? s.hiddenColumns : [],
    hidelist: Array.isArray(s.hidelist) ? s.hidelist : [],

    // Stats (for popup display)
    lastClickAt: s.lastClickAt ?? null,
    lastReloadAt: s.lastReloadAt ?? null,
    lastScheduleCount: typeof s.lastScheduleCount === "number" ? s.lastScheduleCount : 0,
    lastClassTotal: typeof s.lastClassTotal === "number" ? s.lastClassTotal : 0,
    lastClassUnique: typeof s.lastClassUnique === "number" ? s.lastClassUnique : 0,
    lastStatus: typeof s.lastStatus === "string" ? s.lastStatus : "Starting…"
  };
}

async function setState(next) {
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

// ---------- Alarm bootstrap (important!) ----------
async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: TICK_MINUTES });
  }
}

// Make sure alarm exists whenever worker wakes
ensureAlarm();
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

// ---------- Toast injection ----------
function newToastKey() {
  return `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function injectIntoTab(tabId, mode, payload) {
  try {
    if (mode === "dismiss") {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (toastId) => {
          const el = document.getElementById(toastId);
          if (el) el.remove();
        },
        args: [TOAST_DOM_ID]
      });
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      func: (p, toastId) => {
        const existing = document.getElementById(toastId);
        if (existing) existing.remove();

        const styleId = "schedule-ext-toast-style";
        if (!document.getElementById(styleId)) {
          const st = document.createElement("style");
          st.id = styleId;
          st.textContent = `
            @keyframes schedule_ext_shake {
              0% { transform: translateX(0); }
              15% { transform: translateX(-7px); }
              30% { transform: translateX(7px); }
              45% { transform: translateX(-6px); }
              60% { transform: translateX(6px); }
              75% { transform: translateX(-4px); }
              100% { transform: translateX(0); }
            }
          `;
          document.documentElement.appendChild(st);
        }

        const isRed = p.theme === "red";

        const box = document.createElement("div");
        box.id = toastId;
        box.setAttribute("role", "dialog");
        box.style.cssText = `
          position: fixed;
          top: 90px;
          right: 16px;
          z-index: 2147483647;
          width: 360px;
          background: ${isRed ? "rgba(120, 15, 20, 0.96)" : "rgba(10, 90, 28, 0.95)"};
          color: #fff;
          border: 1px solid rgba(255,255,255,0.25);
          border-radius: 14px;
          box-shadow: 0 18px 55px rgba(0,0,0,0.45);
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          padding: 12px;
        `;

        if (p.shake) box.style.animation = "schedule_ext_shake 0.6s ease-in-out 0s 3";

        const top = document.createElement("div");
        top.style.cssText = "display:flex; align-items:flex-start; justify-content:space-between; gap:12px;";

        const text = document.createElement("div");
        text.style.cssText = "min-width:0;";

        const title = document.createElement("div");
        title.textContent = p.title || "Notice";
        title.style.cssText = "font-weight:900; font-size:14px; margin-bottom:6px;";

        const msg = document.createElement("div");
        msg.textContent = p.message || "";
        msg.style.cssText = "font-size:13px; opacity:0.98; white-space:pre-wrap;";

        text.appendChild(title);
        text.appendChild(msg);

        const close = document.createElement("button");
        close.textContent = "×";
        close.setAttribute("aria-label", "Close");
        close.style.cssText = `
          width:34px; height:34px;
          border-radius:10px;
          border:1px solid rgba(255,255,255,0.35);
          background:rgba(255,255,255,0.12);
          color:#fff;
          cursor:pointer;
          font-size:18px;
          line-height:1;
          flex:0 0 auto;
        `;

        const actions = document.createElement("div");
        actions.style.cssText = "display:flex; gap:10px; margin-top:10px; justify-content:flex-end;";

        const ok = document.createElement("button");
        ok.textContent = "OK";
        ok.style.cssText = `
          padding:8px 14px;
          border-radius:12px;
          border:1px solid rgba(255,255,255,0.35);
          background:rgba(255,255,255,0.16);
          color:#fff;
          cursor:pointer;
          font-weight:900;
        `;

        function requestGlobalDismiss() {
          try {
            chrome.runtime.sendMessage({ type: "DISMISS_GLOBAL_TOAST", toastKey: p.toastKey });
          } catch {
            box.remove();
          }
        }

        close.onclick = requestGlobalDismiss;
        ok.onclick = requestGlobalDismiss;

        top.appendChild(text);
        top.appendChild(close);

        actions.appendChild(ok);

        box.appendChild(top);
        box.appendChild(actions);

        document.documentElement.appendChild(box);
      },
      args: [payload, TOAST_DOM_ID]
    });
  } catch {
    // restricted pages etc
  }
}

async function broadcast(mode, payload) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    const url = tab.url;

    // Can't inject into these:
    if (
      url.startsWith("chrome://") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("https://chrome.google.com/webstore")
    ) continue;

    await injectIntoTab(tab.id, mode, payload);
  }
}

function showGreenToast(count) {
  currentToastKey = newToastKey();
  broadcast("show", {
    toastKey: currentToastKey,
    theme: "green",
    shake: false,
    title: "✅ More than 1 match",
    message: `More than 1 schedule found (${count}).\nClick X or OK to close.`
  });
}

function showRedToast(codes) {
  currentToastKey = newToastKey();
  broadcast("show", {
    toastKey: currentToastKey,
    theme: "red",
    shake: true,
    title: "🚨 Watchlist match found",
    message: `Found watched tag(s):\n${codes.join(", ")}\n\nClick X or OK to close.`
  });
}

// ---------- Find schedules tab ----------
async function findTargetTab(urlContains) {
  const tabs = await chrome.tabs.query({});
  return tabs.find(t => t.url && t.url.includes(urlContains)) || null;
}

// ---------- Tick ----------
async function tickOnce() {
  const s = await getState();
  if (!s.enabled) return;

  const tab = await findTargetTab(s.targetUrlContains);

  if (!tab || !tab.id) {
    // Update popup status so you know what's wrong
    s.lastStatus = `Schedules tab not found (looking for: ${s.targetUrlContains})`;
    await setState(s);
    return;
  }

  // Ask the content script in that tab to click+scan
  chrome.tabs.sendMessage(tab.id, { type: "DO_CLICK_AND_SCAN" }, async (resp) => {
    const stateNow = await getState();

    if (chrome.runtime.lastError || !resp) {
      stateNow.lastStatus = "No response from schedules tab (try reloading that page)";
      await setState(stateNow);
      return;
    }

    stateNow.lastClickAt = resp.lastClickAt ?? stateNow.lastClickAt ?? null;
    stateNow.lastReloadAt = resp.lastReloadAt ?? stateNow.lastReloadAt ?? null;
    stateNow.lastScheduleCount = typeof resp.scheduleCount === "number" ? resp.scheduleCount : stateNow.lastScheduleCount;
    stateNow.lastClassTotal = typeof resp.classTotal === "number" ? resp.classTotal : stateNow.lastClassTotal;
    stateNow.lastClassUnique = typeof resp.classUnique === "number" ? resp.classUnique : stateNow.lastClassUnique;
    stateNow.lastStatus = resp.status || stateNow.lastStatus;

    await setState(stateNow);

    // FIXED: Prioritize Red (Watchlist) over Green (Multiple Schedules).
    if (resp.watchHits && resp.watchHits.length) {
      showRedToast(resp.watchHits);
    } else if (resp.alertMultiple) {
      showGreenToast(stateNow.lastScheduleCount);
    }
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) tickOnce();
});

// ---------- Messages ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === "GET_STATE") {
    getState().then((state) => sendResponse({ state }));
    return true;
  }

  if (msg.type === "SET_STATE") {
    setState(msg.state || {}).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === "DISMISS_GLOBAL_TOAST") {
    if (!msg.toastKey || msg.toastKey !== currentToastKey) return;
    currentToastKey = null;
    broadcast("dismiss");
  }

  // These should work immediately (no alarm needed)
  if (msg.type === "TEST_TOAST_GREEN") {
    showGreenToast(2);
  }

  if (msg.type === "TEST_TOAST_RED") {
    showRedToast(["CS-TEST-001"]);
  }

  if (msg.type === "PING") {
    sendResponse({ ok: true });
  }
});