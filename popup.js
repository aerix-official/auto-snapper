// popup.js
// UI glue: tabs, friend pool, configs, run/stop. Talks to the content script
// on the active web.snapchat.com tab via chrome.tabs.sendMessage.

const STORAGE_KEYS = {
  friends: "friends",
  configs: "configs",
  friendsByCategory: "friendsByCategory",
  friendsAvatars: "friendsAvatars",
  friendsUsernames: "friendsUsernames",
  friendsAliases: "friendsAliases",
  friendsStreaks: "friendsStreaks",
  autoOpenList: "autoOpenList",
  autoOpenDwell: "autoOpenDwell",
  friendsLastPulled: "friendsLastPulled",
  autoRefreshHours: "autoRefreshHours",
  stats: "stats",
};

// Color palette for per-config theming.
const CONFIG_COLORS = [
  "#fffc00", // Snapchat yellow (default)
  "#5b8cff", // blue
  "#ff5b9b", // pink
  "#2ee59d", // green
  "#b07cff", // purple
  "#ff9b40", // orange
  "#ff4d6d", // red
  "#41d3ff", // cyan
];

const DEFAULT_AUTO_REFRESH_HOURS = 24;

// Order in which to render sections.
const SECTION_ORDER = [
  "Best Friends", "Recents", "Groups", "My Friends",
  "Friends", "Subscriptions", "Quick Add", "Suggested Friends",
];

function orderedSectionEntries(byCategory) {
  if (!byCategory) return [];
  const entries = Object.entries(byCategory);
  entries.sort((a, b) => {
    const ai = SECTION_ORDER.indexOf(a[0]);
    const bi = SECTION_ORDER.indexOf(b[0]);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  return entries;
}

// ---------- helpers ----------

function isSnapchatUrl(url) {
  if (!url) return false;
  return (
    url.startsWith("https://web.snapchat.com/") ||
    url.startsWith("https://www.snapchat.com/web")
  );
}

async function activeSnapTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isSnapchatUrl(tab.url)) {
    throw new Error("Active tab isn't web Snapchat (try web.snapchat.com or www.snapchat.com/web)");
  }
  return tab;
}

async function send(msg) {
  const tab = await activeSnapTab();
  return chrome.tabs.sendMessage(tab.id, msg);
}

function $(id) { return document.getElementById(id); }
function el(tag, props = {}, kids = []) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of [].concat(kids)) e.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
  return e;
}

async function getStore() {
  const r = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  return {
    friends: r.friends || [],
    configs: r.configs || [],
    friendsByCategory: r.friendsByCategory || {},
    friendsAvatars: r.friendsAvatars || {},
    friendsUsernames: r.friendsUsernames || {},
    friendsAliases: r.friendsAliases || {},
    friendsStreaks: r.friendsStreaks || {},
    autoOpenList: r.autoOpenList || [],
    autoOpenDwell: r.autoOpenDwell ?? 4000,
    friendsLastPulled: r.friendsLastPulled || 0,
    autoRefreshHours: r.autoRefreshHours ?? DEFAULT_AUTO_REFRESH_HOURS,
    stats: r.stats || { sentByDay: {}, failedByDay: {}, totalSent: 0, totalFailed: 0 },
  };
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function lastNDayKeys(n) {
  const keys = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}
async function setStore(patch) {
  await chrome.storage.local.set(patch);
}

// ---------- tabs ----------

document.querySelectorAll(".tabs button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    document.querySelector(`.panel[data-panel="${b.dataset.tab}"]`).classList.add("active");
  });
});

// ---------- header / status ----------

async function refreshStatus() {
  const pill = $("status-pill");
  try {
    const r = await send({ type: "status" });
    $("header").classList.toggle("connected", !!r?.ok);
    pill.classList.toggle("connected", !!r?.ok && !r.running);
    pill.classList.toggle("running", !!r?.running);
    pill.textContent = r?.running ? "running" : "idle";
    $("btn-stop").disabled = !r?.running;
    $("btn-start").disabled = !!r?.running;
    if (typeof syncOpenButtons === "function") syncOpenButtons(!!r?.running);
  } catch {
    $("header").classList.remove("connected");
    pill.classList.remove("connected", "running");
    pill.textContent = "no tab";
    $("btn-start").disabled = true;
    $("btn-stop").disabled = true;
    if (typeof syncOpenButtons === "function") syncOpenButtons(false);
  }
}

// ---------- friends ----------

