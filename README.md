# Auto Snapper

> A Chrome extension that automates **sending** and **opening** snaps on web.snapchat.com.
>
> **By Bryce Joseph** · v1.0.0

A full-featured browser automation tool for [web.snapchat.com](https://www.snapchat.com/web/). Pulls your friend list (with Bitmoji avatars and streak counts), saves recipient configurations with custom colors, and runs the camera → capture → pick-recipients → send loop on a schedule of your choice. Includes an in-page floating control panel so you don't have to keep opening the toolbar popup.

## ✨ Features

### 📤 Auto-sender (Send tab)
- Save **recipient configurations** with custom colors and any number of friends.
- **Snap count** + **∞ unlimited** mode — send a fixed number or run until you hit Stop.
- **Max interval** with **± jitter %** — randomize the pacing so it doesn't look mechanical.
- **Smart inter-snap wait** — exits early as soon as Snapchat's UI is ready for the next capture.
- **Spam-clicks the capture button** until the photo actually registers (handles React handler-binding race).
- Automatic **photo-preview dismissal** between snaps.
- **Per-step verification with retries** — every click is followed by a state-change check; missed clicks retry up to 3× before giving up.

### 📥 Auto-opener (Open tab)
- Auto-views incoming snaps from any subset of your friends.
- **Virtualized-list-aware** — scrolls the friends sidebar so the target is in view before acting.
- Parks on the row above the target (avoids the "already-selected = no-op" trap), then clicks the in-row 16×16 View icon directly.
- Closes the snap viewer with the X button (`button.h9IpV`), falls back to Escape.
- Loops automatically — opens *all* pending snaps from a friend in a single pass.

### 👥 Friend pulling
- **Silent New Chat path** — clicks the "New Chat" button, scrapes the full picker, presses Escape to close. **No photo captured.**
- **Categorization** by section: Best Friends, Groups, Friends (Recents excluded by design).
- **Bitmoji avatars** — scraped from each row's `<img>` and rendered in the popup.
- **Streak counts** displayed as a 🔥 badge next to each friend's name.
- **Avatar-based dedup** — when the same person appears in multiple sections (e.g. truncated "Huddy D" in Best Friends + full "Huddy the Diddler" in alphabetical), they're merged into one canonical identity. The longer name wins; the shorter is kept as an alias.
- **Best Friend ring** — friends in the Best Friends section get a yellow story-ring around their avatar.
- **Auto-refresh** — configurable interval (off / 6h / 12h / 24h / 3d / weekly). Stale-data banner at the top of the popup.

### 🪟 In-page overlay
- Floating, **draggable**, glassmorphic control panel injected directly into web.snapchat.com.
- Two **mode tabs** — Send and Open — sharing the same status pill and run state.
- **Shadow DOM**-isolated so Snapchat's CSS can't leak in or out.
- **Z-index 2147483647** — sits above Snapchat's modals.
- Position, mode, and collapsed state persist across page reloads.
- Toggle on/off from the popup → Friends tab → "Show floating control panel."

### 🎛️ Configuration management
- **Click any saved config** to load it back into the editor.
- **Per-config color** — 8 swatches; the dot appears in the configs list and as a colored bullet in the run-config dropdown.
- **Section filter** in the recipient picker (and in the Friends tab) — narrow by Best Friends / Groups / Friends.
- **Search** by name or alias.
- **Bulk Select all / Deselect all** per section.
- **Aliases auto-resolved at send time** — saved configs work even if Snapchat renders names slightly differently across sections.
- **Export / Import** — JSON backup of configs + friend pool + avatars + aliases + streaks.

### 📊 Stats
- **Today / This week / All-time** snap counts, plus success rate.
- Counts both successful sends and failures.
- Updates live during a run.

### 🛟 Reliability
- **Stop anywhere** — the stop signal is checked inside every poll, retry, and inter-snap sleep, so clicking Stop halts within ~100ms.
- **Optimistic UI** — Start/Stop button states flip instantly on click; status poll reconciles afterward.
- **`Loop ended` push notification** — the popup re-enables Start the moment the loop terminates.
- **Reset (↺) button** — force-navigates back to the home screen if anything gets stuck.
- **Robust home navigation** — knows multiple close-button selectors (`AJ_5h`, `xHw7V.STlkX`, `xHw7V`) plus Escape fallbacks.

## 🚀 Install

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension from the puzzle-piece menu — yellow camera-iris icon.
5. Open [web.snapchat.com](https://www.snapchat.com/web/) (works on either `web.snapchat.com` or `www.snapchat.com/web/`).

## 📖 Usage

### First-time setup
1. Open the popup → **Friends** tab → click **↻ Pull**. The script silently opens the New Chat picker, scrapes everyone, and closes it. ~10 seconds depending on your friend count.
2. Tab to **Configs** → name a configuration (e.g. "Close Friends"), pick recipients, optionally choose a color, click **Save config**.

### Sending
- Popup → **Send** tab → pick your config, set count (or **∞** for unlimited), set max interval and optional jitter, click **▶ Start**.
- Or use the **in-page overlay** directly on Snapchat — same controls, no popup needed.

### Auto-opening snaps
- Popup → **Open** tab → tick the friends you want snaps auto-opened from → set dwell time (how long to watch each snap).
- Trigger from either the popup's Open tab or the overlay's **Open** mode tab.

### Editing a config
- **Click any saved config row** in the Configs tab — it loads back into the editor for editing.
- Save with the same name to overwrite, or with a new name to duplicate.

### Backup
- Configs tab → **↓ Export** downloads a JSON of everything (configs + friends + avatars + aliases + streaks).
- Configs tab → **↑ Import** restores from a backup; same-named configs are overwritten, others merged.

## 🗂️ File map

| File | Purpose |
|---|---|
| [manifest.json](manifest.json) | MV3 manifest. Hosts: `web.snapchat.com/*` and `www.snapchat.com/web/*`. |
| [selectors.js](selectors.js) | Centralized selectors for all Snapchat UI elements. Confirmed via DOM diagnostics. |
| [content.js](content.js) | The main content script — all the automation logic, state machine, scraper, and chrome.runtime message handler. |
| [overlay.js](overlay.js) | Injects the floating in-page control panel via shadow DOM. |
| [background.js](background.js) | MV3 service worker. Buffers log lines. |
| [popup.html](popup.html) / [popup.js](popup.js) | Toolbar popup UI: Send / Open / Configs / Friends tabs. |
| [icons/](icons/) | Extension icons (16, 32, 48, 128px) — yellow camera-aperture mark. |
| [diagnostics.js](diagnostics.js) | Standalone DOM-probe script for re-locking selectors when Snapchat ships a UI update. |

## 🧠 How it works (technical notes)

### Send flow
1. **`navigateToCamera()`** — handles every starting state (home / camera / photo preview). Clicks the camera circle (`button.qJKfS`) or photo-preview close X as needed. Waits for state to stabilize for 300ms before deciding.
2. **`clickRapidly()` on the shutter** — shutter is a `div[role="button"]` with no class/aria/id, located positionally (largest role=button in camera pane bottom). Rapid-clicks every 220ms until the photo preview appears, since React's onClick handler can bind a moment after mount.
3. **Click the intermediate Send To** (`button.YatIx.fGS78`) — opens the recipient picker (`ul.s7loS`).
4. **For each recipient**: try direct match → search-input typing → fuzzy substring match → space-collapsed match. Click verified by row state-signature change.
5. **Click the real Send button** (`button.TYX6O[type="submit"]` — the paper-plane icon, *different* from the Send To button). Verified by picker disappearing or home returning.

### Open flow
1. **Scroll the friends sidebar** until target's row + row above are both mounted in the DOM (sidebar is a `ReactVirtualized__Grid`).
2. **Click the row above** — opens that neighbour's chat, leaves the target unselected.
3. **Loop**: find the View icon (`div.HEkDJ.DEp5Z.DClo3.VKjn5`) inside the target's sidebar row → click → wait `snapDwellMs` → click X (`button.h9IpV`) → repeat until no more View icons.

### Friend pulling
1. Click "New Chat" button (`button[title="New Chat"]` / `button.n6VkK`).
2. Wait for picker (`ul.s7loS`).
3. Sort all visible elements by Y position. Walk top-to-bottom tracking section headers (Best Friends / Groups / Friends) and skipping A-Z letter dividers.
4. For each row: extract display name (first text candidate), avatar URL, streak number.
5. Dedup by avatar URL across sections — longer name = canonical, shorter = alias.
6. Press Escape to close picker. Persist to `chrome.storage.local`.

### Storage keys
- `friends: string[]` — flat alphabetical list of canonical names.
- `friendsByCategory: { [section]: string[] }` — grouped.
- `friendsAvatars: { [name]: url }` — Bitmoji URLs.
- `friendsAliases: { [canonical]: string[] }` — alternative spellings per friend.
- `friendsStreaks: { [name]: number }` — current 🔥 streak count.
- `configs: [{ name, recipients, color }]`.
- `stats: { sentByDay, failedByDay, totalSent, totalFailed }`.
- `autoOpenList: string[]` — names ticked in the Open tab.
- Various UI state: `overlayVisible`, `overlayMode`, `overlayPosition`, `autoSnapperRun*`, `autoOpenDwell`, `autoRefreshHours`, `friendsLastPulled`.

## 🔧 Troubleshooting

If selectors break after a Snapchat deploy (their classes are obfuscated and re-mint occasionally), open [diagnostics.js](diagnostics.js), copy it into the Snapchat tab's DevTools console, and call `__diag("home")` / `__diag("camera")` / `__diag("sendto")` after navigating to each screen. The output JSON shows every visible button/input/dialog with classes, text, and aria info — paste that back to me (or use it to update [selectors.js](selectors.js) yourself).

The popup's Activity log captures every step. If something fails, it'll print the exact selector that missed and (where applicable) dump the available alternatives so the next selector update is one-shot.

## ⚠️ Disclaimer

This automates *your own* UI on *your own* account. It uses only public DOM APIs — no credentials, no API calls, no scraping of other users. Snapchat's ToS may still consider automation a violation; use at your own risk.

---

Built by **Bryce Joseph**.
