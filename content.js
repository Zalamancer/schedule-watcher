// content.js (runs on utdallas.collegescheduler.com)
// Merged with secondWindow UI overlay

(() => {
  const STORAGE_KEY = "schedule_ext_state_v31";

  // Your page elements
  const GENERATE_BUTTON_SELECTOR =
    '#schedules_panel button[aria-label="Generate Schedules"]';
  const GENERATE_BUTTON_FALLBACK_SELECTOR =
    "#schedules_panel > div.css-5ww2nx-actionsCss > button";

  const SCHEDULES_CONTAINER_SELECTOR = "#schedules_panel > div:nth-child(3)";
  const SCHEDULE_LINK_SELECTOR = 'a[aria-label^="View Schedule"]';
  const CLASS_CODE_SELECTOR = "span.css-1xfzt0l-columnCss-ScheduleColumn";

  const RELOAD_IF_MISSING_FOR_MS = 30000;
  const ALERT_COOLDOWN_MS = 60000;

  const local = {
    lastButtonSeenAt: Date.now(),
    lastClickAt: null,
    lastReloadAt: null,
    lastMultipleAlertAt: 0,
    lastWatchAlertAt: 0,
    lastStatus: "Starting…"
  };

  // ---------------- STATE ----------------
  async function getState() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const s = data[STORAGE_KEY] || {};
    return {
      enabled: typeof s.enabled === "boolean" ? s.enabled : true,
      watchlist: Array.isArray(s.watchlist) ? s.watchlist : [],
      hiddenColumns: Array.isArray(s.hiddenColumns) ? s.hiddenColumns : [],
      hidelist: Array.isArray(s.hidelist) ? s.hidelist : []
    };
  }

  async function setEnabled(enabled) {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const s = data[STORAGE_KEY] || {};
    s.enabled = enabled;
    await chrome.storage.local.set({ [STORAGE_KEY]: s });
  }

  async function setHiddenColumns(cols) {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const s = data[STORAGE_KEY] || {};
    s.hiddenColumns = cols;
    await chrome.storage.local.set({ [STORAGE_KEY]: s });
  }

  async function setHidelist(list) {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const s = data[STORAGE_KEY] || {};
    s.hidelist = list;
    await chrome.storage.local.set({ [STORAGE_KEY]: s });
  }

  // ---------------- HELPERS ----------------
  function formatTime(ts) {
    if (!ts) return "—";
    try {
      return new Date(ts).toLocaleTimeString();
    } catch {
      return "—";
    }
  }

  function isPageVisible() {
    return !document.hidden;
  }

  function hasFocus() {
    return document.hasFocus();
  }

  function findGenerateButton() {
    return (
      document.querySelector(GENERATE_BUTTON_SELECTOR) ||
      document.querySelector(GENERATE_BUTTON_FALLBACK_SELECTOR)
    );
  }

  function getContainer() {
    return document.querySelector(SCHEDULES_CONTAINER_SELECTOR);
  }

  function countSchedules() {
    const c = getContainer();
    if (!c) return 0;
    return c.querySelectorAll(SCHEDULE_LINK_SELECTOR).length;
  }

  function getClassCodesAll() {
    const c = getContainer();
    if (!c) return [];
    const elements = Array.from(c.querySelectorAll(CLASS_CODE_SELECTOR));
    const codes = [];
    for (const el of elements) {
      const text = (el.textContent || "").trim();
      if (!text) continue;
      // Split by comma if multiple classes are in one span
      const parts = text.split(",").map(p => p.trim()).filter(Boolean);
      codes.push(...parts);
    }
    return codes;
  }

  function countClasses() {
    const all = getClassCodesAll();
    const unique = new Set(all);
    return { total: all.length, unique: unique.size };
  }

  // Fuzzy matching helper
  // Fuzzy matching helper: order-independent and alphanumeric-only
  // "CS-1337-001" -> "0011337cs"
  // "1337 CS 001" -> "0011337cs"
  function normalizeCode(str) {
    const alphanumeric = String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    // Sort characters to make sequence irrelevant (e.g., CS 1337 vs 1337 CS)
    return alphanumeric.split("").sort().join("");
  }

  function getWatchHits(watchlist) {
    const wlEntries = (watchlist || []).map(normalizeCode).filter(Boolean);
    const wl = new Set(wlEntries);

    if (wl.size === 0) return [];

    const rawCodes = getClassCodesAll();
    const hits = [];
    const seenHits = new Set();

    for (const raw of rawCodes) {
      const norm = normalizeCode(raw);
      if (wl.has(norm) && !seenHits.has(norm)) {
        hits.push(raw);
        seenHits.add(norm);
      }
    }
    return hits;
  }

  function maybeReloadIfMissingTooLong() {
    const now = Date.now();
    if (now - local.lastButtonSeenAt > RELOAD_IF_MISSING_FOR_MS) {
      local.lastReloadAt = now;
      local.lastStatus = `Button missing > ${Math.round(RELOAD_IF_MISSING_FOR_MS / 1000)}s, reloading…`;
      updateUI();
      location.reload();
    }
  }

  function clickGenerateIfPresent() {
    const btn = findGenerateButton();
    if (btn) {
      local.lastButtonSeenAt = Date.now();
      if (!btn.disabled) {
        btn.click();
        local.lastClickAt = Date.now();
        local.lastStatus = "Clicked Generate Schedules";
        return "Clicked Generate Schedules";
      }
      local.lastStatus = "Generate button disabled";
      return "Generate button disabled";
    }
    local.lastStatus = "Generate button not found";
    return "Generate button not found";
  }

  // ---------------- COLUMN HIDING ----------------
  function getAvailableColumns() {
    const container = getContainer();
    if (!container) return [];

    // CollegeScheduler tables usually have th elements or div roles
    const headers = Array.from(container.querySelectorAll('th, [role="columnheader"]'));
    return headers.map((h, i) => ({
      index: i + 1,
      name: (h.textContent || `Col ${i + 1}`).trim()
    })).filter(c => c.name);
  }

  function applyColumnHiding(hiddenNames) {
    const styleId = "schedule-ext-hide-cols";
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      document.head.appendChild(style);
    }

    const available = getAvailableColumns();
    const rules = [];

    available.forEach(col => {
      if (hiddenNames.includes(col.name)) {
        // Hide the header and all cells in that column index
        rules.push(`#schedules_panel table th:nth-child(${col.index}), #schedules_panel table td:nth-child(${col.index}) { display: none !important; }`);
        rules.push(`#schedules_panel [role="grid"] [role="columnheader"]:nth-child(${col.index}), #schedules_panel [role="grid"] [role="gridcell"]:nth-child(${col.index}) { display: none !important; }`);
      }
    });

    style.textContent = rules.join("\n");
  }

  function applyClassHiding(hidelist) {
    const list = (hidelist || []).map(normalizeCode).filter(Boolean);
    if (list.length === 0) return;

    const container = getContainer();
    if (!container) return;

    const classSpans = Array.from(container.querySelectorAll(CLASS_CODE_SELECTOR));
    classSpans.forEach(span => {
      const text = (span.textContent || "").trim();
      const parts = text.split(",").map(p => p.trim()).filter(Boolean);

      const shouldHide = parts.some(p => list.includes(normalizeCode(p)));

      if (shouldHide) {
        // Try to find the container div or table row to hide
        // Usually it's a few levels up. We'll search for a reasonable parent.
        let parent = span.parentElement;
        let found = false;

        // Go up until we find something that looks like a row
        // In CollegeScheduler it's often a div with a specific role or class
        while (parent && parent !== container) {
          if (parent.tagName === "TR" || parent.getAttribute("role") === "row" || parent.style.display === "flex") {
            parent.style.display = "none";
            found = true;
            break;
          }
          parent = parent.parentElement;
        }

        // Fallback: hide the span itself if no clear row container found
        if (!found) span.style.display = "none";
      }
    });
  }

  // ---------------- UI OVERLAY ----------------
  const ui = {
    root: null,
    enabledDot: null,
    enabledText: null,
    visibleText: null,
    focusText: null,
    lastClickText: null,
    schedulesText: null,
    classesText: null,
    lastReloadText: null,
    statusText: null,
    columnsList: null,
    hideClassesInput: null,
    toggleBtn: null
  };

  function createUI() {
    if (document.getElementById("schedule-ext-overlay")) return;

    const root = document.createElement("div");
    root.id = "schedule-ext-overlay";
    root.style.cssText = `
      position: fixed;
      right: 12px;
      bottom: 12px;
      z-index: 2147483647;
      width: 320px;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.3;
      background: rgba(20,20,20,0.92);
      color: #fff;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.35);
      overflow: hidden;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 10px 8px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.05);
    `;

    const titleWrap = document.createElement("div");
    titleWrap.style.cssText = `display:flex; align-items:center; gap:8px;`;

    const dot = document.createElement("span");
    dot.style.cssText = `
      width: 10px;
      height: 10px;
      border-radius: 999px;
      display: inline-block;
      background: #3ddc84;
      box-shadow: 0 0 0 2px rgba(61,220,132,0.2);
    `;

    const title = document.createElement("div");
    title.textContent = "Schedule Helper";
    title.style.cssText = `font-weight: 600;`;

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.style.cssText = `
      width: 28px;
      height: 28px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(255,255,255,0.06);
      color: #fff;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    `;
    closeBtn.addEventListener("click", () => root.remove());

    titleWrap.appendChild(dot);
    titleWrap.appendChild(title);
    header.appendChild(titleWrap);
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.style.cssText = `padding: 10px; display: grid; gap: 8px;`;

    function row(label, valueId) {
      const r = document.createElement("div");
      r.style.cssText = `display:flex; justify-content:space-between; gap:10px;`;
      const l = document.createElement("div");
      l.textContent = label;
      l.style.cssText = `opacity: 0.85;`;
      const v = document.createElement("div");
      v.id = valueId;
      v.style.cssText = `font-variant-numeric: tabular-nums; text-align:right;`;
      r.appendChild(l);
      r.appendChild(v);
      return r;
    }

    body.appendChild(row("Active", "schedule-ext-enabled"));
    body.appendChild(row("Tab visible", "schedule-ext-visible"));
    body.appendChild(row("Tab focused", "schedule-ext-focused"));
    body.appendChild(row("Last click", "schedule-ext-lastclick"));
    body.appendChild(row("Schedules found", "schedule-ext-schedules"));
    body.appendChild(row("Classes found", "schedule-ext-classes"));
    body.appendChild(row("Last reload", "schedule-ext-lastreload"));

    const colHeader = document.createElement("div");
    colHeader.textContent = "Hide Columns:";
    colHeader.style.cssText = "margin-top: 4px; font-weight: 600; opacity: 0.9;";
    body.appendChild(colHeader);

    const columnsList = document.createElement("div");
    columnsList.id = "schedule-ext-columns";
    columnsList.style.cssText = "display: flex; flex-wrap: wrap; gap: 4px; max-height: 80px; overflow-y: auto; padding: 4px; background: rgba(255,255,255,0.05); border-radius: 6px;";
    body.appendChild(columnsList);

    const hideHeader = document.createElement("div");
    hideHeader.textContent = "Hide Classes (codes, one per line):";
    hideHeader.style.cssText = "margin-top: 8px; font-weight: 600; opacity: 0.9;";
    body.appendChild(hideHeader);

    const hideClassesInput = document.createElement("textarea");
    hideClassesInput.id = "schedule-ext-hidelist";
    hideClassesInput.placeholder = "e.g. CS-1337-001\n4341-CS-003";
    hideClassesInput.style.cssText = "width: 100%; height: 50px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #fff; font-family: monospace; font-size: 11px; padding: 6px; resize: none; outline: none;";

    // Auto-save logic
    let saveTimeout = null;
    hideClassesInput.addEventListener("input", () => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(async () => {
        const lines = hideClassesInput.value.split("\n").map(l => l.trim()).filter(Boolean);
        await setHidelist(lines);
        local.lastStatus = `Saved hidelist (${lines.length})`;
        updateUI();
      }, 800);
    });
    body.appendChild(hideClassesInput);

    const footer = document.createElement("div");
    footer.style.cssText = `
      padding: 10px;
      border-top: 1px solid rgba(255,255,255,0.12);
      display: grid;
      gap: 8px;
      background: rgba(255,255,255,0.03);
    `;

    const status = document.createElement("div");
    status.id = "schedule-ext-status";
    status.style.cssText = `opacity: 0.9;`;

    const controls = document.createElement("div");
    controls.style.cssText = `display:flex; gap:8px;`;

    const toggleBtn = document.createElement("button");
    toggleBtn.style.cssText = `
      flex: 1;
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(255,255,255,0.08);
      color: #fff;
      cursor: pointer;
      font-weight: 600;
    `;

    const clickNowBtn = document.createElement("button");
    clickNowBtn.textContent = "Click now";
    clickNowBtn.style.cssText = `
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(255,255,255,0.08);
      color: #fff;
      cursor: pointer;
      font-weight: 600;
    `;
    clickNowBtn.addEventListener("click", async () => {
      const state = await getState();
      if (!state.enabled) return;
      clickGenerateIfPresent();
      updateUI();
    });

    toggleBtn.addEventListener("click", async () => {
      const state = await getState();
      const newEnabled = !state.enabled;
      await setEnabled(newEnabled);
      local.lastStatus = newEnabled ? "Enabled" : "Paused";
      updateUI();
    });

    controls.appendChild(toggleBtn);
    controls.appendChild(clickNowBtn);

    footer.appendChild(status);
    footer.appendChild(controls);

    root.appendChild(header);
    root.appendChild(body);
    root.appendChild(footer);
    document.documentElement.appendChild(root);

    // Save references
    ui.root = root;
    ui.enabledDot = dot;
    ui.enabledText = document.getElementById("schedule-ext-enabled");
    ui.visibleText = document.getElementById("schedule-ext-visible");
    ui.focusText = document.getElementById("schedule-ext-focused");
    ui.lastClickText = document.getElementById("schedule-ext-lastclick");
    ui.schedulesText = document.getElementById("schedule-ext-schedules");
    ui.classesText = document.getElementById("schedule-ext-classes");
    ui.lastReloadText = document.getElementById("schedule-ext-lastreload");
    ui.statusText = document.getElementById("schedule-ext-status");
    ui.columnsList = document.getElementById("schedule-ext-columns");
    ui.hideClassesInput = document.getElementById("schedule-ext-hidelist");
    ui.toggleBtn = toggleBtn;

    updateUI();
  }

  async function updateUI() {
    if (!ui.root) return;

    const state = await getState();
    const enabled = state.enabled;
    const hidden = state.hiddenColumns || [];
    const hidelist = state.hidelist || [];

    applyColumnHiding(hidden);
    applyClassHiding(hidelist);

    ui.enabledDot.style.background = enabled ? "#3ddc84" : "#ff5c5c";
    ui.enabledDot.style.boxShadow = enabled
      ? "0 0 0 2px rgba(61,220,132,0.2)"
      : "0 0 0 2px rgba(255,92,92,0.2)";

    ui.enabledText.textContent = enabled ? "Yes" : "No";
    ui.visibleText.textContent = isPageVisible() ? "Yes" : "No";
    ui.focusText.textContent = hasFocus() ? "Yes" : "No";
    ui.lastClickText.textContent = formatTime(local.lastClickAt);

    ui.schedulesText.textContent = String(countSchedules());

    const cls = countClasses();
    ui.classesText.textContent = `${cls.total} (unique ${cls.unique})`;

    ui.lastReloadText.textContent = formatTime(local.lastReloadAt);
    ui.statusText.textContent = local.lastStatus || "—";

    ui.toggleBtn.textContent = enabled ? "Pause" : "Resume";

    // Update columns list if table is present
    const available = getAvailableColumns();
    if (available.length > 0) {
      // Small optimization: only redraw if counts differ or not yet drawn
      if (ui.columnsList.children.length !== available.length) {
        ui.columnsList.innerHTML = "";
        available.forEach(col => {
          const label = document.createElement("label");
          label.style.cssText = "display: flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; cursor: pointer; font-size: 11px; white-space: nowrap;";

          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = !hidden.includes(col.name);
          cb.style.margin = "0";
          cb.addEventListener("change", async () => {
            const currentState = await getState();
            let newHidden = currentState.hiddenColumns || [];
            if (!cb.checked) {
              if (!newHidden.includes(col.name)) newHidden.push(col.name);
            } else {
              newHidden = newHidden.filter(n => n !== col.name);
            }
            await setHiddenColumns(newHidden);
            updateUI();
          });

          label.appendChild(cb);
          label.appendChild(document.createTextNode(col.name));
          ui.columnsList.appendChild(label);
        });
      } else {
        // Sync checkboxes without redrawing
        Array.from(ui.columnsList.querySelectorAll("input")).forEach((cb, i) => {
          const colName = available[i].name;
          cb.checked = !hidden.includes(colName);
        });
      }
    } else {
      ui.columnsList.textContent = "No table columns detected";
      ui.columnsList.style.fontSize = "11px";
      ui.columnsList.style.opacity = "0.6";
      ui.columnsList.style.padding = "8px";
    }

    // Sync hidelist input if not focused
    if (document.activeElement !== ui.hideClassesInput) {
      ui.hideClassesInput.value = hidelist.join("\n");
    }
  }

  // ---------------- MUTATION OBSERVER ----------------
  const observer = new MutationObserver(() => {
    updateUI();
  });

  function startObserver() {
    const panel = document.querySelector("#schedules_panel");
    if (!panel) return false;
    observer.observe(panel, { childList: true, subtree: true });
    return true;
  }

  // Update visibility/focus indicators on changes
  document.addEventListener("visibilitychange", updateUI);
  window.addEventListener("focus", updateUI);
  window.addEventListener("blur", updateUI);

  // ---------------- MESSAGE HANDLER ----------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;

    if (msg.type === "DO_CLICK_AND_SCAN") {
      (async () => {
        const hasPanel = !!document.querySelector("#schedules_panel");
        if (!hasPanel) {
          sendResponse({
            status: "No schedules panel on this page",
            scheduleCount: 0,
            classTotal: 0,
            classUnique: 0,
            lastClickAt: local.lastClickAt,
            lastReloadAt: local.lastReloadAt,
            alertMultiple: false,
            watchHits: []
          });
          return;
        }

        const state = await getState();
        if (!state.enabled) {
          const cls = countClasses();
          local.lastStatus = "Paused";
          updateUI();
          sendResponse({
            status: "Paused",
            scheduleCount: countSchedules(),
            classTotal: cls.total,
            classUnique: cls.unique,
            lastClickAt: local.lastClickAt,
            lastReloadAt: local.lastReloadAt,
            alertMultiple: false,
            watchHits: []
          });
          return;
        }

        const status = clickGenerateIfPresent();
        const scheduleCount = countSchedules();
        const cls = countClasses();

        const now = Date.now();

        let alertMultiple = false;
        if (scheduleCount > 1 && now - local.lastMultipleAlertAt > ALERT_COOLDOWN_MS) {
          local.lastMultipleAlertAt = now;
          alertMultiple = true;
        }

        let watchHits = [];
        const hits = getWatchHits(state.watchlist);

        if (hits.length > 0) {
          if (now - local.lastWatchAlertAt > ALERT_COOLDOWN_MS) {
            local.lastWatchAlertAt = now;
            watchHits = hits;
          }
        }

        maybeReloadIfMissingTooLong();
        updateUI();

        sendResponse({
          status,
          scheduleCount,
          classTotal: cls.total,
          classUnique: cls.unique,
          lastClickAt: local.lastClickAt,
          lastReloadAt: local.lastReloadAt,
          alertMultiple,
          watchHits
        });
      })();

      return true;
    }
  });

  // ---------------- INIT ----------------
  (async () => {
    createUI();

    // Start observer once schedules panel exists
    const observerStartTimer = setInterval(() => {
      if (startObserver()) clearInterval(observerStartTimer);
    }, 1000);

    updateUI();
  })();
})();