function avatarFor(name, avatarUrl, isBestFriend = false) {
  // Always render a colored letter circle as a fallback layer — if an image
  // fails to load, we have something visible.
  const stripped = (name || "").replace(/^\p{Extended_Pictographic}+/u, "").trim();
  const initial = (stripped[0] || (name || "?")[0] || "?").toUpperCase();
  let h = 0;
  for (const c of name || "") h = (h * 31 + c.charCodeAt(0)) | 0;
  const hue = Math.abs(h) % 360;
  const wrap = el("span", {
    className: "avatar" + (isBestFriend ? " bestfriend" : ""),
    textContent: avatarUrl ? "" : initial,
  });
  wrap.style.background = `linear-gradient(135deg, hsl(${hue} 75% 55%), hsl(${(hue + 35) % 360} 70% 42%))`;
  if (avatarUrl) {
    const img = el("img", {
      src: avatarUrl,
      alt: name,
      referrerPolicy: "no-referrer",
      onerror: () => {
        img.remove();
        wrap.textContent = initial;
      },
    });
    img.style.cssText = "position:absolute; inset:0; width:100%; height:100%; object-fit:cover; border-radius:50%;";
    wrap.appendChild(img);
  }
  return wrap;
}

// Quick set of names that are in the Best Friends section, for avatar styling.
function bestFriendSet(friendsByCategory) {
  return new Set(friendsByCategory?.["Best Friends"] || []);
}

// Populate the section-filter dropdowns with whatever sections exist in the
// current friend pool. Preserves the current selection when possible.
function populateSectionFilters(friendsByCategory) {
  const sections = orderedSectionEntries(friendsByCategory).map(([s]) => s);
  for (const id of ["cfg-section-filter", "friends-section-filter"]) {
    const el2 = $(id);
    if (!el2) continue;
    const cur = el2.value || "all";
    el2.innerHTML = "";
    el2.appendChild(el("option", { value: "all", textContent: "All sections" }));
    for (const s of sections) {
      el2.appendChild(el("option", { value: s, textContent: s }));
    }
    el2.value = sections.includes(cur) || cur === "all" ? cur : "all";
  }
}

function nameMatches(name, query, username = null, aliasesList = null) {
  if (!query) return true;
  const q = query.toLowerCase();
  if (name.toLowerCase().includes(q)) return true;
  if (username && username.toLowerCase().includes(q)) return true;
  if (aliasesList) {
    for (const a of aliasesList) {
      if (a.toLowerCase().includes(q)) return true;
    }
  }
  return false;
}

function nameBlock(name, _ignoredUsername, aliasesList, streak) {
  // Note: `_ignoredUsername` is kept in the signature only so existing callers
  // don't break. Snapchat's picker doesn't actually expose usernames; we never
  // render them. Subtitle shows aliases (other display names this person uses).
  const wrap = el("div", { className: "name" });
  const topRow = el("div", { style: "display:flex; align-items:center; gap:6px; min-width:0;" });
  topRow.appendChild(el("span", { textContent: name, style: "flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" }));
  if (typeof streak === "number" && streak > 0) {
    topRow.appendChild(el("span", {
      className: "streak-badge",
      textContent: `🔥${streak}`,
      title: `${streak}-day streak`,
    }));
  }
  wrap.appendChild(topRow);
  if (aliasesList && aliasesList.length) {
    wrap.appendChild(
      el("span", { textContent: `aka ${aliasesList.join(", ")}`, title: aliasesList.join(", ") })
    );
  }
  return wrap;
}

async function renderFriends() {
  const { friends, friendsByCategory, friendsAvatars, friendsUsernames, friendsAliases, friendsStreaks } = await getStore();
  populateSectionFilters(friendsByCategory);
  const sectionFilter = $("friends-section-filter")?.value || "all";
  const q = ($("friends-search")?.value || "").trim();
  const matching = friends.filter((n) => nameMatches(n, q, friendsUsernames?.[n], friendsAliases?.[n]));
  const totalLabel = q
    ? `${matching.length} of ${friends.length} friend${friends.length === 1 ? "" : "s"}`
    : `${friends.length} friend${friends.length === 1 ? "" : "s"}`;
  $("friends-count").textContent = totalLabel;
  const root = $("friends-list");
  root.innerHTML = "";

  const removeName = async (name) => {
    const cur = await getStore();
    const f = cur.friends.filter((x) => x !== name);
    const byCat = {};
    for (const [k, v] of Object.entries(cur.friendsByCategory || {})) {
      byCat[k] = v.filter((n) => n !== name);
    }
    await setStore({ friends: f, friendsByCategory: byCat });
    renderFriends();
    renderFriendPool();
  };

  const bf = bestFriendSet(friendsByCategory);
  const renderRow = (name) =>
    el("div", { className: "item" }, [
      avatarFor(name, friendsAvatars?.[name], bf.has(name)),
      nameBlock(name, friendsUsernames?.[name], friendsAliases?.[name], friendsStreaks?.[name]),
      el("span", { className: "x", textContent: "✕", title: "Remove", onclick: () => removeName(name) }),
    ]);

  const sections = orderedSectionEntries(friendsByCategory);
  if (sections.length) {
    for (const [section, names] of sections) {
      if (sectionFilter !== "all" && section !== sectionFilter) continue;
      const filtered = names.filter((n) => nameMatches(n, q, friendsUsernames?.[n], friendsAliases?.[n]));
      if (!filtered.length) continue;
      root.appendChild(
        el("div", { className: "section-header" }, [
          el("span", {
            textContent: `${section} · ${filtered.length}${filtered.length !== names.length ? ` of ${names.length}` : ""}`,
          }),
        ])
      );
      for (const name of filtered) root.appendChild(renderRow(name));
    }
    const inAnyCat = new Set(sections.flatMap(([, v]) => v));
    const unsectioned = friends.filter((n) => !inAnyCat.has(n) && nameMatches(n, q, friendsUsernames?.[n], friendsAliases?.[n]));
    if (unsectioned.length && (sectionFilter === "all" || sectionFilter === "Other")) {
      root.appendChild(
        el("div", { className: "section-header" }, [el("span", { textContent: `Other · ${unsectioned.length}` })])
      );
      for (const name of unsectioned) root.appendChild(renderRow(name));
    }
  } else {
    for (const name of matching) root.appendChild(renderRow(name));
  }

  if (!root.children.length) {
    root.appendChild(el("div", { className: "empty", textContent: q ? "No matches." : "(no friends)" }));
  }
}

