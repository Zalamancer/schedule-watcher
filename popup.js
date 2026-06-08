const STORAGE_KEY = "schedule_ext_state_v31";

function formatTime(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleTimeString(); } catch { return "—"; }
}

function normalizeWatchlist(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set();
  const out = [];
  for (const x of lines) {
    if (!seen.has(x)) { seen.add(x); out.push(x); }
  }
  return out;
}

async function getState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || null;
}

async function setState(next) {
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

async function fetchFromBackground() {
  return await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (resp) => resolve(resp?.state || null));
  });
}

async function pushToBackground(state) {
  return await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "SET_STATE", state }, (resp) => resolve(resp?.ok));
  });
}

async function render() {
  // Ask background for state (more reliable than reading storage directly)
  const s = await fetchFromBackground();

  // If something is very wrong, show it
  if (!s) {
    document.getElementById("statusMsg").textContent = "No state (reload extension)";
    return;
  }

  document.getElementById("enabled").textContent = s.enabled ? "Active" : "Paused";
  document.getElementById("toggle").textContent = s.enabled ? "Pause" : "Resume";

  document.getElementById("lastClick").textContent = formatTime(s.lastClickAt);
  document.getElementById("lastReload").textContent = formatTime(s.lastReloadAt);

  document.getElementById("scheduleCount").textContent =
    typeof s.lastScheduleCount === "number" ? String(s.lastScheduleCount) : "0";

  const classStr =
    `${s.lastClassTotal ?? 0} (unique ${s.lastClassUnique ?? 0})`;
  document.getElementById("classCount").textContent = classStr;

  document.getElementById("statusMsg").textContent = s.lastStatus || "—";

  document.getElementById("watchlist").value = (s.watchlist || []).join("\n");
  document.getElementById("hidelist").value = (s.hidelist || []).join("\n");
  document.getElementById("targetContains").value =
    s.targetUrlContains || "utdallas.collegescheduler.com/terms/2026%20Spring/options";

  document.getElementById("toggle").onclick = async () => {
    const next = await fetchFromBackground();
    next.enabled = !next.enabled;
    next.lastStatus = next.enabled ? "Resumed" : "Paused";
    await pushToBackground(next);
    render();
  };

  document.getElementById("clear").onclick = async () => {
    const next = await fetchFromBackground();
    next.lastClickAt = null;
    next.lastReloadAt = null;
    next.lastScheduleCount = 0;
    next.lastClassTotal = 0;
    next.lastClassUnique = 0;
    next.lastStatus = "Cleared stats";
    await pushToBackground(next);
    render();
  };

  document.getElementById("saveWatchlist").onclick = async () => {
    const next = await fetchFromBackground();
    next.watchlist = normalizeWatchlist(document.getElementById("watchlist").value);
    next.lastStatus = `Saved watchlist (${next.watchlist.length})`;
    await pushToBackground(next);
    render();
  };

  document.getElementById("saveHidelist").onclick = async () => {
    const next = await fetchFromBackground();
    next.hidelist = normalizeWatchlist(document.getElementById("hidelist").value);
    next.lastStatus = `Saved hidelist (${next.hidelist.length})`;
    await pushToBackground(next);
    render();
  };

  document.getElementById("saveTarget").onclick = async () => {
    const next = await fetchFromBackground();
    next.targetUrlContains = document.getElementById("targetContains").value.trim()
      || "utdallas.collegescheduler.com/terms/2026%20Spring/options";
    next.lastStatus = `Saved target contains`;
    await pushToBackground(next);
    render();
  };

  document.getElementById("testGreen").onclick = () => {
    chrome.runtime.sendMessage({ type: "TEST_TOAST_GREEN" });
  };
  document.getElementById("testRed").onclick = () => {
    chrome.runtime.sendMessage({ type: "TEST_TOAST_RED" });
  };
}

render();
