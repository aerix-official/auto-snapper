// overlay.js
// Injects an Auto Snapper control panel directly into web.snapchat.com so
// users can Start / Stop / pick a config without opening the toolbar popup.
// Loaded after content.js. Lives inside a shadow root so Snapchat's CSS
// can't leak in or out.

(function () {
  if (window.__autoSnapperOverlayInstalled) return;
  window.__autoSnapperOverlayInstalled = true;

  const VISIBLE_KEY = "overlayVisible";
  const COLLAPSED_KEY = "overlayCollapsed";
  const POSITION_KEY = "overlayPosition";

  // ---------- waiting for body ----------
  function whenBodyReady(cb) {
    if (document.body) return cb();
    const obs = new MutationObserver(() => {
      if (document.body) {
        obs.disconnect();
        cb();
      }
    });
    obs.observe(document.documentElement, { childList: true });
  }

  whenBodyReady(init);

  async function init() {
    const visible = await readSetting(VISIBLE_KEY, true);
    if (!visible) return; // user chose to hide it

    const host = document.createElement("div");
    host.id = "auto-snapper-overlay-host";
    host.style.cssText =
      "position:fixed; top:80px; right:20px; z-index:2147483647; pointer-events:none;";
    document.body.appendChild(host);

    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = TEMPLATE;
    const $ = (sel) => root.querySelector(sel);
    const all = (sel) => [...root.querySelectorAll(sel)];

    // Re-enable pointer events only on the actual panel (not the wrapper).
    $(".panel").style.pointerEvents = "auto";

    // ---------- restore position + collapsed state ----------
    const pos = await readSetting(POSITION_KEY, null);
    if (pos && typeof pos.right === "number" && typeof pos.top === "number") {
      host.style.right = pos.right + "px";
      host.style.top = pos.top + "px";
    }
    const collapsedStart = await readSetting(COLLAPSED_KEY, false);
    if (collapsedStart) $(".panel").classList.add("collapsed");

    // ---------- collapse toggle ----------
    $(".collapse-btn").addEventListener("click", async () => {
      const c = $(".panel").classList.toggle("collapsed");
      await writeSetting(COLLAPSED_KEY, c);
    });

    // ---------- close (hide entirely) ----------
    $(".close-btn").addEventListener("click", async () => {
      await writeSetting(VISIBLE_KEY, false);
      host.remove();
      window.__autoSnapperOverlayInstalled = false;
    });

    // ---------- drag (header) ----------
    let drag = null;
    $(".header").addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const rect = host.getBoundingClientRect();
      drag = {
        startX: e.clientX,
        startY: e.clientY,
        startRight: window.innerWidth - rect.right,
        startTop: rect.top,
      };
      $(".header").setPointerCapture(e.pointerId);
    });
    $(".header").addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const newRight = Math.max(0, Math.min(window.innerWidth - 100, drag.startRight - dx));
      const newTop = Math.max(0, Math.min(window.innerHeight - 40, drag.startTop + dy));
      host.style.right = newRight + "px";
      host.style.top = newTop + "px";
    });
    $(".header").addEventListener("pointerup", async (e) => {
      if (drag) {
        const rect = host.getBoundingClientRect();
        await writeSetting(POSITION_KEY, {
          right: window.innerWidth - rect.right,
          top: rect.top,
        });
        drag = null;
      }
    });

    // ---------- populate config dropdown + restore last values ----------
    async function refreshConfigs() {
      const r = await chrome.storage.local.get([
        "configs",
        "autoSnapperRunCount",
        "autoSnapperRunInterval",
        "autoSnapperRunUnlimited",
        "autoSnapperRunJitter",
        "autoSnapperRunConfigName",
      ]);
      const sel = $(".config-select");
      const configs = r.configs || [];
      sel.innerHTML = "";
      if (configs.length === 0) {
        sel.appendChild(opt("(no configs)", ""));
        $(".start-btn").disabled = true;
      } else {
        for (const c of configs) {
          const o = opt(`● ${c.name} (${c.recipients.length})`, c.name);
          o.style.color = c.color || "#fffc00";
          sel.appendChild(o);
        }
        if (r.autoSnapperRunConfigName) sel.value = r.autoSnapperRunConfigName;
        $(".start-btn").disabled = false;
      }
      if (r.autoSnapperRunCount != null) $(".count").value = r.autoSnapperRunCount;
      if (r.autoSnapperRunInterval != null) $(".interval").value = r.autoSnapperRunInterval;
      if (r.autoSnapperRunJitter != null) $(".jitter").value = r.autoSnapperRunJitter;
      const unlim = !!r.autoSnapperRunUnlimited;
      $(".unlimited-cb").checked = unlim;
      $(".count").disabled = unlim;
    }
    refreshConfigs();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.configs) refreshConfigs();
    });

    // Persist input changes so reload doesn't lose them.
    $(".config-select").addEventListener("change", () =>
      writeSetting("autoSnapperRunConfigName", $(".config-select").value)
    );
    $(".count").addEventListener("change", () =>
      writeSetting("autoSnapperRunCount", parseInt($(".count").value, 10) || 1)
    );
    $(".interval").addEventListener("change", () =>
      writeSetting("autoSnapperRunInterval", parseInt($(".interval").value, 10) || 800)
    );
    $(".jitter").addEventListener("change", () =>
      writeSetting("autoSnapperRunJitter", parseInt($(".jitter").value, 10) || 0)
    );
    $(".unlimited-cb").addEventListener("change", async () => {
      const on = $(".unlimited-cb").checked;
      $(".count").disabled = on;
      await writeSetting("autoSnapperRunUnlimited", on);
    });

    // ---------- anti-detection / mode toggles ----------
    // These share keys with the popup so the two UIs stay in sync.
    async function refreshToggles() {
      const r = await chrome.storage.local.get([
        "captionEnabled",
        "interleaveOpensEnabled",
        "interleaveOpensEveryN",
        "pingPongEnabled",
        "pingPongWaitSeconds",
      ]);
      $("#ovl-caption-enabled").checked = !!r.captionEnabled;
      $("#ovl-interleave-enabled").checked = !!r.interleaveOpensEnabled;
      $(".interleave-every").value = String(r.interleaveOpensEveryN ?? 10);
      $("#ovl-pingpong-enabled").checked = !!r.pingPongEnabled;
      $(".pingpong-wait").value = String(r.pingPongWaitSeconds ?? 60);
    }
    refreshToggles();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (
        changes.captionEnabled ||
        changes.interleaveOpensEnabled ||
        changes.interleaveOpensEveryN ||
        changes.pingPongEnabled ||
        changes.pingPongWaitSeconds
      ) refreshToggles();
    });

    $("#ovl-caption-enabled").addEventListener("change", () =>
      writeSetting("captionEnabled", $("#ovl-caption-enabled").checked)
    );
    $("#ovl-interleave-enabled").addEventListener("change", () =>
      writeSetting("interleaveOpensEnabled", $("#ovl-interleave-enabled").checked)
    );
    $(".interleave-every").addEventListener("change", () => {
      const n = Math.max(1, Math.min(100, parseInt($(".interleave-every").value, 10) || 10));
      $(".interleave-every").value = String(n);
      writeSetting("interleaveOpensEveryN", n);
    });
    $("#ovl-pingpong-enabled").addEventListener("change", () =>
      writeSetting("pingPongEnabled", $("#ovl-pingpong-enabled").checked)
    );
    $(".pingpong-wait").addEventListener("change", () => {
      const n = Math.max(5, Math.min(600, parseInt($(".pingpong-wait").value, 10) || 60));
      $(".pingpong-wait").value = String(n);
      writeSetting("pingPongWaitSeconds", n);
    });

    // ---------- mode tabs (Send / Open) ----------
    function switchMode(mode) {
      all(".mode-tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
      all(".mode-body").forEach((b) => (b.style.display = b.dataset.modeBody === mode ? "" : "none"));
      writeSetting("overlayMode", mode);
      if (mode === "open") refreshOpenInfo();
    }
    all(".mode-tab").forEach((t) => t.addEventListener("click", () => switchMode(t.dataset.mode)));
    readSetting("overlayMode", "send").then((m) => switchMode(m));

    // ---------- Open mode: load saved selection + dwell ----------
    async function refreshOpenInfo() {
      const r = await chrome.storage.local.get(["autoOpenList", "autoOpenDwell"]);
      const list = r.autoOpenList || [];
      $(".open-count").textContent = list.length === 0
        ? "No friends selected"
        : `${list.length} friend${list.length === 1 ? "" : "s"} selected`;
      $(".open-empty-hint").style.display = list.length === 0 ? "" : "none";
      if (typeof r.autoOpenDwell === "number") $(".open-dwell").value = r.autoOpenDwell;
      const startBtn = $(".open-start-btn");
      startBtn.dataset.hasList = list.length > 0 ? "true" : "false";
      // Re-evaluate disabled state via setRunningUI's logic.
      const isRunning = $(".status-pill").classList.contains("running");
      startBtn.disabled = isRunning || list.length === 0;
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && (changes.autoOpenList || changes.autoOpenDwell)) refreshOpenInfo();
    });

    $(".open-dwell").addEventListener("change", () => {
      const v = Math.max(500, parseInt($(".open-dwell").value, 10) || 4000);
      $(".open-dwell").value = v;
      writeSetting("autoOpenDwell", v);
    });

    $(".open-start-btn").addEventListener("click", async () => {
      const r = await chrome.storage.local.get(["autoOpenList"]);
      const users = r.autoOpenList || [];
      if (!users.length) return;
      const snapDwellMs = Math.max(500, parseInt($(".open-dwell").value, 10) || 4000);
      const api = window.__autoSnapperAPI;
      if (!api) {
        $(".log").textContent = "Auto Snapper content script not ready. Refresh the page?";
        return;
      }
      const result = api.open({ users, snapDwellMs });
      if (result && result.ok === false) {
        $(".log").textContent = "Open failed: " + (result.error || "unknown");
        return;
      }
      setRunningUI(true);
    });

    $(".open-stop-btn").addEventListener("click", () => {
      setRunningUI(false);
      window.__autoSnapperAPI?.stop();
    });

    // ---------- start / stop / reset ----------
    $(".start-btn").addEventListener("click", async () => {
      const r = await chrome.storage.local.get([
        "configs", "friendsAliases",
        "captionEnabled", "captionPool",
        "interleaveOpensEnabled", "interleaveOpensEveryN", "autoOpenDwell",
        "pingPongEnabled", "pingPongWaitSeconds",
      ]);
      const cfg = (r.configs || []).find((c) => c.name === $(".config-select").value);
      if (!cfg) return;
      const unlimited = $(".unlimited-cb").checked;
      const count = unlimited ? 0 : Math.max(1, parseInt($(".count").value, 10) || 1);
      const intervalMs = Math.max(0, parseInt($(".interval").value, 10) || 800);
      const jitterPct = Math.max(0, Math.min(100, parseInt($(".jitter").value, 10) || 0));

      // Anti-detection settings live in storage (managed by the popup UI).
      const captionPool = r.captionEnabled && Array.isArray(r.captionPool) && r.captionPool.length
        ? r.captionPool : null;
      const interleaveOpens = r.interleaveOpensEnabled
        ? {
            everyN: Math.max(1, parseInt(r.interleaveOpensEveryN, 10) || 10),
            snapDwellMs: Math.max(500, parseInt(r.autoOpenDwell, 10) || 4000),
          }
        : null;
      const pingPong = r.pingPongEnabled
        ? {
            waitTimeoutMs: Math.max(5000, (parseInt(r.pingPongWaitSeconds, 10) || 60) * 1000),
            snapDwellMs: Math.max(500, parseInt(r.autoOpenDwell, 10) || 4000),
          }
        : null;

      const expandedRecipients = cfg.recipients.map((saved) => {
        let canonical = saved;
        for (const [c, list] of Object.entries(r.friendsAliases || {})) {
          if (list.includes(saved)) { canonical = c; break; }
        }
        const aliases = r.friendsAliases?.[canonical] || [];
        const candidates = [...new Set([canonical, saved, ...aliases])].filter(Boolean);
        return { primary: saved, candidates };
      });

      setRunningUI(true);
      // Call the content script's direct API — both scripts share the same
      // page context, so this is a synchronous local call (no chrome.runtime
      // round-trip).
      const api = window.__autoSnapperAPI;
      if (!api) {
        $(".log").textContent = "Auto Snapper content script not ready. Refresh the page?";
        setRunningUI(false);
        return;
      }
      api.run({
        recipients: expandedRecipients,
        count, intervalMs, unlimited, jitterPct,
        captionPool, interleaveOpens, pingPong,
      });
    });

    $(".stop-btn").addEventListener("click", () => {
      setRunningUI(false);
      window.__autoSnapperAPI?.stop();
    });

    // Bind reset to BOTH reset buttons (one per mode body).
    all(".reset-btn").forEach((b) =>
      b.addEventListener("click", async () => {
        try { await window.__autoSnapperAPI?.goHome(); } catch {}
      })
    );

    // ---------- status + log polling ----------
    function setRunningUI(running) {
      const pill = $(".status-pill");
      pill.classList.toggle("running", running);
      pill.classList.toggle("idle", !running);
      pill.textContent = running ? "running" : "idle";
      $(".start-btn").disabled = running;
      $(".stop-btn").disabled = !running;
      // Open-mode buttons share the same lock.
      const openStart = $(".open-start-btn");
      const openStop = $(".open-stop-btn");
      if (openStart) {
        // Only enable Open ▶ if we're idle AND have a saved selection.
        const hasList = openStart.dataset.hasList === "true";
        openStart.disabled = running || !hasList;
      }
      if (openStop) openStop.disabled = !running;
    }
    setRunningUI(false);

    function refreshStatusAndLog() {
      const r = window.__autoSnapperAPI?.status();
      if (!r?.ok) return;
      setRunningUI(!!r.running);
      const lines = (r.log || []).slice(-6);
      $(".log").textContent = lines.join("\n");
    }
    refreshStatusAndLog();
    setInterval(refreshStatusAndLog, 600);

    // Push notifications from content.js's runLoop "loop-ended".
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "loop-ended") {
        setRunningUI(false);
        refreshStatusAndLog();
      }
    });
  }

  // ---------- helpers ----------
  function opt(text, value) {
    const o = document.createElement("option");
    o.textContent = text;
    if (value !== undefined) o.value = value;
    return o;
  }
  async function readSetting(key, def) {
    const r = await chrome.storage.local.get(key);
    return r[key] === undefined ? def : r[key];
  }
  async function writeSetting(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }

  // ---------- template ----------
  const TEMPLATE = `
    <style>
      :host { all: initial; }
      .panel {
        font: 12px/1.4 -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
        color: #f4f4f8;
        background: rgba(18, 18, 24, 0.92);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 14px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03) inset;
        width: 280px;
        overflow: hidden;
        user-select: none;
      }
      .header {
        display: flex; align-items: center; gap: 8px;
        padding: 9px 12px;
        background: linear-gradient(180deg, rgba(255,252,0,0.08), transparent);
        border-bottom: 1px solid rgba(255,255,255,0.06);
        cursor: grab;
      }
      .header:active { cursor: grabbing; }
      .logo {
        width: 22px; height: 22px;
        border-radius: 7px;
        background: linear-gradient(135deg, #fffc00, #ffd400);
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        box-shadow: 0 0 12px rgba(255, 252, 0, 0.4);
      }
      .logo svg { width: 14px; height: 14px; }
      .title {
        font-weight: 800; font-size: 12px; flex: 1;
        letter-spacing: -0.01em;
      }
      .status-pill {
        font-size: 9.5px; font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 2px 8px;
        border-radius: 999px;
        display: inline-flex; align-items: center; gap: 5px;
      }
      .status-pill::before {
        content: ""; width: 5px; height: 5px; border-radius: 50%;
      }
      .status-pill.idle {
        color: #8a8b94;
        background: rgba(255,255,255,0.06);
      }
      .status-pill.idle::before { background: #5b5c64; }
      .status-pill.running {
        color: #0a0a0c; background: #fffc00;
        box-shadow: 0 0 12px rgba(255,252,0,0.5);
      }
      .status-pill.running::before { background: #0a0a0c; animation: pulse 1.2s ease-in-out infinite; }
      @keyframes pulse {
        0%,100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.5); opacity: 0.5; }
      }
      .header-btns { display: flex; gap: 2px; flex-shrink: 0; }
      .header-btns button {
        background: transparent; border: 0; color: #8a8b94;
        cursor: pointer; padding: 2px 6px; border-radius: 4px;
        font-size: 13px; line-height: 1;
        transition: background 100ms, color 100ms;
      }
      .header-btns button:hover { background: rgba(255,255,255,0.08); color: #fff; }

      .body {
        padding: 10px 12px 12px;
        display: flex; flex-direction: column; gap: 8px;
        max-height: 380px; overflow: auto;
      }
      .panel.collapsed .body { display: none; }
      .panel.collapsed .mode-tabs { display: none; }
      .panel.collapsed { width: 280px; }

      .mode-tabs {
        display: flex;
        background: rgba(0,0,0,0.25);
        border-bottom: 1px solid rgba(255,255,255,0.06);
      }
      .mode-tabs button {
        flex: 1;
        padding: 8px;
        border: 0;
        background: transparent;
        color: #8a8b94;
        cursor: pointer;
        font: inherit; font-weight: 700; font-size: 11px;
        letter-spacing: 0.04em;
        position: relative;
        transition: color 100ms;
      }
      .mode-tabs button:hover { color: #cfd0d6; }
      .mode-tabs button.active { color: #fffc00; }
      .mode-tabs button.active::after {
        content: "";
        position: absolute; left: 50%; bottom: -1px; transform: translateX(-50%);
        width: 24px; height: 2px;
        background: #fffc00;
        border-radius: 2px 2px 0 0;
        box-shadow: 0 0 6px #fffc00;
      }

      .open-info {
        background: rgba(255, 252, 0, 0.06);
        border: 1px solid rgba(255, 252, 0, 0.18);
        border-radius: 8px;
        padding: 10px;
        display: flex; flex-direction: column; gap: 4px;
      }
      .open-count {
        font-weight: 700;
        color: #fffc00;
        font-size: 12px;
      }
      .open-empty-hint {
        font-size: 10.5px;
        color: #8a8b94;
        line-height: 1.4;
      }

      .footer-credit {
        padding: 6px 12px 8px;
        text-align: center;
        font-size: 9.5px;
        color: #5b5c64;
        border-top: 1px solid rgba(255,255,255,0.04);
        letter-spacing: 0.04em;
      }
      .footer-credit strong {
        color: #fffc00;
        font-weight: 700;
      }
      .panel.collapsed .footer-credit { display: none; }

      label.field-label {
        font-size: 9px; color: #8a8b94;
        text-transform: uppercase; letter-spacing: 0.08em;
        font-weight: 700;
        display: block; margin-bottom: 3px;
      }
      input, select {
        width: 100%;
        padding: 6px 8px;
        background: #0e0e12;
        color: #f4f4f8;
        border: 1px solid #2a2a31;
        border-radius: 6px;
        font: inherit; font-size: 12px;
        transition: border-color 100ms, box-shadow 100ms;
      }
      input:focus, select:focus {
        outline: none;
        border-color: #fffc00;
        box-shadow: 0 0 0 3px rgba(255,252,0,0.18);
      }
      input:disabled { opacity: 0.4; }
      .count-row { display: flex; gap: 6px; }
      .count-row input { flex: 1; }
      .unlimited-toggle {
        display: inline-flex; align-items: center; justify-content: center;
        width: 32px; height: 28px;
        background: #0e0e12;
        border: 1px solid #2a2a31;
        border-radius: 6px;
        cursor: pointer;
        flex-shrink: 0;
        transition: 100ms;
      }
      .unlimited-toggle input { display: none; }
      .unlimited-toggle span { font-weight: 700; color: #8a8b94; line-height: 1; }
      .unlimited-toggle:has(input:checked) {
        background: linear-gradient(180deg, #fffc00, #ffd400);
        border-color: #ffd400;
      }
      .unlimited-toggle:has(input:checked) span { color: #0a0a0c; }

      .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .row { display: flex; gap: 6px; }

      /* Anti-detection / mode toggles — compact rows with checkbox + label
         + optional inline numeric input. Same source-of-truth as the popup
         (chrome.storage.local), so changes here persist across reloads and
         show up in both UIs. */
      .toggle-block {
        margin-top: 2px;
        display: flex; flex-direction: column; gap: 5px;
        padding: 8px 9px;
        background: rgba(255,255,255,0.025);
        border: 1px solid rgba(255,255,255,0.05);
        border-radius: 7px;
      }
      .toggle-row {
        display: flex; align-items: center; gap: 7px;
        font-size: 11px; color: #cfd0d6;
        line-height: 1.2;
      }
      .toggle-row input[type="checkbox"] {
        width: 13px; height: 13px;
        accent-color: #fffc00;
        margin: 0; flex-shrink: 0; cursor: pointer;
      }
      .toggle-row .toggle-label {
        flex: 1; min-width: 0;
        cursor: pointer;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .toggle-row input.inline {
        width: 44px;
        padding: 3px 5px;
        font-size: 11px;
        flex-shrink: 0;
      }
      .toggle-row .suffix {
        font-size: 10px; color: #8a8b94;
        flex-shrink: 0;
      }
      .toggle-note {
        margin-top: 2px;
        font-size: 9.5px; color: #6c6d75;
        line-height: 1.35;
      }

      button.btn {
        flex: 1;
        padding: 7px 10px;
        border: 1px solid #2a2a31;
        border-radius: 6px;
        background: #1a1a1f;
        color: #f4f4f8;
        font: inherit; font-weight: 700; font-size: 12px;
        cursor: pointer;
        transition: 100ms;
        line-height: 1;
      }
      button.btn:hover:not(:disabled) { background: #25252e; border-color: #3a3a44; }
      button.btn:disabled { opacity: 0.4; cursor: not-allowed; }
      button.btn.primary {
        background: linear-gradient(180deg, #fffc00, #ffd400);
        color: #0a0a0c;
        border-color: #ffd400;
        box-shadow: 0 0 14px rgba(255,252,0,0.25);
      }
      button.btn.primary:hover:not(:disabled) {
        filter: brightness(1.08);
        box-shadow: 0 0 18px rgba(255,252,0,0.4);
      }
      button.btn.danger {
        background: linear-gradient(180deg, #ff5b78, #e93757);
        color: #fff; border-color: #d63752;
      }
      button.btn.icon {
        flex: 0 0 auto; padding: 7px 10px; font-size: 14px;
      }

      .log {
        margin-top: 4px;
        max-height: 90px;
        overflow: auto;
        background: rgba(0,0,0,0.4);
        border: 1px solid #2a2a31;
        border-radius: 6px;
        padding: 6px 8px;
        font: 10.5px/1.5 ui-monospace, "SF Mono", Menlo, monospace;
        color: #cfd0d6;
        white-space: pre-wrap;
      }
    </style>
    <div class="panel">
      <div class="header">
        <span class="logo">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="#0a0a0c" stroke-width="2"/>
            <circle cx="12" cy="12" r="4" fill="#0a0a0c"/>
            <path d="M12 3v3M21 12h-3M12 21v-3M3 12h3" stroke="#0a0a0c" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </span>
        <span class="title">Auto Snapper</span>
        <span class="status-pill idle">idle</span>
        <span class="header-btns">
          <button class="collapse-btn" title="Collapse / expand">⏶</button>
          <button class="close-btn" title="Hide overlay (re-enable from popup)">✕</button>
        </span>
      </div>
      <div class="mode-tabs">
        <button class="mode-tab active" data-mode="send">Send</button>
        <button class="mode-tab" data-mode="open">Open</button>
      </div>
      <div class="body">
        <!-- Send mode -->
        <div class="mode-body" data-mode-body="send">
          <div>
            <label class="field-label">Configuration</label>
            <select class="config-select"></select>
          </div>
          <div class="grid2">
            <div>
              <label class="field-label">Snaps</label>
              <div class="count-row">
                <input class="count" type="number" min="1" value="1" />
                <label class="unlimited-toggle" title="Run until you click Stop">
                  <input class="unlimited-cb" type="checkbox" />
                  <span>∞</span>
                </label>
              </div>
            </div>
            <div>
              <label class="field-label">Interval / Jitter</label>
              <div class="row">
                <input class="interval" type="number" min="0" step="100" value="800" title="Max ms between snaps" />
                <input class="jitter" type="number" min="0" max="100" step="5" value="0" placeholder="0%" title="± random jitter %" />
              </div>
            </div>
          </div>
          <div class="toggle-block">
            <div class="toggle-row">
              <input id="ovl-caption-enabled" type="checkbox" />
              <label class="toggle-label" for="ovl-caption-enabled" title="Add a random phrase from the pool to each snap">Random caption</label>
            </div>
            <div class="toggle-row">
              <input id="ovl-interleave-enabled" type="checkbox" />
              <label class="toggle-label" for="ovl-interleave-enabled">Interleave opens</label>
              <span class="suffix">every</span>
              <input class="inline interleave-every" type="number" min="1" max="100" step="1" value="10" title="Open snaps every N sends" />
              <span class="suffix">sends</span>
            </div>
            <div class="toggle-row">
              <input id="ovl-pingpong-enabled" type="checkbox" />
              <label class="toggle-label" for="ovl-pingpong-enabled" title="Send 1 → wait for reply → open → repeat. For 2-account side-by-side runs.">Ping-pong</label>
              <span class="suffix">wait</span>
              <input class="inline pingpong-wait" type="number" min="5" max="600" step="5" value="60" title="Max seconds to wait for partner before sending again" />
              <span class="suffix">s</span>
            </div>
            <div class="toggle-note">Caption pool / friends are edited in the toolbar popup. Toggles sync both ways.</div>
          </div>
          <div class="row">
            <button class="btn primary start-btn">▶ Start</button>
            <button class="btn danger stop-btn" disabled>■ Stop</button>
            <button class="btn icon reset-btn" title="Reset to home screen">↺</button>
          </div>
        </div>

        <!-- Open mode -->
        <div class="mode-body" data-mode-body="open" style="display:none">
          <div class="open-info">
            <span class="open-count">No friends selected</span>
            <span class="open-empty-hint">
              Configure the friend list in the extension popup → Open tab.
              Saved selections appear here automatically.
            </span>
          </div>
          <div>
            <label class="field-label">Snap dwell (ms)</label>
            <input class="open-dwell" type="number" min="500" step="500" value="4000"
                   title="How long to wait while each snap plays before clicking close." />
          </div>
          <div class="row">
            <button class="btn primary open-start-btn" disabled>▶ Open</button>
            <button class="btn danger open-stop-btn" disabled>■ Stop</button>
            <button class="btn icon reset-btn" title="Reset to home screen">↺</button>
          </div>
        </div>

        <div class="log"></div>
      </div>
      <div class="footer-credit">
        Auto Snapper · v1.0 · by <strong>Bryce Joseph</strong>
      </div>
    </div>
  `;
})();