async function pullFriends({ silent = false } = {}) {
  const method = $("pull-method")?.value || "newchat";
  $("btn-pull-friends").disabled = true;
  try {
    const r = await send({
      type: "scrape-recipients",
      openPickerFirst: method !== "manual",
      openVia: method,
    });
    if (!r?.ok) throw new Error(r?.error || "scrape failed");
    const cur = await getStore();
    // Replace the friends list each pull (so removed friends actually disappear).
    const fresh = [...new Set(r.names)].sort((a, b) => a.localeCompare(b));
    const freshByCat = {};
    for (const [section, names] of Object.entries(r.byCategory || {})) {
      freshByCat[section] = [...names].sort((a, b) => a.localeCompare(b));
    }
    // Merge avatars + usernames: keep old entries we still know about (so a
    // future refresh that misses one doesn't blank it out).
    const freshAvatars = { ...(cur.friendsAvatars || {}), ...(r.avatars || {}) };
    // Snapchat's New Chat picker doesn't expose usernames — REPLACE the
    // stored map (don't merge) so any junk from older buggy pulls is wiped.
    const freshUsernames = { ...(r.usernames || {}) };
    const freshStreaks  = { ...(cur.friendsStreaks  || {}), ...(r.streaks  || {}) };
    // Replace aliases — they only make sense relative to the latest scrape,
    // and stale aliases from old name spellings would just be noise.
    const freshAliases = r.aliases ? { ...r.aliases } : {};
    const inList = new Set(fresh);
    for (const k of Object.keys(freshAvatars))  if (!inList.has(k)) delete freshAvatars[k];
    for (const k of Object.keys(freshUsernames)) if (!inList.has(k)) delete freshUsernames[k];
    for (const k of Object.keys(freshStreaks))   if (!inList.has(k)) delete freshStreaks[k];
    for (const k of Object.keys(freshAliases))   if (!inList.has(k)) delete freshAliases[k];
    await setStore({
      friends: fresh,
      friendsByCategory: freshByCat,
      friendsAvatars: freshAvatars,
      friendsUsernames: freshUsernames,
      friendsAliases: freshAliases,
      friendsStreaks: freshStreaks,
      friendsLastPulled: Date.now(),
    });
    await renderFriends();
    await renderFriendPool();
    await renderOpenPool();
    await renderLastPulledLabel();
    await checkStaleness();
  } catch (e) {
    if (!silent) alert("Pull failed: " + e.message);
    console.warn("pullFriends failed:", e);
    throw e;
  } finally {
    $("btn-pull-friends").disabled = false;
  }
}

$("btn-pull-friends").addEventListener("click", () => pullFriends().catch(() => {}));

$("auto-refresh-hours")?.addEventListener("change", async () => {
  await setStore({ autoRefreshHours: parseInt($("auto-refresh-hours").value, 10) || 0 });
  await checkStaleness();
});

async function renderStats() {
  const { stats } = await getStore();
  const today = stats.sentByDay?.[todayKey()] || 0;
  const week = lastNDayKeys(7).reduce((acc, k) => acc + (stats.sentByDay?.[k] || 0), 0);
  const total = stats.totalSent || 0;
  const failed = stats.totalFailed || 0;
  const attempts = total + failed;
  const rate = attempts === 0 ? "—" : `${Math.round((total / attempts) * 100)}%`;
  if ($("stat-today")) $("stat-today").textContent = today;
  if ($("stat-week")) $("stat-week").textContent = week;
  if ($("stat-total")) $("stat-total").textContent = total;
  if ($("stat-rate")) $("stat-rate").textContent = rate;
}

