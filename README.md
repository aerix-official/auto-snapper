<div align="center">

# 📸 Auto Snapper

[![Releases](https://img.shields.io/badge/Releases-Latest-blue?style=flat-square&logo=github)](https://github.com/aerix-official/auto-snapper/releases)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](https://github.com/aerix-official/auto-snapper/blob/main/LICENSE)
[![Downloads](https://img.shields.io/github/downloads/aerix-official/auto-snapper/total?style=flat-square&label=Downloads&color=orange)](https://github.com/aerix-official/auto-snapper/releases)

*A powerful Chrome extension that automates **sending** and **opening** snaps on web.snapchat.com — with multi-account support, anti-detection mitigations, and a ping-pong "send → wait → open → repeat" mode for two-account setups.*

[Features](#-features) • [Installation](#-installation) • [Setup](#-setup) • [Multi-Account](#-multi-account-setup) • [Ping-Pong](#-ping-pong-mode) • [Anti-Detection](#-anti-detection) • [Troubleshooting](#-troubleshooting)

</div>

---

> # ⚠️ IMPORTANT DISCLAIMER — READ BEFORE USE
>
> ### **This extension automates your own UI on your own Snapchat account.**
>
> Snapchat's Terms of Service may consider any UI automation a violation, and bans for "botting snapscore" or similar are a real possibility. The anti-detection features below reduce — but cannot eliminate — that risk.
>
> - **You are solely responsible** for how you use this software.
> - **The author accepts no liability** for any consequences arising from use or misuse, including account bans, lost streaks, lost credentials, or violations of any third-party Terms of Service (Snap Inc., Snapchat, etc.).
> - **Ideally only run this between accounts you control** — your main and an alt. Spamming random friends with automated content is rude and a fast track to a report.
> - This project is an **independent experiment** and is **not affiliated with, endorsed by, or sponsored by** Snap Inc.
>
> **By downloading, installing, or running this extension, you acknowledge that you have read and accepted the above terms.**

---

## 🚀 Features

* **📤 Auto-Send Loop** — Saved recipient configs with per-config color, snap count + ∞ mode, max interval, ± jitter %.
* **📥 Auto-Open Loop** — Auto-views incoming snaps from selected friends via Snapchat's dedicated next-snap chevron (`button.hRnph`).
* **🏓 Ping-Pong Mode** — Send 1 → wait for the partner's reply → open → repeat. Naturally synchronizes between two windows.
* **🪟 In-Page Overlay** — Draggable, glassmorphic shadow-DOM control panel injected into web.snapchat.com. All toggles sync with the popup live.
* **👥 Friend Pulling** — Silent New Chat scrape with Bitmoji avatars, 🔥 streak counts, and section categorization (Best Friends / Groups / Friends). Avatar-based dedup across sections.
* **🎨 Random Captions** — Each outgoing snap gets a random phrase from a configurable pool, applied via Snapchat's built-in caption tool.
* **🔁 Interleaved Opens** — Every N sends the bot views incoming snaps too, with exponential backoff when there's nothing to view.
* **🪟🪟 Multi-Account / Side-by-Side** — Built for two Chrome profiles running in parallel. A MAIN-world focus-spoof keeps both windows "visible + focused" to Snapchat so neither pauses when it loses OS focus.
* **🛡️ Anti-Detection Stack** — Random captions + interleaved opens + cooldown backoff + jitter + focus spoofing all stack together.
* **📊 Live Stats** — Today / this week / all-time send counts plus success rate, updated as you run.
* **♻️ Stop Anywhere** — Stop signal is checked inside every poll, retry, and inter-snap sleep — Stop halts the bot within ~100ms.

---

## 🛠 Supported Modes

| Mode | What it does | Where to enable |
|---|---|---|
| **Auto-send (basic)** | Send N snaps to a saved config at your pace | Send tab → ▶ Start |
| **Auto-send + captions** | Each snap gets a random phrase from your pool | Send tab → ☑ Random caption |
| **Auto-send + interleave opens** | Every N sends, view incoming snaps from same recipients | Send tab → ☑ Interleave opens |
| **Auto-open** | View incoming snaps from a selected friend set | Open tab → ▶ Open snaps |
| **Ping-pong** | Send 1, wait for reply, open, repeat (2-account sync) | Send tab → ☑ Ping-pong |

---

## 📥 Installation

1. **Download** or clone this repository to your local machine.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the project folder.
5. Pin the extension from the puzzle-piece menu — yellow camera-iris icon.
6. Open [web.snapchat.com](https://www.snapchat.com/web/) — works on either `web.snapchat.com` or `www.snapchat.com/web/`.

---

## ⚙ Setup

### 1. Pull your friend list
Click the extension icon → **Friends** tab → **↻ Pull**. The script silently opens the New Chat picker, scrapes everyone (with avatars + streaks), and closes it. Takes ~10 seconds depending on your friend count. Auto-refresh runs at a configurable interval (default 24h) and a stale-data banner appears at the top of the popup if it ever falls behind.

### 2. Save a configuration
**Configs** tab → name it (e.g. "Alt account"), pick recipients, optionally pick a color, click **Save config**. Click any saved config row to load it back into the editor.

### 3. (Optional) Enable anti-detection features
**Send** tab:
- **Random caption** — edit the phrase pool (one per line). Defaults to ~20 short casual phrases.
- **Interleave opens** — set how often (every N sends) to check for incoming snaps.
- **Ping-pong mode** — for the two-account side-by-side flow (see [Ping-Pong](#-ping-pong-mode) below).

---

## 📖 Usage

### Sending
1. **Send** tab → pick your config.
2. Set **snap count** (or **∞** for unlimited), **max interval**, optional **± jitter %**.
3. Click **▶ Start**.

You can also drive everything from the **in-page overlay** on Snapchat — same controls, no popup needed.

### Auto-opening
1. **Open** tab → tick the friends you want auto-opened.
2. Set **dwell time** (how long to watch each snap before clicking through).
3. Click **▶ Open snaps**.

### Editing a config
Click any saved config row in the Configs tab — it loads back into the editor. Save with the same name to overwrite, or a new name to duplicate.

### Backup
- **↓ Export** — JSON of everything (configs + friends + avatars + aliases + streaks).
- **↑ Import** — restores from a backup. Same-named configs are overwritten, others merged.

### ⌨ Keyboard / quick actions
| Action | How |
|---|---|
| Reset to home screen | ↺ button (in popup or overlay) — handy after a failed run |
| Hide overlay | ✕ in the overlay header (re-enable from Friends tab) |
| Stop loop | ■ button (popup or overlay), or any error/cap auto-stops |

---

## 🪟 Multi-Account Setup

Auto Snapper is designed to run in parallel across two (or more) accounts using **separate Chrome profiles** — Chrome's built-in profile isolation gives each account its own cookies, storage, and extension installs.

### Why profiles (not tabs)
A single Chrome profile shares one cookie jar per site. Two Snapchat tabs in the same profile share that jar, so logging in to a second account kicks the first one out. Profiles each get their own jar, their own storage, and their own copy of Auto Snapper — true isolation.

### Setup steps
1. Click your Chrome profile avatar (top-right) → **Add** → create "Account B".
2. In the new profile window, install Auto Snapper from this folder (same Load unpacked flow).
3. Log into Snapchat account B at `web.snapchat.com` in that profile.
4. Pull friends + create configs for account B (use **↓ Export** from A and **↑ Import** into B to copy them).
5. Open both profile windows **side-by-side** — both visible, not minimized.
6. Hit ▶ Start in each.

### Picking a mode for the parallel run
- **Independent send + interleave** — each window sends + opens on its own pace.
- **Ping-pong** — both windows enable Ping-pong; they naturally rate-pair against each other.

### ⚠ Window visibility caveat
The [focus-spoof](#-anti-detection) handles everything Snapchat can detect *from JavaScript*, but **Chrome itself throttles `setTimeout` and pauses video playback when a window is fully minimized or occluded** — that's enforced below the JS sandbox. Keep both windows visible side-by-side (Win+← / Win+→ on Windows). Tiling is fine; minimizing isn't.

---

## 🏓 Ping-Pong Mode

A dedicated loop for the two-account side-by-side flow:

```
   ┌───────────────────────────────┐
   │  1. Send 1 snap to partner    │
   │  2. Return to home screen     │
   │  3. Wait for partner's snap   │
   │  4. Open it (full chain)      │
   │  5. Return home → repeat      │
   └───────────────────────────────┘
```

### How it works
- Uses the **first recipient** in your config as the partner.
- Both windows start by sending, so neither waits forever for an empty inbox.
- Wait timeout is configurable (default 60s). If the partner doesn't respond, the bot sends another snap and tries again.
- After 3 consecutive timeouts the log surfaces a louder "heads up" so you notice if the other window died.
- Captions still apply. Open-tab dwell is reused for incoming snaps.
- The Send tab's count / interval / jitter / interleave settings are **ignored** when ping-pong is on — pacing is set by send latency + partner latency.

### To enable
Both windows → **Send** tab → toggle **Ping-pong mode** on → set wait seconds → click **▶ Start**.

---

## 🛡 Anti-Detection

Snapchat does flag obvious bot patterns. There's no way to fully hide automation from a sophisticated server-side detector, but the following features stack to make traffic look much more like a real user:

| Feature | What it does | Where |
|---|---|---|
| **Random caption** | Adds a varied text caption to each outgoing snap. Breaks per-snap content uniformity. | Send tab → ☑ Random caption |
| **Interleave opens** | Periodically views incoming snaps from the same recipients you send to. Makes the account a two-way user instead of a pure emitter. | Send tab → ☑ Interleave opens |
| **Interleave backoff** | When an open pass finds nothing, skip 1 → 2 → 3 → 4 future passes instead of re-scanning every cycle. Resets on the first non-empty pass. | Automatic |
| **Ping-pong mode** | Bot only sends *after* receiving. Pace matches the partner's pace. | Send tab → ☑ Ping-pong |
| **± jitter %** | Randomizes the inter-snap interval so cadence isn't suspiciously regular. | Send tab → Max interval column |
| **Focus spoof** | MAIN-world override of `document.hidden` / `visibilityState` / `hasFocus()` + event swallowing for `visibilitychange` / `blur` / `pagehide` / `freeze`. Keeps Snapchat thinking the tab is visible + focused. | Always on ([focus-spoof.js](focus-spoof.js)) |
| **Strict recipient match** | Word-boundary prefix matching only — prevents the "bot sent to the wrong person" bug when someone recently messaged you. | Always on |

**What this project deliberately does NOT do**: bypass `isTrusted` checks, fight browser-level timer throttling, hit private Snapchat APIs, or touch credentials. Everything operates on public DOM only.

---

## 🗂 File Map

| File | Purpose |
|---|---|
| [manifest.json](manifest.json) | MV3 manifest. Two content-script entries: focus-spoof at `document_start` in MAIN world, main scripts at `document_idle` in isolated world. |
| [selectors.js](selectors.js) | Centralized selectors for Snapchat UI elements. Confirmed via DOM diagnostics. |
| [content.js](content.js) | Main content script — send loop, open loop, ping-pong loop, scraper, message handler. |
| [overlay.js](overlay.js) | Floating in-page control panel via shadow DOM. Includes the same anti-detection / ping-pong toggles as the popup. |
| [focus-spoof.js](focus-spoof.js) | MAIN-world script overriding Page Visibility / focus APIs. |
| [background.js](background.js) | MV3 service worker. Buffers ~200 lines of log so the popup can render history even after being closed. |
| [popup.html](popup.html) / [popup.js](popup.js) | Toolbar popup UI: Send / Open / Configs / Friends tabs. |
| [diagnostics.js](diagnostics.js) | Standalone DOM-probe script for re-locking selectors when Snapchat ships a UI update. |
| [icons/](icons/) | Extension icons (16, 32, 48, 128px) — yellow camera-aperture mark. |

---

## 🧠 How It Works (Technical Notes)

### Send flow — [`runOneSnap`](content.js)
1. **`navigateToCamera()`** handles every starting state (home / camera / photo preview). Waits 300ms for state to stabilize before deciding what to click.
2. **`clickRapidly()` on the shutter** — shutter is a `div[role="button"]` with no class/aria/id, located positionally. Rapid-clicks every 220ms until the photo preview appears.
3. **`applyRandomCaption()`** (optional) — clicks `button.xHw7V.T0LP0` (or `[title="Add a caption"]`), types via `execCommand("insertText")` on the contenteditable, commits with `blur()` + Enter. Hard-rejects close-X / camera-circle / Send-To classes so it can't grab the wrong button.
4. **Sanity check** — `isOnPhotoPreview()` must be true. If anything dismissed the snap, fail loudly.
5. **Open recipient picker** by clicking `button.YatIx.fGS78` (the intermediate "Send To").
6. **For each recipient** — try direct match (exact / case-insensitive) → search-input typing → word-boundary prefix (min 3-char overlap). Click verified by row state-signature change.
7. **Click the real Send** — `button.TYX6O[type="submit"]` (paper-plane icon, distinct from Send To). Verified by picker disappearing.

### Open flow — [`openSnapFromFriend`](content.js)
1. **Scroll the friends sidebar** until the target row is mounted (the sidebar is virtualized).
2. **Click the View icon** (`div.HEkDJ.DEp5Z.DClo3` and 4-class variant). Loose single-class fallbacks were removed — they false-matched chat/streak icons.
3. **Confirm `isSnapViewerOpen()`** — strict check for `button.h9IpV` OR `div.b2f4R`. No fallbacks from other panes.
4. **Click-through loop** per cycle:
   - Snapshot viewer signature.
   - Dwell `snapDwellMs`.
   - If viewer closed → exit.
   - If signature changed → wait 250ms more → re-snapshot. If stable at new value, **Snapchat auto-advanced** — skip click. If still changing, loading-state churn — click anyway.
   - Click `button.hRnph` (the next-snap chevron). Falls back to viewer container, then `elementFromPoint`.
   - After click, wait 180ms and re-check signature. If unchanged for 2 consecutive cycles → end of chain, force-close.
5. **Caps**: 60 snaps per friend (hard) and 6 minutes wall-clock (defensive). Hitting either force-closes via `button.h9IpV` or Escape.

### Ping-pong loop — [`runPingPongLoop`](content.js)
1. Send a snap via `runOneSnap`.
2. `ensureHomeScreen()` so the sidebar is visible.
3. `waitForIncomingSnap(partner, timeoutMs)` — polls every 1s for a View icon on the partner's row, re-scrolls every 5s, heartbeats every 10s.
4. If received → `openSnapFromFriend(partner, snapDwellMs)`.
5. `ensureHomeScreen()` → loop.

If the wait times out, log + send another snap. Three consecutive timeouts surfaces a louder warning so the user notices the other window may have died.

### Interleave-open backoff — [`runLoop`](content.js)
- Every `everyN` snaps, runs a `runOpenPass` against the same recipients.
- After each pass:
  - `viewed === 0` → increment `consecutiveEmptyOpens` (max 4), skip that many future interleave windows.
  - `viewed > 0` → reset counter, every-cycle checks resume.
- Naturally pauses opens when the partner is offline.

### Focus spoof — [focus-spoof.js](focus-spoof.js)
Runs at `document_start` in MAIN world (Manifest V3 `world: "MAIN"`) before Snapchat's bundle loads:
- `Document.prototype.hidden` / `webkitHidden` → `false`
- `Document.prototype.visibilityState` / `webkitVisibilityState` → `"visible"`
- `Document.prototype.hasFocus` → `() => true`
- Capture-phase `stopImmediatePropagation` on `visibilitychange` / `webkitvisibilitychange` / `pagehide` / `freeze`, plus **window-target** `blur` / `focusout` (form-input blur passes through — needed by the recipient search).

Confirmation: `[AutoSnapper] focus-spoof active` appears in the console.

### Storage keys
| Key | Type | Purpose |
|---|---|---|
| `friends` | `string[]` | Flat alphabetical list of canonical names |
| `friendsByCategory` | `{ [section]: string[] }` | Grouped by section |
| `friendsAvatars` | `{ [name]: url }` | Bitmoji URLs |
| `friendsAliases` | `{ [canonical]: string[] }` | Alternative spellings per friend |
| `friendsStreaks` | `{ [name]: number }` | Current 🔥 streak count |
| `configs` | `[{ name, recipients, color }]` | Saved recipient configurations |
| `stats` | `{ sentByDay, failedByDay, totalSent, totalFailed }` | Live counters |
| `autoOpenList` | `string[]` | Names ticked in the Open tab |
| `autoOpenDwell` | `number` | ms to wait on each incoming snap |
| `captionEnabled` / `captionPool` | `bool` / `string[]` | Caption mode + phrase pool |
| `interleaveOpensEnabled` / `interleaveOpensEveryN` | `bool` / `number` | Interleave mode + cadence |
| `pingPongEnabled` / `pingPongWaitSeconds` | `bool` / `number` | Ping-pong mode + wait timeout |

---

## 🔧 Troubleshooting

### Selectors broke after a Snapchat deploy
Their classes are obfuscated and re-mint occasionally. Open [diagnostics.js](diagnostics.js), copy it into the Snapchat tab's DevTools console, and call `__diag("home")` / `__diag("camera")` / `__diag("sendto")` after navigating to each screen. The output JSON shows every visible button/input/dialog with classes, text, and aria info — use that to update [selectors.js](selectors.js).

### Caption button can't be found
Log shows `caption: text tool not found — skipping`. Snapchat probably re-minted `T0LP0`. The title attribute (`button[title="Add a caption"]`) is the resilient fallback and should usually still match — if it doesn't, inspect the live caption button and update `textToolButton.cssSelector` in [selectors.js](selectors.js).

### Background window's clicks aren't registering
- Make sure both windows are **visible** (side-by-side, not minimized or fully covered).
- Open DevTools in the bad window and check for `[AutoSnapper] focus-spoof active`. If missing, hard-refresh (Ctrl+F5).
- Verify in the console: `document.hidden` should print `false` and `document.hasFocus()` should print `true` even when the window isn't focused.

### Wrong-person picks during a Send
The new strict matching makes this very hard, but if it ever happens, the log will say `matched row "<actual>" for wanted "<wanted>" (fuzzy)`. Grab that line. Most likely fix is a config-side tweak: add the actual rendered name as an alias.

### Open flow keeps trying to open after all snaps are viewed
Should be fixed by the strict `isSnapViewerOpen()` check + signature stuck-detection. If you still see it, the log lines around the symptom (`viewer closed after N snaps`, `viewer didn't advance after 2 clicks`, `hit per-friend cap`, `wall-clock cap`) will identify which exit tripped.

### "It opens snaps but doesn't resume sending"
That's the interleave cooldown working as designed. The log line `Skipping interleave open pass (cooldown, N left)` confirms it. Either keep sending (the cooldown is a finite skip count) or have your partner snap you to reset.

---

## ⚠ Disclaimer

This tool automates *your own* UI on *your own* Snapchat account. It uses only public DOM APIs — no credentials, no backend API calls, no scraping of other users. Snapchat's ToS may still consider any automation a violation; account action up to and including a permanent ban is possible. Use responsibly; ideally only between accounts you control.

---

<div align="center">
  <sub>Built by <strong>Bryce Joseph</strong>. Use responsibly.</sub>
</div>