async function renderLastPulledLabel() {
  const { friendsLastPulled } = await getStore();
  const label = $("friends-last-pulled");
  if (!label) return;
  if (!friendsLastPulled) {
    label.textContent = "never pulled";
    return;
  }
  const ageMin = (Date.now() - friendsLastPulled) / (1000 * 60);
  if (ageMin < 60) label.textContent = `pulled ${Math.round(ageMin)}m ago`;
  else if (ageMin < 60 * 24) label.textContent = `pulled ${Math.round(ageMin / 60)}h ago`;
  else label.textContent = `pulled ${Math.round(ageMin / (60 * 24))}d ago`;
}

// ---------- configs ----------

let cfgSelection = new Set();
let cfgColor = CONFIG_COLORS[0]; // currently-picked color in the editor

function renderColorPicker() {
  const root = $("cfg-color-picker");
  if (!root) return;
  root.innerHTML = "";
  for (const c of CONFIG_COLORS) {
    const swatch = el("span", {
      className: "color-swatch" + (c === cfgColor ? " selected" : ""),
      title: c,
      onclick: () => {
        cfgColor = c;
        renderColorPicker();
      },
    });
    swatch.style.background = c;
    root.appendChild(swatch);
  }
}

async function renderFriendPool() {
  const { friends, friendsByCategory, friendsAvatars, friendsUsernames, friendsAliases, friendsStreaks } = await getStore();
  populateSectionFilters(friendsByCategory);
  const sectionFilter = $("cfg-section-filter")?.value || "all";
  const q = ($("cfg-search")?.value || "").trim();
  const root = $("cfg-friend-pool");
  root.innerHTML = "";
  if (friends.length === 0) {
    root.appendChild(el("div", { className: "empty", textContent: "Pull your friend list first (Friends tab)." }));
    return;
  }
  const bf = bestFriendSet(friendsByCategory);

  const renderCheckboxRow = (name) => {
    const cb = el("input", { type: "checkbox" });
    cb.checked = cfgSelection.has(name);
    cb.addEventListener("change", () => {
      if (cb.checked) cfgSelection.add(name); else cfgSelection.delete(name);
      $("cfg-count").textContent = `${cfgSelection.size} selected`;
    });
    return el("label", { className: "item" }, [
      cb,
      avatarFor(name, friendsAvatars?.[name], bf.has(name)),
      nameBlock(name, friendsUsernames?.[name], friendsAliases?.[name], friendsStreaks?.[name]),
    ]);
  };

  const renderSectionHeader = (section, names) => {
    const allChecked = names.every((n) => cfgSelection.has(n));
    const toggleAll = el("a", {
      className: "section-toggle",
      href: "#",
      textContent: allChecked ? "Deselect all" : "Select all",
      onclick: (ev) => {
        ev.preventDefault();
        const wantCheck = !allChecked;
        for (const n of names) {
          if (wantCheck) cfgSelection.add(n); else cfgSelection.delete(n);
        }
        renderFriendPool();
      },
    });
    return el("div", { className: "section-header" }, [
      el("span", { textContent: `${section} · ${names.length}` }),
      toggleAll,
    ]);
  };

  const sections = orderedSectionEntries(friendsByCategory);
  if (sections.length) {
    for (const [section, names] of sections) {
      if (sectionFilter !== "all" && section !== sectionFilter) continue;
      const filtered = names.filter((n) => nameMatches(n, q, friendsUsernames?.[n], friendsAliases?.[n]));
      if (!filtered.length) continue;
      root.appendChild(renderSectionHeader(section, filtered));
      for (const name of filtered) root.appendChild(renderCheckboxRow(name));
    }
    const inAnyCat = new Set(sections.flatMap(([, v]) => v));
    const unsectioned = friends.filter((n) => !inAnyCat.has(n) && nameMatches(n, q, friendsUsernames?.[n], friendsAliases?.[n]));
    if (unsectioned.length && (sectionFilter === "all" || sectionFilter === "Other")) {
      root.appendChild(renderSectionHeader("Other", unsectioned));
      for (const name of unsectioned) root.appendChild(renderCheckboxRow(name));
    }
  } else {
    for (const name of friends.filter((n) => nameMatches(n, q, friendsUsernames?.[n], friendsAliases?.[n]))) {
      root.appendChild(renderCheckboxRow(name));
    }
  }

  if (!root.children.length) {
    root.appendChild(el("div", { className: "empty", textContent: q ? "No matches." : "(no friends)" }));
  }

  $("cfg-count").textContent = `${cfgSelection.size} selected`;
}

async function renderConfigs() {
  const { configs } = await getStore();
  const root = $("configs-list");
  root.innerHTML = "";
  if (configs.length === 0) {
    root.appendChild(el("div", { className: "empty", textContent: "No configurations yet." }));
    return;
  }
  for (const c of configs) {
    const dot = el("span", { className: "config-color-dot" });
    dot.style.background = c.color || CONFIG_COLORS[0];
    const row = el("div", {
      className: "config-row",
      title: "Click to edit\nRecipients: " + c.recipients.join(", "),
      style: "cursor: pointer;",
    }, [
      dot,
      el("span", { className: "config-name", textContent: c.name }),
      el("span", { className: "config-count", textContent: `${c.recipients.length} ${c.recipients.length === 1 ? "person" : "people"}` }),
      el("span", {
        className: "x",
        textContent: "✕",
        title: "Delete config",
        style: "opacity: 1; cursor: pointer; color: var(--muted); padding: 0 4px;",
        onclick: async (ev) => {
          ev.stopPropagation();
          if (!confirm(`Delete "${c.name}"?`)) return;
          const next = configs.filter((x) => x.name !== c.name);
          await setStore({ configs: next });
          renderConfigs();
          renderRunConfigs();
        },
      }),
    ]);
    row.addEventListener("click", () => loadConfigIntoEditor(c));
    root.appendChild(row);
  }
}

function loadConfigIntoEditor(cfg) {
  $("cfg-name").value = cfg.name;
  cfgSelection = new Set(cfg.recipients);
  cfgColor = cfg.color || CONFIG_COLORS[0];
  $("cfg-search").value = "";
  renderColorPicker();
  renderFriendPool();
  $("cfg-name").focus();
  $("cfg-name").select();
  // Subtle yellow flash on the name input to show it's loaded.
  const inp = $("cfg-name");
  inp.style.transition = "box-shadow 200ms ease";
  inp.style.boxShadow = "var(--shadow-glow)";
  setTimeout(() => { inp.style.boxShadow = ""; }, 600);
}

// ---------- export / import ----------

$("btn-export-configs")?.addEventListener("click", async () => {
  const s = await getStore();
  const dump = {
    formatVersion: 1,
    appName: "auto-snapper",
    exportedAt: new Date().toISOString(),
    configs: s.configs,
    friends: s.friends,
    friendsByCategory: s.friendsByCategory,
    friendsAvatars: s.friendsAvatars,
    friendsUsernames: s.friendsUsernames,
    friendsAliases: s.friendsAliases,
  };
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `auto-snapper-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("btn-import-configs")?.addEventListener("click", () => $("import-file-input").click());

$("import-file-input")?.addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.configs)) {
      throw new Error("File doesn't look like an Auto Snapper export (no `configs` array)");
    }
    const cur = await getStore();

    // Merge configs: same name overwrites, otherwise append.
    const merged = [...cur.configs];
    let updated = 0, added = 0;
    for (const c of data.configs) {
      if (!c?.name) continue;
      const idx = merged.findIndex((m) => m.name === c.name);
      if (idx >= 0) { merged[idx] = c; updated++; }
      else { merged.push(c); added++; }
    }

    const updates = { configs: merged };
    // Optionally restore friend data alongside configs.
    if (Array.isArray(data.friends)) {
      updates.friends = [...new Set([...cur.friends, ...data.friends])].sort((a, b) => a.localeCompare(b));
    }
    if (data.friendsByCategory) updates.friendsByCategory = { ...cur.friendsByCategory, ...data.friendsByCategory };
    if (data.friendsAvatars) updates.friendsAvatars = { ...cur.friendsAvatars, ...data.friendsAvatars };
    if (data.friendsUsernames) updates.friendsUsernames = { ...cur.friendsUsernames, ...data.friendsUsernames };
    if (data.friendsAliases) updates.friendsAliases = { ...cur.friendsAliases, ...data.friendsAliases };

    await setStore(updates);
    await renderConfigs();
    await renderRunConfigs();
    await renderFriends();
    await renderFriendPool();
    alert(`Imported: ${added} new, ${updated} updated config(s).`);
  } catch (e) {
    alert("Import failed: " + e.message);
  } finally {
    ev.target.value = ""; // reset so the same file can be re-imported
  }
});

$("btn-cfg-clear")?.addEventListener("click", () => {
  cfgSelection = new Set();
  cfgColor = CONFIG_COLORS[0];
  $("cfg-name").value = "";
  $("cfg-search").value = "";
  renderColorPicker();
  renderFriendPool();
});

$("btn-save-config").addEventListener("click", async () => {
  const name = $("cfg-name").value.trim();
  if (!name) return alert("Name your configuration first.");
  if (cfgSelection.size === 0) return alert("Pick at least one recipient.");
  const { configs } = await getStore();
  const recipients = [...cfgSelection];
  const color = cfgColor || CONFIG_COLORS[0];
  const idx = configs.findIndex((c) => c.name === name);
  if (idx >= 0) configs[idx] = { name, recipients, color };
  else configs.push({ name, recipients, color });
  await setStore({ configs });
  cfgSelection = new Set();
  cfgColor = CONFIG_COLORS[0];
  $("cfg-name").value = "";
  renderColorPicker();
  renderConfigs();
  renderFriendPool();
  renderRunConfigs();
});

// ---------- run ----------

async function renderRunConfigs() {
  const { configs } = await getStore();
  const sel = $("run-config");
  sel.innerHTML = "";
  if (configs.length === 0) {
    sel.appendChild(el("option", { textContent: "(no configs — create one)" }));
    $("btn-start").disabled = true;
    return;
  }
  for (const c of configs) {
    const opt = el("option", {
      value: c.name,
      textContent: `● ${c.name} (${c.recipients.length})`,
    });
    opt.style.color = c.color || CONFIG_COLORS[0];
    sel.appendChild(opt);
  }
  $("btn-start").disabled = false;
}

function setRunningUI(running) {
  // Optimistic UI flip — don't wait for the next status poll.
  const pill = $("status-pill");
  pill.classList.toggle("running", running);
  pill.classList.toggle("connected", !running);
  pill.textContent = running ? "running" : "idle";
  $("btn-start").disabled = running;
  $("btn-stop").disabled = !running;
}

$("btn-start").addEventListener("click", async () => {
  const { configs, friendsAliases } = await getStore();
  const cfg = configs.find((c) => c.name === $("run-config").value);
  if (!cfg) return alert("Pick a config.");
  const unlimited = $("run-unlimited")?.checked === true;
  const count = unlimited ? 0 : Math.max(1, parseInt($("run-count").value, 10) || 1);
  const intervalMs = Math.max(0, parseInt($("run-interval").value, 10) || 800);
  const jitterPct = Math.max(0, Math.min(100, parseInt($("run-jitter").value, 10) || 0));

  // Expand each saved recipient into all of its known name variants — the
  // canonical name plus any aliases scraped from other sections.
  const expandedRecipients = cfg.recipients.map((saved) => {
    let canonical = saved;
    for (const [c, list] of Object.entries(friendsAliases || {})) {
      if (list.includes(saved)) { canonical = c; break; }
    }
    const aliases = friendsAliases?.[canonical] || [];
    const candidates = [...new Set([canonical, saved, ...aliases])].filter(Boolean);
    return { primary: saved, candidates };
  });

  // Optimistic: flip UI to "running" before the message round-trip resolves
  // so the Stop button is clickable immediately.
  setRunningUI(true);

  try {
    await send({
      type: "run",
      payload: { recipients: expandedRecipients, count, intervalMs, unlimited, jitterPct },
    });
  } catch (e) {
    setRunningUI(false);
    alert("Start failed: " + e.message + "\n\nMake sure web.snapchat.com is the active tab.");
  }
  refreshStatus();
});

$("btn-reset")?.addEventListener("click", async () => {
  $("btn-reset").disabled = true;
  try {
    const r = await send({ type: "go-home" });
    if (!r?.ok) alert("Reset failed: " + (r?.error || "unknown"));
  } catch (e) {
    alert("Reset failed: " + e.message);
  } finally {
    $("btn-reset").disabled = false;
  }
});

$("btn-stop").addEventListener("click", async () => {
  // Optimistic: flip back to idle UI immediately. The actual loop catches
  // the stop flag within ~100ms (checkStop is threaded throughout); the
  // worst case is the user sees an out-of-date "idle" pill for a moment
  // before refreshStatus reconciles, which is fine.
  setRunningUI(false);
  try {
    await send({ type: "stop" });
  } catch {}
  refreshStatus();
});

// Push notification from content.js when the loop exits (count reached, error,
// or stop). Update the UI immediately instead of waiting for the next poll.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "loop-ended") {
    setRunningUI(false);
    refreshStatus();
    refreshLog();
    renderStats();
  }
});

// Toggle: unlimited disables the count input
$("run-unlimited")?.addEventListener("change", () => {
  const on = $("run-unlimited").checked;
  const countInput = $("run-count");
  countInput.disabled = on;
  countInput.style.opacity = on ? "0.4" : "";
  countInput.title = on ? "Disabled while ∞ is on" : "";
});

// ---------- log ----------

async function refreshLog() {
  try {
    const r = await send({ type: "status" });
    if (r?.ok) {
      $("log").textContent = (r.log || []).join("\n");
      $("log").scrollTop = $("log").scrollHeight;
    }
  } catch {}
}

$("btn-copy-log").addEventListener("click", async () => {
  const text = $("log").textContent || "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const btn = $("btn-copy-log");
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = orig), 1200);
  } catch (e) {
    alert("Copy failed: " + e.message);
  }
});

$("btn-clear-log").addEventListener("click", async () => {
  await send({ type: "clear-log" }).catch(() => {});
  $("log").textContent = "";
});

// (Diagnostics tab removed. The standalone diagnostics.js file in the
// extension folder is still available for debugging if Snapchat re-mints
// selectors and we need a fresh structural dump.)

// ---------- search inputs ----------

function debounce(fn, ms = 80) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

$("friends-search")?.addEventListener("input", debounce(() => renderFriends(), 60));
$("cfg-search")?.addEventListener("input", debounce(() => renderFriendPool(), 60));
$("friends-section-filter")?.addEventListener("change", () => renderFriends());
$("cfg-section-filter")?.addEventListener("change", () => renderFriendPool());

// ---------- Open tab (auto-view snaps) ----------

let openSelection = new Set();

async function renderOpenPool() {
  const { friends, friendsByCategory, friendsAvatars, friendsAliases, friendsStreaks } = await getStore();
  // Populate the section dropdown.
  const filtSel = $("open-section-filter");
  if (filtSel) {
    const cur = filtSel.value || "all";
    const sections = orderedSectionEntries(friendsByCategory).map(([s]) => s);
    filtSel.innerHTML = "";
    filtSel.appendChild(el("option", { value: "all", textContent: "All sections" }));
    for (const s of sections) filtSel.appendChild(el("option", { value: s, textContent: s }));
    filtSel.value = sections.includes(cur) || cur === "all" ? cur : "all";
  }
  const sectionFilter = filtSel?.value || "all";
  const q = ($("open-search")?.value || "").trim();

  const root = $("open-friend-pool");
  if (!root) return;
  root.innerHTML = "";
  if (friends.length === 0) {
    root.appendChild(el("div", { className: "empty", textContent: "Pull your friend list first (Friends tab)." }));
    return;
  }

  const bf = bestFriendSet(friendsByCategory);
  const renderRow = (name) => {
    const cb = el("input", { type: "checkbox" });
    cb.checked = openSelection.has(name);
    cb.addEventListener("change", async () => {
      if (cb.checked) openSelection.add(name); else openSelection.delete(name);
      await setStore({ autoOpenList: [...openSelection] });
      $("open-count").textContent = `${openSelection.size} selected`;
    });
    return el("label", { className: "item" }, [
      cb,
      avatarFor(name, friendsAvatars?.[name], bf.has(name)),
      nameBlock(name, null, friendsAliases?.[name], friendsStreaks?.[name]),
    ]);
  };

  const sections = orderedSectionEntries(friendsByCategory);
  if (sections.length) {
    for (const [section, names] of sections) {
      if (sectionFilter !== "all" && section !== sectionFilter) continue;
      const filtered = names.filter((n) => nameMatches(n, q, null, friendsAliases?.[n]));
      if (!filtered.length) continue;
      root.appendChild(el("div", { className: "section-header" }, [
        el("span", { textContent: `${section} · ${filtered.length}` }),
      ]));
      for (const name of filtered) root.appendChild(renderRow(name));
    }
  } else {
    for (const name of friends.filter((n) => nameMatches(n, q, null, friendsAliases?.[n]))) {
      root.appendChild(renderRow(name));
    }
  }

  $("open-count").textContent = `${openSelection.size} selected`;
}

async function refreshOpenLog() {
  try {
    const r = await send({ type: "status" });
    if (r?.ok && $("open-log")) {
      $("open-log").textContent = (r.log || []).join("\n");
      $("open-log").scrollTop = $("open-log").scrollHeight;
    }
  } catch {}
}

$("open-search")?.addEventListener("input", debounce(() => renderOpenPool(), 60));
$("open-section-filter")?.addEventListener("change", () => renderOpenPool());

$("open-dwell")?.addEventListener("change", async () => {
  const val = Math.max(500, parseInt($("open-dwell").value, 10) || 4000);
  $("open-dwell").value = val;
  await setStore({ autoOpenDwell: val });
});

$("btn-open-start")?.addEventListener("click", async () => {
  if (openSelection.size === 0) return alert("Pick at least one friend to auto-open from.");
  const snapDwellMs = Math.max(500, parseInt($("open-dwell").value, 10) || 4000);
  const users = [...openSelection];

  // Optimistic UI: flip the run-state buttons since open uses the same lock.
  setRunningUI(true);
  $("btn-open-start").disabled = true;
  $("btn-open-stop").disabled = false;

  try {
    const r = await send({ type: "open", payload: { users, snapDwellMs } });
    if (!r?.ok) throw new Error(r?.error || "open failed");
  } catch (e) {
    setRunningUI(false);
    $("btn-open-start").disabled = false;
    $("btn-open-stop").disabled = true;
    alert("Open failed: " + e.message);
  }
  refreshStatus();
});

$("btn-open-stop")?.addEventListener("click", async () => {
  $("btn-open-stop").disabled = true;
  $("btn-open-start").disabled = false;
  setRunningUI(false);
  try { await send({ type: "stop" }); } catch {}
  refreshStatus();
});

$("btn-copy-open-log")?.addEventListener("click", async () => {
  const text = $("open-log")?.textContent || "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const btn = $("btn-copy-open-log");
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = orig), 1200);
  } catch {}
});

// Status poll updates the Open tab's Stop button state too.
function syncOpenButtons(running) {
  if ($("btn-open-start")) $("btn-open-start").disabled = running;
  if ($("btn-open-stop")) $("btn-open-stop").disabled = !running;
}

// ---------- staleness banner ----------

async function checkStaleness() {
  const { friends, friendsLastPulled, autoRefreshHours } = await getStore();
  const banner = $("stale-banner");
  if (!banner) return;
  const age = Date.now() - friendsLastPulled;
  const ageH = age / (1000 * 60 * 60);
  if (friends.length === 0) {
    banner.style.display = "block";
    banner.textContent = "No friends pulled yet — go to Friends tab → Pull friend list.";
    return;
  }
  if (autoRefreshHours > 0 && ageH > autoRefreshHours) {
    banner.style.display = "block";
    banner.textContent = `Friend list last pulled ${Math.round(ageH)}h ago — refresh to catch new/removed friends.`;
    return;
  }
  banner.style.display = "none";
}

// ---------- init ----------

async function maybeAutoRefresh() {
  const { friends, friendsLastPulled, autoRefreshHours } = await getStore();
  if (!autoRefreshHours || autoRefreshHours <= 0) return;
  const ageH = (Date.now() - friendsLastPulled) / (1000 * 60 * 60);
  if (friends.length > 0 && ageH < autoRefreshHours) return;
  // Stale (or never pulled) — try to silently refresh in the background.
  // This requires the active tab to be Snapchat; if it isn't, just skip
  // silently so the user isn't shown an error.
  try {
    await activeSnapTab();
  } catch {
    return;
  }
  console.log("[AutoSnapper] stale friend list — auto-refreshing");
  pullFriends({ silent: true }).catch(() => {});
}

(async () => {
  // One-shot migration: previous versions wrote garbage into friendsUsernames
  // (text from neighbouring rows would leak in). Snapchat's New Chat picker
  // doesn't actually expose usernames at all — confirmed via DOM probe — so
  // wipe any stale entries on startup.
  const stored = await chrome.storage.local.get("friendsUsernames");
  if (stored.friendsUsernames && Object.keys(stored.friendsUsernames).length > 0) {
    await chrome.storage.local.set({ friendsUsernames: {} });
  }

  // Restore dropdown values from storage before any handlers fire.
  const cur = await getStore();
  if ($("auto-refresh-hours")) $("auto-refresh-hours").value = String(cur.autoRefreshHours);

  // Overlay visibility toggle.
  const overlaySetting = await chrome.storage.local.get("overlayVisible");
  if ($("overlay-visible")) {
    $("overlay-visible").checked = overlaySetting.overlayVisible !== false; // default true
    $("overlay-visible").addEventListener("change", async () => {
      const on = $("overlay-visible").checked;
      await chrome.storage.local.set({ overlayVisible: on });
      // The overlay only re-renders on page load. Tell the user to refresh
      // the Snapchat tab if they want to see the change immediately.
      const note = on
        ? "Overlay enabled. Refresh the Snapchat tab to see it."
        : "Overlay hidden. It'll stay hidden across refreshes.";
      const banner = $("stale-banner");
      if (banner) {
        banner.style.display = "block";
        banner.textContent = note;
        setTimeout(() => checkStaleness(), 3500);
      }
    });
  }

  renderColorPicker();
  // Load auto-open list + dwell from storage into the UI.
  openSelection = new Set(cur.autoOpenList || []);
  if ($("open-dwell")) $("open-dwell").value = String(cur.autoOpenDwell || 4000);

  await renderFriends();
  await renderFriendPool();
  await renderOpenPool();
  await renderConfigs();
  await renderRunConfigs();
  await renderLastPulledLabel();
  await renderStats();
  await checkStaleness();
  refreshStatus();
  refreshLog();
  refreshOpenLog();
  // Re-render stats periodically so live snap counts update.
  setInterval(() => renderStats().catch(() => {}), 1500);
  // Poll fast enough that loop-end / stop is reflected within ~half a
  // second even if the push notification doesn't reach the popup.
  setInterval(refreshStatus, 500);
  setInterval(refreshLog, 700);
  setInterval(refreshOpenLog, 700);

  // Don't auto-refresh on every popup open — only when stale beyond the
  // configured interval. Runs in background; UI updates when it returns.
  maybeAutoRefresh();
})();
