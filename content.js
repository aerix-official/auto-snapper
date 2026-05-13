// content.js
// Runs on https://web.snapchat.com/*. Exposes the automation primitives
// (find element, wait for clickable, click) and orchestrates the
// camera -> capture -> send-to -> select recipients -> send loop.

(() => {
  const SEL = window.SNAP_SELECTORS;

  // ---------- low-level utilities ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Sleep that checks the stop flag every 100ms and throws if the user
  // requested a stop. Use this anywhere the loop might sit idle for a while
  // (e.g. between snaps) so clicking Stop takes effect quickly.
  async function abortableSleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (state.stop) throw new Error("stopped");
      await sleep(Math.min(100, end - Date.now()));
    }
  }

  // Wait between snaps. Polls every 80ms — exits as soon as Snapchat finishes
  // its send animation and the camera/shutter is ready again, so we don't sit
  // idle when the UI is already prepared for the next capture. Hard-capped
  // at `maxMs` (the user-set interval) to give a small spacing buffer.
  async function abortableWaitUntilReady(maxMs) {
    const end = Date.now() + maxMs;
    while (Date.now() < end) {
      if (state.stop) throw new Error("stopped");
      // Ready means: navigateToCamera will succeed quickly. Either we're
      // on clean camera (with shutter findable), OR we're on photo preview
      // (so we can dismiss it). Either is recoverable in <1s.
      const cleanCam = isOnCleanCamera() && !!findCaptureButton();
      const onPreview = isOnPhotoPreview();
      const onHome = !!document.querySelector("button.qJKfS");
      if (cleanCam || onPreview || onHome) return;
      await sleep(80);
    }
  }

  // Wait until the high-level page state hasn't changed for `stableMs`. Used
  // to avoid trusting transitional animation frames when the UI is settling
  // after a Send. Capped at `maxMs` so we don't hang.
  async function waitForStableState(stableMs = 300, maxMs = 1500) {
    const snapshot = () => [
      !!document.querySelector("button.qJKfS"),
      isOnPhotoPreview(),
      document.querySelectorAll("button.FBYjn").length,
    ].join("|");
    let prev = snapshot();
    let stableSince = Date.now();
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (state.stop) throw new Error("stopped");
      await sleep(60);
      const cur = snapshot();
      if (cur !== prev) {
        prev = cur;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= stableMs) {
        return;
      }
    }
  }

  // Get to a clean camera view from any plausible starting state.
  async function navigateToCamera() {
    const stateStr = () =>
      `qJKfS=${!!document.querySelector("button.qJKfS")} STlkX=${isOnPhotoPreview()}` +
      ` FBYjn=${document.querySelectorAll("button.FBYjn").length} cap=${!!findCaptureButton()}`;

    // Wait for the page state to settle before checking anything. Right after
    // a Send, Snapchat's UI passes through a transitional frame that looks
    // like clean camera (lens icons mounted, no STlkX) before snapping back
    // to the steady-state photo preview. We wait until the state hasn't
    // changed for 300ms before trusting it.
    await waitForStableState(300, 1500);

    if (isOnCleanCamera() && !!findCaptureButton()) {
      log("  already on clean camera (stable)");
      return;
    }
    log(`  navigate start: ${stateStr()}`);

    const fireEscape = () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, which: 27, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", keyCode: 27, which: 27, bubbles: true }));
    };

    const start = Date.now();
    let iters = 0;
    while (Date.now() - start < 5000) {
      iters++;
      if (state.stop) throw new Error("stopped");

      // Done?
      if (isOnCleanCamera() && !!findCaptureButton()) {
        log(`  reached clean camera (after ${iters} iter, ${Date.now() - start}ms)`);
        return;
      }

      // On home — click the big camera circle.
      if (document.querySelector("button.qJKfS")) {
        log(`  iter ${iters}: on home, clicking camera circle`);
        const cam = findCameraButton();
        if (cam && isVisible(cam)) await realClick(cam);
        await sleep(300);
        continue;
      }

      // On photo preview — try the close X, then Escape if that didn't dismiss.
      if (isOnPhotoPreview()) {
        const close = document.querySelector("button.xHw7V.STlkX");
        if (close && isVisible(close)) {
          log(`  iter ${iters}: on photo preview, clicking close X (xHw7V STlkX)`);
          await realClick(close);
          await sleep(280);
          if (!isOnPhotoPreview()) {
            log(`    photo preview dismissed (${stateStr()})`);
          } else {
            log("    photo preview still showing — falling back to Escape");
            fireEscape();
            await sleep(280);
          }
        } else {
          log(`  iter ${iters}: photo preview detected but close X not found, Escape`);
          fireEscape();
          await sleep(280);
        }
        continue;
      }

      // Unknown state.
      log(`  iter ${iters}: unknown state (${stateStr()}), trying Escape`);
      fireEscape();
      await sleep(280);
    }

    // Loop didn't reach camera — fall back to a guaranteed home → camera.
    log(`  navigate loop timed out at ${stateStr()}; forcing home → camera`);
    await ensureHomeScreen();
    const cam = await waitClickable(findCameraButton, {
      timeout: 5000, label: "camera button", settleMs: 50,
    });
    await realClick(cam);
    await waitFor(
      () => isOnCleanCamera() && !!findCaptureButton(),
      { timeout: 6000, label: "camera ready (fallback)" }
    );
    log("  reached clean camera via fallback");
  }

  function checkStop() {
    if (state.stop) throw new Error("stopped");
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || s.opacity === "0") return false;
    return true;
  }

  function isClickable(el) {
    if (!isVisible(el)) return false;
    const s = getComputedStyle(el);
    if (s.pointerEvents === "none") return false;
    if (el.disabled) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    // Confirm element (or a child) is the topmost at its center.
    const r = el.getBoundingClientRect();
    const cx = Math.floor(r.left + r.width / 2);
    const cy = Math.floor(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    if (!top) return false;
    return top === el || el.contains(top) || top.contains(el);
  }

  async function waitFor(predicate, { timeout = 15000, interval = 60, label = "element", settleMs = 0 } = {}) {
    const start = Date.now();
    let lastErr;
    while (Date.now() - start < timeout) {
      checkStop();
      try {
        const v = predicate();
        if (v) {
          if (!settleMs) return v;
          // Settle: let React finish mounting / binding handlers, then verify
          // the element is still satisfying the predicate before returning.
          // If it stops matching, fall through and keep polling.
          await sleep(settleMs);
          checkStop();
          const v2 = predicate();
          if (v2) return v2;
        }
      } catch (e) {
        if (e.message === "stopped") throw e;
        lastErr = e;
      }
      await sleep(interval);
    }
    throw new Error(`waitFor(${label}) timed out after ${timeout}ms${lastErr ? `: ${lastErr.message}` : ""}`);
  }

  async function waitClickable(predicate, opts = {}) {
    return waitFor(() => {
      const el = predicate();
      return el && isClickable(el) ? el : null;
    }, opts);
  }

  // Loose variant — skips the "topmost element at center" check. For elements
  // we located by selector and are confident about (e.g. button.YatIx.fGS78),
  // the topmost check is overly strict: if a sibling overlay is rendered atop
  // the button's coordinates, elementFromPoint returns the sibling and we
  // wrongly conclude the button isn't clickable. Use this for buttons whose
  // identity we trust.
  async function waitClickableLoose(predicate, opts = {}) {
    return waitFor(() => {
      const el = predicate();
      if (!el || !isVisible(el)) return null;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") return null;
      const s = getComputedStyle(el);
      if (s.pointerEvents === "none") return null;
      return el;
    }, opts);
  }

  // Click `target`, then poll `verifyFn` for up to `timeout`ms looking for the
  // expected post-state (e.g. "share pane has Send To button visible"). If the
  // verifier never returns true, retry the click up to `retries` times before
  // giving up. Returns whether the click ultimately took effect.
  // Rapid-click: keep clicking the target every `clickInterval`ms until the
  // verifier passes or `totalTimeout` runs out. Verifier polls between
  // clicks at `verifyInterval`. Use this for idempotent actions (capture,
  // open camera) where re-clicking a missed click is safe.
  async function clickRapidly(target, verifyFn, opts = {}) {
    const {
      totalTimeout = 3000,
      clickInterval = 250,
      verifyInterval = 50,
      hold = 0,
      label = "click",
      refind = null, // optional: () => Element to re-acquire if target detaches
    } = opts;
    const start = Date.now();
    let clicks = 0;
    let cur = target;

    while (Date.now() - start < totalTimeout) {
      checkStop();

      // Already succeeded? Don't click further.
      try {
        if (await verifyFn()) {
          if (clicks > 1) log(`    ${label}: confirmed after ${clicks} click(s)`);
          return true;
        }
      } catch {}

      // If our target detached and we have a re-find, swap to a fresh ref.
      if (cur && !cur.isConnected && refind) {
        const fresh = refind();
        if (fresh) cur = fresh;
      }
      if (!cur || !cur.isConnected || !isVisible(cur)) {
        // Target gone, no fresh ref — assume the click already took effect.
        if (clicks > 0) {
          log(`    ${label}: target detached after ${clicks} click(s) — assuming success`);
          return true;
        }
        return false;
      }

      await realClick(cur, { hold });
      clicks++;

      // Verify rapidly between clicks.
      const next = Date.now() + clickInterval;
      while (Date.now() < next) {
        checkStop();
        await sleep(verifyInterval);
        try {
          if (await verifyFn()) {
            if (clicks > 1) log(`    ${label}: confirmed after ${clicks} click(s)`);
            return true;
          }
        } catch {}
      }
    }
    log(`    ${label}: ${clicks} click(s), verifier never passed`);
    return false;
  }

  async function clickAndVerify(target, verifyFn, opts = {}) {
    const { timeout = 4000, retries = 2, hold = 0, interval = 60, label = "click" } = opts;
    for (let attempt = 0; attempt <= retries; attempt++) {
      checkStop();
      if (attempt > 0) log(`    ${label}: retry ${attempt}/${retries}`);
      await realClick(target, { hold });
      const start = Date.now();
      while (Date.now() - start < timeout) {
        checkStop();
        await sleep(interval);
        try {
          if (await verifyFn()) {
            if (attempt > 0) log(`    ${label}: succeeded on retry ${attempt}`);
            return true;
          }
        } catch {}
      }
    }
    log(`    ${label}: verification still failing after ${retries + 1} click(s)`);
    return false;
  }

  // Single-fire variant of realClick. Identical to realClick BUT does NOT
  // call el.click() at the end. realClick's native fallback fires the onClick
  // handler a second time on idempotent UI; for the snap viewer (which
  // advances on every click), that doubles every click and skips snaps.
  async function realClickSingle(el, { hold = 0 } = {}) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const baseOpts = {
      bubbles: true, cancelable: true, view: window,
      clientX: cx, clientY: cy, screenX: cx, screenY: cy,
      button: 0, buttons: 1,
    };
    const ptrOpts = {
      ...baseOpts,
      pointerId: 1, pointerType: "mouse", isPrimary: true,
      pressure: 0.5, width: 1, height: 1,
    };

    el.dispatchEvent(new PointerEvent("pointerdown", ptrOpts));
    el.dispatchEvent(new MouseEvent("mousedown", baseOpts));
    if (hold > 0) await sleep(hold);
    el.dispatchEvent(new PointerEvent("pointerup", { ...ptrOpts, pressure: 0, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("mouseup", { ...baseOpts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("click", baseOpts));
    // Intentionally no el.click() — exactly one click event.
  }

  // Real-ish click. Dispatches the full pointer + mouse + click sequence so
  // React handlers fire, with optional hold for "press and hold" buttons (the
  // shutter on Snapchat web is "tap = photo, hold = video"). Falls back to the
  // native el.click() afterwards as a belt-and-suspenders measure.
  async function realClick(el, { hold = 0 } = {}) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const baseOpts = {
      bubbles: true, cancelable: true, view: window,
      clientX: cx, clientY: cy, screenX: cx, screenY: cy,
      button: 0, buttons: 1,
    };
    const ptrOpts = {
      ...baseOpts,
      pointerId: 1, pointerType: "mouse", isPrimary: true,
      pressure: 0.5, width: 1, height: 1,
    };

    el.dispatchEvent(new PointerEvent("pointerover", ptrOpts));
    el.dispatchEvent(new MouseEvent("mouseover", baseOpts));
    el.dispatchEvent(new PointerEvent("pointerenter", ptrOpts));
    el.dispatchEvent(new MouseEvent("mouseenter", baseOpts));
    el.dispatchEvent(new MouseEvent("mousemove", baseOpts));
    el.dispatchEvent(new PointerEvent("pointerdown", ptrOpts));
    el.dispatchEvent(new MouseEvent("mousedown", baseOpts));
    if (hold > 0) await sleep(hold);
    el.dispatchEvent(new PointerEvent("pointerup", { ...ptrOpts, pressure: 0, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("mouseup", { ...baseOpts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("click", baseOpts));

    // Native click fallback — fires React's onClick if our synthetic chain missed.
    try { el.click?.(); } catch {}
  }

  // ---------- finders ----------

  function queryByAriaLabel(labels, root = document) {
    for (const l of labels) {
      const el = root.querySelector(`[aria-label="${cssEscape(l)}"]`);
      if (el) return el;
      // Case-insensitive fallback
      const all = root.querySelectorAll("[aria-label]");
      for (const e of all) {
        if (e.getAttribute("aria-label")?.toLowerCase() === l.toLowerCase()) return e;
      }
    }
    return null;
  }

  function cssEscape(s) {
    return s.replace(/(["\\])/g, "\\$1");
  }

  function queryByText(texts, { root = document, equals = true, tags = ["button", "[role=button]", "div", "span", "a"] } = {}) {
    const sel = tags.join(",");
    const candidates = root.querySelectorAll(sel);
    for (const el of candidates) {
      const t = (el.textContent || "").trim();
      if (!t) continue;
      if (equals) {
        for (const wanted of texts) if (t === wanted) return el;
      } else {
        for (const wanted of texts) if (t.toLowerCase().includes(wanted.toLowerCase())) return el;
      }
    }
    return null;
  }

  function queryByPlaceholder(placeholders, root = document) {
    for (const p of placeholders) {
      const el = root.querySelector(`input[placeholder="${cssEscape(p)}"], textarea[placeholder="${cssEscape(p)}"]`);
      if (el) return el;
    }
    return null;
  }

  function findCameraButton() {
    // Confirmed selector from diagnostics: button.qJKfS is the big circular
    // "Click the camera to send Snaps" button on the home screen.
    if (SEL.cameraButton.cssSelector) {
      const el = document.querySelector(SEL.cameraButton.cssSelector);
      if (el && isVisible(el)) return el;
    }
    // Fallback: largest circular button (in case Snapchat re-mints the class).
    const min = SEL.cameraButton.largeCircleMinSize || 140;
    return findLargestCircularButton(min);
  }

  function findCaptureButton() {
    // The shutter is a <div role="button" class=""> in the camera pane,
    // bottom-center, ~52×52. We refuse to return anything until the camera
    // UI has actually loaded — confirmed by the row of `button.FBYjn` lens
    // icons being mounted. If we returned a candidate too early, we'd click
    // a transitional element before React wires up the real shutter's handler.
    const lensCount = document.querySelectorAll("button.FBYjn").length;
    if (lensCount < 3) return null; // camera UI hasn't fully rendered yet

    // qJKfS is the home-screen camera circle; if it's still here we never
    // entered camera mode at all.
    if (document.querySelector("button.qJKfS")) return null;

    const sidebar = document.querySelector('div.QAr02[role="list"]');
    const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : 340;
    const cfg = SEL.captureButton;
    const minSize = cfg.minSize || 40;
    const bottomY = window.innerHeight * (cfg.bottomFraction || 0.55);

    const candidates = [...document.querySelectorAll('button, [role="button"], div[role="button"]')]
      .filter((el) => isVisible(el))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.left < sidebarRight - 5) return false;          // right of friends feed
        if (r.top + r.height / 2 < bottomY) return false;     // bottom band
        if (r.width < minSize || r.height < minSize) return false;
        if (r.width > 200 || r.height > 200) return false;    // not the viewport
        return true;
      });

    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
    return candidates[0];
  }

  // The "Send To" button (class YatIx fGS78, text "Send To") and the actual
  // send button are the same element on web Snapchat — there's no separate
  // recipient dialog. We keep both finders pointing at it for clarity.
  function findSendToButton() {
    const el = document.querySelector(SEL.sendToButton.cssSelector);
    if (el && isVisible(el)) return el;
    return queryByText(SEL.sendToButton.textEquals);
  }

  // The REAL submit button (paper-plane Send) that fires after recipients
  // are picked. NOT the same as findSendToButton — that one only opens the
  // picker. Falls back to any submit button whose visible text is exactly
  // "Send" inside the share pane.
  function findSendButton() {
    const el = document.querySelector(SEL.sendButton.cssSelector);
    if (el && isVisible(el)) return el;
    const sidebar = document.querySelector('div.QAr02[role="list"]');
    const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : 340;
    const submits = [...document.querySelectorAll('button[type="submit"]')];
    for (const b of submits) {
      if (!isVisible(b)) continue;
      const r = b.getBoundingClientRect();
      if (r.left < sidebarRight - 5) continue;
      const t = (b.textContent || "").trim();
      if (t === "Send" || /^Send\s*$/i.test(t)) return b;
    }
    // Loosest fallback: any button with exactly "Send" text in the share pane.
    for (const b of document.querySelectorAll("button, [role='button']")) {
      if (!isVisible(b)) continue;
      const r = b.getBoundingClientRect();
      if (r.left < sidebarRight - 5) continue;
      if ((b.textContent || "").trim() === "Send") return b;
    }
    return null;
  }

  // Diagnostic when Send To can't be found / clicked. Prints what's actually
  // visible in the share pane so we can see whether the picker was dismissed,
  // the button is disabled, or the layout changed.
  function dumpSharePaneDiagnostics() {
    const sidebar = document.querySelector('div.QAr02[role="list"]');
    const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : 340;
    const buttons = [...document.querySelectorAll("button, [role='button']")]
      .filter((b) => {
        if (!isVisible(b)) return false;
        const r = b.getBoundingClientRect();
        return r.left >= sidebarRight - 5;
      })
      .slice(0, 20)
      .map((b) => {
        const r = b.getBoundingClientRect();
        return {
          tag: b.tagName,
          cls: (b.className || "").toString().slice(0, 40),
          text: (b.textContent || "").trim().slice(0, 30),
          disabled: b.disabled || b.getAttribute("aria-disabled"),
          rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        };
      });
    log(`    share-pane buttons (${buttons.length}): ${JSON.stringify(buttons)}`);
  }

  function findRecipientPicker() {
    // Originally ul.s7loS, but Snapchat re-mints obfuscated class hashes between
    // deploys. So we try the known class first, then fall back to structural
    // detection: any visible UL in the share pane (right of the friends feed)
    // that's tall enough to be a friend list. If that fails too, we walk up
    // from the Send To button and find the nearest scrollable list inside the
    // share pane.

    // 1) Pinned class (fast path).
    let el = document.querySelector(SEL.recipientPicker.cssSelector);
    if (el && isVisible(el)) return el;

    const sidebar = document.querySelector('div.QAr02[role="list"]');
    const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : 340;

    // 2) Any UL in the share pane that's tall enough to be a list.
    for (const ul of document.querySelectorAll("ul")) {
      if (!isVisible(ul)) continue;
      const r = ul.getBoundingClientRect();
      if (r.left < sidebarRight - 5) continue;
      if (r.height < 100) continue;
      // Must contain at least a couple of LI children (real recipient rows).
      if (ul.children.length < 1) continue;
      return ul;
    }

    // 3) Walk up from the Send To button to find the share pane, then look
    //    inside for a scrollable container that holds the friend list.
    const sendBtn = document.querySelector(SEL.sendToButton.cssSelector);
    if (sendBtn) {
      let cur = sendBtn;
      for (let i = 0; i < 10 && cur; i++) {
        cur = cur.parentElement;
        if (!cur) break;
        // Prefer a UL inside this ancestor.
        const ul = [...cur.querySelectorAll("ul")].find((u) => isVisible(u));
        if (ul) return ul;
        // Otherwise the largest scrollable descendant.
        const scrollable = [...cur.querySelectorAll("*")].find((e) => {
          if (!isVisible(e)) return false;
          const s = getComputedStyle(e);
          return (
            (s.overflowY === "auto" || s.overflowY === "scroll") &&
            e.scrollHeight > e.clientHeight + 10
          );
        });
        if (scrollable) return scrollable;
      }
    }

    return null;
  }

  // Walk upward to the nearest button-like clickable ancestor.
  function clickableAncestor(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      if (
        cur.tagName === "BUTTON" ||
        cur.getAttribute("role") === "button" ||
        cur.onclick ||
        getComputedStyle(cur).cursor === "pointer"
      ) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return el;
  }

  function findLargestCircularButton(minSize = 0) {
    const all = document.querySelectorAll('button, [role="button"]');
    let best = null;
    let bestArea = 0;
    for (const el of all) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < minSize || r.height < minSize) continue;
      const s = getComputedStyle(el);
      const radius = parseFloat(s.borderRadius);
      // "Circular-ish" — square dims, large radius
      if (Math.abs(r.width - r.height) < 8 && (radius >= r.width / 2 - 4 || s.borderRadius.endsWith("%"))) {
        const area = r.width * r.height;
        if (area > bestArea) {
          best = el;
          bestArea = area;
        }
      }
    }
    return best;
  }

  function findBottomCenterCircleButton() {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const all = document.querySelectorAll('button, [role="button"], div[tabindex="0"]');
    let best = null;
    let bestScore = -Infinity;
    for (const el of all) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      // Want: large, near bottom, near horizontal center.
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const horizCenterDist = Math.abs(cx - vw / 2);
      const bottomDist = vh - cy;
      const sizeOk = r.width >= 50 && r.height >= 50;
      if (!sizeOk) continue;
      // Score: bigger + closer to center + closer to bottom
      const score = r.width * r.height - horizCenterDist * 2 - bottomDist * 1.5;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function nearbyClickableButton(el) {
    // Find a button within reasonable distance of `el` in DOM.
    let cur = el;
    for (let i = 0; i < 6 && cur; i++) {
      cur = cur.parentElement;
      if (!cur) break;
      const btn = cur.querySelector('button, [role="button"]');
      if (btn && isVisible(btn)) return btn;
    }
    return null;
  }

  // ---------- recipient list scraping ----------

  // Snapchat's recipient picker has section headers ("Best Friends", "Recents",
  // "Groups", "Friends") interleaved with friend rows. As we scroll, we walk
  // visible children top-to-bottom and track which section we're currently in,
  // so each scraped name gets a category attached. Returns:
  //   { names: [...flat sorted...], byCategory: { "Best Friends": [...], ... } }
  async function scrapeRecipients({ onProgress } = {}) {
    const picker = await waitFor(findRecipientPicker, { timeout: 8000, label: "recipient picker" });
    const scroller = findScroller(picker);
    if (!scroller) throw new Error("Couldn't locate recipient scroller");

    const seen = new Map(); // name -> { section, row }
    let lastTop = -1;
    let stableRounds = 0;

    scroller.scrollTop = 0;
    await sleep(300);

    // Dump one sample row per section the first time we encounter it. That
    // way we see Best Friends AND alphabetical Friends rows, not just the
    // first 3 (which are always Best Friends).
    const sampledSections = new Set();

    while (stableRounds < 3) {
      // Walk the scroller's currently-rendered descendants in TOP-TO-BOTTOM
      // visual order so section headers correctly bracket the rows below them.
      const ordered = [...scroller.querySelectorAll("*")]
        .filter(isVisible)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

      let currentSection = "Friends"; // default if no header seen yet
      const sectionsSeenThisPass = new Set();
      for (const el of ordered) {
        // A-Z letter dividers signal we're in the alphabetical Friends list.
        // Snapchat doesn't always render an explicit "Friends" header before
        // the A-Z dividers, so we infer it here. This also rescues rows from
        // being stuck under a stale "Groups" section.
        if (isLetterDivider(el)) {
          currentSection = "Friends";
          continue;
        }
        const header = detectSectionHeader(el);
        if (header) {
          if (sectionsSeenThisPass.has(header)) continue;
          sectionsSeenThisPass.add(header);
          currentSection = header;
          continue;
        }
        // Skip rows in excluded sections (e.g. Recents) — they're noise.
        if (EXCLUDED_SECTIONS.has(currentSection)) continue;
        const name = extractNameFromRow(el);
        if (name && !seen.has(name)) {
          const avatar = extractAvatarFromRow(el);
          const username = extractUsernameFromRow(el);
          const streak = extractStreakFromRow(el);
          seen.set(name, { section: currentSection, row: el, avatar, username, streak });

          // Sample first row in each new section for diagnostics.
          if (!sampledSections.has(currentSection)) {
            sampledSections.add(currentSection);
            const r = el.getBoundingClientRect();
            const sample = {
              section: currentSection,
              tag: el.tagName,
              cls: (el.className || "").toString().slice(0, 60),
              cands: rowTextCandidates(el).slice(0, 5),
              dataAttrs: Object.fromEntries(
                [...el.attributes].filter((a) => a.name.startsWith("data-") || a.name === "title" || a.name.startsWith("aria-"))
                  .map((a) => [a.name, a.value])
              ),
              avatar: avatar?.slice(0, 60) || null,
              rect: `${Math.round(r.width)}x${Math.round(r.height)}`,
              html: (el.outerHTML || "").replace(/\s+/g, " ").slice(0, 500),
            };
            log(`  row sample [${currentSection}]: ${JSON.stringify(sample)}`);
          }
        }
      }
      onProgress?.({ count: seen.size });

      const beforeTop = scroller.scrollTop;
      const step = Math.max(80, scroller.clientHeight * 0.8);
      // Set scrollTop directly AND dispatch wheel — some virtualized lists
      // (Snapchat included) only fetch more rows when they see a wheel event.
      scroller.scrollTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight);
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: step, bubbles: true, cancelable: true }));
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(350);

      if (Math.abs(scroller.scrollTop - lastTop) < 4 && Math.abs(scroller.scrollTop - beforeTop) < 4) {
        stableRounds++;
      } else {
        stableRounds = 0;
      }
      lastTop = scroller.scrollTop;
    }

    // Dedup people who appear in multiple sections — Best Friends often shows
    // a truncated display name ("Huddy D"), while the alphabetical Friends
    // section shows the full one ("Huddy the Diddler"). Same person, same
    // Bitmoji URL → same identity. Keep the longer name as canonical, store
    // the shorter as an alias, and use the highest-priority section.
    const sectionRank = (s) => {
      const i = ["Best Friends", "Groups", "My Friends", "Friends", "Subscriptions", "Quick Add", "Suggested Friends"].indexOf(s);
      return i === -1 ? 999 : i;
    };
    const stripAvatarQS = (u) => (u ? u.split("?")[0] : null);

    const byKey = new Map(); // avatar-key -> { canonical, aliases, section, avatar, username }
    const noKeyEntries = [];

    for (const [name, info] of seen) {
      const key = stripAvatarQS(info.avatar);
      if (!key) {
        noKeyEntries.push({ name, info });
        continue;
      }
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          canonical: name,
          aliases: [],
          section: info.section,
          avatar: info.avatar,
          username: info.username,
          streak: info.streak,
        });
      } else {
        if (name.length > existing.canonical.length) {
          if (existing.canonical && !existing.aliases.includes(existing.canonical)) {
            existing.aliases.push(existing.canonical);
          }
          existing.canonical = name;
        } else if (name !== existing.canonical && !existing.aliases.includes(name)) {
          existing.aliases.push(name);
        }
        if (sectionRank(info.section) < sectionRank(existing.section)) {
          existing.section = info.section;
        }
        if (info.username && !existing.username) existing.username = info.username;
        // For streaks, take the max we observed across rows for the same person.
        if (typeof info.streak === "number") {
          existing.streak = Math.max(existing.streak || 0, info.streak);
        }
      }
    }

    const finalEntries = [...byKey.values()];
    for (const { name, info } of noKeyEntries) {
      finalEntries.push({
        canonical: name,
        aliases: [],
        section: info.section,
        avatar: null,
        username: info.username,
        streak: info.streak,
      });
    }

    const names = finalEntries.map((e) => e.canonical).sort((a, b) => a.localeCompare(b));
    const byCategory = {};
    const avatars = {};
    const usernames = {};
    const aliases = {};
    const streaks = {};
    for (const e of finalEntries) {
      (byCategory[e.section] ||= []).push(e.canonical);
      if (e.avatar) avatars[e.canonical] = e.avatar;
      if (e.username) usernames[e.canonical] = e.username;
      if (e.aliases.length) aliases[e.canonical] = e.aliases;
      if (typeof e.streak === "number" && e.streak > 0) streaks[e.canonical] = e.streak;
    }
    for (const k of Object.keys(byCategory)) byCategory[k].sort((a, b) => a.localeCompare(b));
    return { names, byCategory, avatars, usernames, aliases, streaks };
  }

  // Snapchat picker rows contain a Bitmoji <img>. Scrape its src so the popup
  // can show real avatars instead of placeholder letter circles. Skip tiny
  // images (decorative icons) and known emoji image sources.
  function extractAvatarFromRow(row) {
    if (!row) return null;
    const imgs = row.querySelectorAll("img");
    for (const img of imgs) {
      if (!img.src) continue;
      // Skip emoji renders and small decorations.
      if (img.src.includes("/emoji/") || img.src.includes(".svg")) continue;
      const w = img.naturalWidth || img.width || 0;
      if (w > 0 && w < 20) continue;
      // Bitmoji + Snapchat avatar CDNs both resolve here.
      if (/bitmoji|snapchat\.com|snap\.com|cf-st\.sc-cdn\.net/i.test(img.src)) return img.src;
      // Otherwise, take the first reasonable img.
      return img.src;
    }
    return null;
  }

  // Section names Snapchat uses in the recipient picker, in display order.
  const KNOWN_SECTIONS = [
    "Best Friends", "Recents", "Groups", "My Friends",
    "Friends", "Subscriptions", "Quick Add", "Suggested Friends",
  ];
  // Sections we never want to include in the scraped friend pool.
  const EXCLUDED_SECTIONS = new Set(["Recents"]);

  function detectSectionHeader(el) {
    if (!el) return null;
    const text = (el.textContent || "").trim();
    if (!text || text.length > 40) return null;
    // A section header has no avatar image. Friend/group rows always do.
    if (el.querySelector("img")) return null;
    const lower = text.toLowerCase();
    for (const sec of KNOWN_SECTIONS) {
      const ls = sec.toLowerCase();
      if (text === sec || lower === ls) return sec;
      // Allow trailing/leading space/punct/count: "Best Friends", "Best Friends (8)", etc.
      if (lower.startsWith(ls) && /^[\s\d()·]+$/.test(text.slice(sec.length))) return sec;
    }
    return null;
  }

  // Letter divider in the alphabetical Friends list ("A", "B", ... "Z", "#").
  function isLetterDivider(el) {
    const text = (el.textContent || "").trim();
    if (text.length !== 1) return false;
    return /^[A-Z#]$/.test(text);
  }

  function findScroller(root) {
    const isScrollable = (el) => {
      if (!el) return false;
      const s = getComputedStyle(el);
      const overflowOK = s.overflowY === "auto" || s.overflowY === "scroll" || s.overflowY === "overlay";
      return overflowOK && el.scrollHeight > el.clientHeight + 10;
    };
    // The picker itself is often the scroller (e.g. ul.s7loS) — check it first.
    if (isScrollable(root)) return root;
    let best = null;
    let bestH = 0;
    for (const el of root.querySelectorAll("*")) {
      if (isScrollable(el) && el.clientHeight > bestH) {
        best = el;
        bestH = el.clientHeight;
      }
    }
    // Last resort: root has overflowing content even without explicit overflow.
    if (!best && root.scrollHeight > root.clientHeight + 10) return root;
    return best;
  }

  function collectRecipientRows(picker) {
    // Try strategies in order, return the first that yields rows. Each row
    // must be visible and yield a plausible name from extractNameFromRow.
    const tryStrategy = (selector, root = picker) => {
      const out = [];
      for (const el of root.querySelectorAll(selector)) {
        if (!isVisible(el)) continue;
        if (extractNameFromRow(el)) out.push(el);
      }
      return out;
    };

    // 1. Direct <li> children of a UL.
    let rows = tryStrategy(":scope > li");
    if (rows.length) return rows;

    // 2. Role-based rows.
    rows = tryStrategy('[role="listitem"], [role="option"], [role="row"]');
    if (rows.length) return rows;

    // 3. Clickable rows inside a scrollable parent.
    const scroller = findScroller(picker) || picker;
    rows = tryStrategy('li, [role="button"], div[tabindex="0"]', scroller);
    if (rows.length) return rows;

    // 4. Last resort: any direct child that yields a name.
    return [...picker.children].filter((el) => isVisible(el) && extractNameFromRow(el));
  }

  // Walk text nodes inside a row, skipping section labels / dividers / streaks.
  function rowTextCandidates(row) {
    const SKIP = new Set([
      "Best Friends", "Recents", "Friends", "Groups", "My Friends",
      "Subscriptions", "Quick Add", "Suggested Friends",
    ]);
    const texts = [];
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode.nodeValue?.trim();
      if (!t) continue;
      if (SKIP.has(t)) continue;
      if (/^[A-Z#]$/.test(t)) continue;
      if (t.length < 2 || t.length > 60) continue;
      // Skip streak metadata like "5 🔥" or "3w" or "Delivered·5h".
      if (/^[\d\s\W]+$/.test(t)) continue;
      if (/^[\d]+\s*🔥/.test(t)) continue;
      if (/^Opened|^Delivered|^Sent|^Tap to|^New Snap/i.test(t)) continue;
      texts.push(t);
    }
    return texts;
  }

  function extractNameFromRow(row) {
    return rowTextCandidates(row)[0] || null;
  }

  // Snapchat's New Chat picker does NOT expose usernames anywhere — verified
  // by inspecting text nodes, attributes, hidden elements, and React props.
  // Return null so the storage's username field becomes inert.
  function extractUsernameFromRow(_row) {
    return null;
  }

  // What IS in each row: the streak count, like "63 🔥". We pull just the
  // integer. Useful for displaying a flame indicator in the popup and (later)
  // for streak-based filters / configs.
  function extractStreakFromRow(row) {
    if (!row) return null;
    // The streak lives in a span next to the flame emoji. Match a leading
    // integer in any text node — first hit wins.
    const w = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const t = w.currentNode.nodeValue?.trim();
      if (!t) continue;
      const m = /^(\d{1,5})\s*🔥?$/.exec(t) || /^(\d{1,5})\s*🔥/.exec(t);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }

  // ---------- automation flow ----------

  async function clickByName(name) {
    const picker = await waitFor(findRecipientPicker, { timeout: 8000, label: "recipient picker" });
    const scroller = findScroller(picker);

    const tryFindAndClick = async () => {
      const row = findRowByName(picker, name);
      if (!row || !row.isConnected) return false;
      try { row.scrollIntoView({ block: "center", behavior: "instant" }); } catch {}
      await sleep(120);
      if (!isVisible(row)) return false;

      // Sanity log: show exactly which row we matched. If a wrong-person
      // pick ever happens again, the row's primary text will be visible
      // here and you can tell at a glance whether it's the right friend.
      const matchedText = extractNameFromRow(row) || "?";
      if (matchedText.toLowerCase() !== name.toLowerCase()) {
        log(`    matched row "${matchedText}" for wanted "${name}" (fuzzy)`);
      } else {
        log(`    matched row "${matchedText}"`);
      }

      // Capture pre-click state so we can verify the click actually toggled
      // the row. Snapchat marks selected rows with aria-pressed/aria-selected
      // OR a different class — we just compare a snapshot.
      const before = rowStateSignature(row);

      const targets = clickTargetCandidates(row);
      log(`    row found, trying up to ${targets.length} click target(s)`);
      for (const t of targets) {
        await realClick(t, { hold: 60 });
        await sleep(280);
        if (rowStateSignature(row) !== before) {
          log(`    pick confirmed (${t.tagName}.${(t.className || "noclass").toString().slice(0, 40)})`);
          return true;
        }
      }
      log(`    warn: no click target toggled row state for "${name}"`);
      dumpRowDiagnostics(row);
      // Return true anyway so we don't loop forever on a recipient Snapchat refuses.
      return true;
    };

    function rowStateSignature(row) {
      // A coarse fingerprint that catches any DOM mutation Snapchat makes
      // when toggling selection — class change, new SVG checkmark, aria flip,
      // even a wrapper getting a new nested element.
      const ariaParts = [...row.querySelectorAll("[aria-checked], [aria-selected], [aria-pressed]")]
        .map((e) => `${e.getAttribute("aria-checked") || "-"}|${e.getAttribute("aria-selected") || "-"}|${e.getAttribute("aria-pressed") || "-"}`)
        .join(",");
      const cls = [...row.querySelectorAll("*")].slice(0, 12).map((e) => e.className).join("@").slice(0, 200);
      return [
        row.className,
        row.getAttribute("aria-checked") || "-",
        row.getAttribute("aria-selected") || "-",
        row.getAttribute("aria-pressed") || "-",
        (row.innerHTML || "").length,
        row.querySelectorAll("svg").length,
        row.querySelectorAll("img").length,
        row.querySelectorAll("*").length,
        ariaParts,
        cls,
      ].join("||");
    }

    function clickTargetCandidates(row) {
      const out = [];
      const seen = new Set();
      const push = (el) => { if (el && !seen.has(el)) { seen.add(el); out.push(el); } };

      // Try the row itself first — React onClick handlers usually live there.
      push(row);
      const innerBtn = row.querySelector('button, [role="button"]');
      push(innerBtn);
      const img = row.querySelector("img");
      if (img?.parentElement) push(img.parentElement);
      // Lastly, try every descendant with cursor:pointer (Snapchat sometimes
      // hangs the click handler on a deeply-nested clickable wrapper).
      for (const el of row.querySelectorAll("*")) {
        if (!isVisible(el)) continue;
        if (getComputedStyle(el).cursor === "pointer") push(el);
      }
      return out;
    }

    function dumpRowDiagnostics(row) {
      // Truncated outerHTML so we can see what Snapchat actually rendered.
      const html = (row.outerHTML || "").replace(/\s+/g, " ").slice(0, 500);
      log(`    row HTML: ${html}`);
    }

    // 1) Already in view? Click and bail.
    if (await tryFindAndClick()) {
      clearRecipientSearch();
      return true;
    }

    // 2) Type the name into the share-pane search (filters the list).
    const search = findRecipientSearchInput();
    if (search) {
      search.focus();
      setNativeValue(search, name);
      search.dispatchEvent(new Event("input", { bubbles: true }));
      // Re-find each iteration — typing causes the picker to re-render so any
      // earlier row reference goes stale.
      for (let i = 0; i < 14; i++) {
        await sleep(150);
        if (await tryFindAndClick()) {
          clearRecipientSearch();
          return true;
        }
      }
      // No match via search — clear the box so it doesn't break later actions.
      clearRecipientSearch();
    }

    // 3) Scroll-and-scan fallback.
    if (scroller) {
      scroller.scrollTop = 0;
      const startTime = Date.now();
      while (Date.now() - startTime < 8000) {
        if (await tryFindAndClick()) return true;
        const before = scroller.scrollTop;
        scroller.scrollTop += scroller.clientHeight * 0.7;
        await sleep(200);
        if (Math.abs(scroller.scrollTop - before) < 2) break;
      }
    }

    // Dump what IS in the picker so we can see what string to match against.
    const sample = collectRecipientRows(picker)
      .slice(0, 12)
      .map((r) => extractNameFromRow(r))
      .filter(Boolean);
    log(`    picker contains: ${JSON.stringify(sample)}`);
    throw new Error(`Recipient not found: ${name}`);
  }

  // The clickable target may be a child <button>, not the <li> wrapper.
  function clickTargetForRow(row) {
    if (row.tagName === "BUTTON" || row.getAttribute("role") === "button") return row;
    return row.querySelector('button, [role="button"]') || row;
  }

  function findRecipientSearchInput() {
    const sidebar = document.querySelector('div.QAr02[role="list"]');
    const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : 340;
    return [...document.querySelectorAll(SEL.recipientSearchInput.cssSelector)]
      .filter((el) => isVisible(el))
      .find((el) => el.getBoundingClientRect().left >= sidebarRight - 5);
  }

  function clearRecipientSearch() {
    const search = findRecipientSearchInput();
    if (search && search.value) {
      setNativeValue(search, "");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function findRowByName(picker, name) {
    const rows = collectRecipientRows(picker);
    const wanted = (name || "").trim();
    if (!wanted) return null;
    const wantedLower = wanted.toLowerCase();

    // Strategy 1: exact match on the row's first text candidate.
    for (const r of rows) {
      if (extractNameFromRow(r) === wanted) return r;
    }
    // Strategy 2: case-insensitive exact match.
    for (const r of rows) {
      const t = extractNameFromRow(r);
      if (t && t.toLowerCase() === wantedLower) return r;
    }
    // Strategy 3 (TIGHTENED): word-boundary prefix match on the row's
    // PRIMARY text only — handles "Alex" stored vs "Alex S" rendered (or
    // vice versa). The previous bidirectional substring scan across ALL
    // text nodes is what caused the "sends to the wrong person" bug:
    // when someone messaged you, their row's text candidates leaked into
    // matching, and tiny tokens (short alias, single-word names) would
    // collide with longer wanted names. Now we require:
    //   - At least 3-character overlap (no single-letter matches).
    //   - One name must be a true prefix of the other, followed by a
    //     non-alphanumeric character (so "Alex" doesn't match "Alexander"
    //     but does match "Alex S" or "Alex 🎵").
    const sep = /[^a-zA-Z0-9]/;
    for (const r of rows) {
      const primary = extractNameFromRow(r);
      if (!primary || primary.length < 3) continue;
      const pl = primary.toLowerCase();
      if (wantedLower.length < 3) continue;
      // primary "Alex S" starts with wanted "Alex" + boundary?
      if (pl.length > wantedLower.length
          && pl.startsWith(wantedLower)
          && sep.test(pl[wantedLower.length])) {
        return r;
      }
      // wanted "Alex S" starts with primary "Alex" + boundary?
      if (wantedLower.length > pl.length
          && wantedLower.startsWith(pl)
          && sep.test(wantedLower[pl.length])) {
        return r;
      }
    }
    // Strategy 4 (ignore-spacing match across all text nodes) was REMOVED.
    // It was the worst offender for cross-recipient false matches because
    // it would collapse "snapped you · Bob · 2m" into a single string and
    // happily substring-match against unrelated wanted names.
    return null;
  }

  async function clickRow(row) {
    if (!row || !row.isConnected) return false;
    try { row.scrollIntoView({ block: "center", behavior: "instant" }); } catch {}
    await sleep(120);
    await realClick(clickTargetForRow(row));
    return true;
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter?.call(el, value);
  }

  // ---------- caption (text overlay) helpers ----------

  // Find the photo-preview pane (the right column once a snap is captured).
  // We bound caption-tool searches to this region so we don't accidentally
  // click sidebar / share-pane buttons.
  function findPhotoPreviewPane() {
    // Heuristic: the pane is right of the friends-feed sidebar and contains
    // the close X (button.xHw7V.STlkX). Walk up from the close button to a
    // reasonable container.
    const close = document.querySelector("button.xHw7V.STlkX");
    if (!close) return null;
    let cur = close;
    for (let i = 0; i < 8 && cur; i++) {
      cur = cur.parentElement;
      if (!cur) break;
      const r = cur.getBoundingClientRect();
      // The pane should be tall, right of sidebar, and at least ~300px wide.
      if (r.width >= 280 && r.height >= 400) return cur;
    }
    return close.parentElement || null;
  }

  // Locate the caption ("Add a caption") button on the photo preview.
  // STRICT: only returns on positive identification via pinned selector,
  // aria-label, or title. The earlier icon-button heuristic was unsafe —
  // it would match the close X (button.xHw7V.STlkX), and clicking that
  // dismisses the photo and bounces the loop back to camera. Better to
  // return null and skip captioning than to ever click the wrong button.
  //
  // Also explicitly rejects the close X if it ever sneaks through, as a
  // defense-in-depth: the close X shares the .xHw7V class with the
  // caption button (.xHw7V.T0LP0).
  function findTextToolButton() {
    const cfg = SEL.textToolButton || {};

    const safe = (el) => {
      if (!el || !isVisible(el)) return null;
      // Hard-reject the close X. xHw7V is shared with .STlkX (close) AND
      // .T0LP0 (caption). If a refactor / re-mint ever lets us match the
      // close X, we'd accidentally dismiss the snap. Never let that happen.
      if (el.classList.contains("STlkX")) return null;
      // Reject the home-screen camera circle just in case.
      if (el.classList.contains("qJKfS")) return null;
      // Reject Send To / Download (also in the share pane near the preview).
      if (el.classList.contains("fGS78") || el.classList.contains("G9yiL")) return null;
      return el;
    };

    // 1) Pinned class selector (preferred — fastest, most specific).
    if (cfg.cssSelector) {
      const hit = safe(document.querySelector(cfg.cssSelector));
      if (hit) return hit;
    }

    // 2) Title attribute — "Add a caption" is the stable user-visible label.
    if (cfg.titles?.length) {
      for (const t of cfg.titles) {
        const hit = safe(document.querySelector(`button[title="${cssEscape(t)}"]`));
        if (hit) return hit;
      }
    }

    // 3) aria-label fallback.
    if (cfg.ariaLabels?.length) {
      const hit = safe(queryByAriaLabel(cfg.ariaLabels));
      if (hit) return hit;
    }

    return null;
  }

  // After clicking the text tool, find the input where caption text goes.
  // Snapchat typically mounts a contenteditable div positioned over the photo.
  function findCaptionInput() {
    const cfg = SEL.captionInput || {};
    if (cfg.cssSelector) {
      const el = document.querySelector(cfg.cssSelector);
      if (el && isVisible(el)) return el;
    }
    const pane = findPhotoPreviewPane() || document;
    // Prefer contenteditable, then textarea, then text input.
    const editable = [...pane.querySelectorAll('[contenteditable="true"]')]
      .filter((el) => isVisible(el));
    if (editable.length) return editable[editable.length - 1]; // newest mounted

    const ta = [...pane.querySelectorAll("textarea")].filter((el) => isVisible(el));
    if (ta.length) return ta[ta.length - 1];

    const txtIn = [...pane.querySelectorAll('input[type="text"], input:not([type])')]
      .filter((el) => isVisible(el))
      // Exclude the recipient-search input (lives in the share pane, not preview).
      .filter((el) => !el.classList.contains("dmsdi"));
    if (txtIn.length) return txtIn[txtIn.length - 1];

    return null;
  }

  // Type text into a contenteditable, textarea, or input. For contenteditable
  // we use execCommand("insertText") so React's onBeforeInput / onInput fire
  // correctly; for inputs/textareas we use the React-aware native setter.
  async function typeCaptionInto(el, text) {
    el.focus();
    await sleep(50);
    if (el.isContentEditable) {
      // Clear any existing content first.
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      try { document.execCommand("delete", false); } catch {}
      // Insert new content.
      try { document.execCommand("insertText", false, text); } catch {
        el.textContent = text;
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    } else {
      setNativeValue(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await sleep(80);
  }

  // Best-effort caption application. Picks a random phrase from `pool`, opens
  // the text tool, types it, and commits. NEVER throws — if anything fails,
  // logs a warning and returns false so the snap still sends without caption.
  async function applyRandomCaption(pool) {
    if (!Array.isArray(pool) || pool.length === 0) return false;
    const phrase = pool[Math.floor(Math.random() * pool.length)];
    if (!phrase || !phrase.trim()) return false;

    try {
      const btn = findTextToolButton();
      if (!btn) {
        log(`  caption: text tool not found — skipping (set SNAP_SELECTORS.textToolButton.cssSelector to enable)`);
        return false;
      }
      log(`  caption: clicking text tool, typing "${phrase}"`);
      await realClick(btn);
      // Wait for the input to mount.
      let input = null;
      const start = Date.now();
      while (Date.now() - start < 1500) {
        if (state.stop) throw new Error("stopped");
        input = findCaptionInput();
        if (input) break;
        await sleep(80);
      }
      if (!input) {
        log(`  caption: input never appeared — skipping`);
        return false;
      }
      await typeCaptionInto(input, phrase);

      // Commit. We deliberately do NOT click an arbitrary spot in the preview
      // pane — the top corners hold the close X and other dismissive buttons
      // (xHw7V family), and accidentally clicking one drops the captured snap
      // and bounces the loop back to camera. Instead:
      //   1. Fire blur directly on the input (commits text in most React
      //      contentEditable / textarea handlers).
      //   2. Press Enter — Snapchat's caption widget treats Enter as
      //      "done" and dismisses the editor without losing the snap.
      // Both are no-ops if the input has already been auto-committed.
      try { input.blur(); } catch {}
      try {
        const evDown = new KeyboardEvent("keydown", {
          key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true,
        });
        const evUp = new KeyboardEvent("keyup", {
          key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true,
        });
        (document.activeElement || input).dispatchEvent(evDown);
        (document.activeElement || input).dispatchEvent(evUp);
      } catch {}
      await sleep(140);

      // Sanity check: we must still be on photo preview. If a stray click or
      // an unexpected keydown handler dismissed the snap, surface it loudly
      // so the caller can decide whether to recapture or abort, instead of
      // marching forward into a Send To step that'll fail mysteriously.
      if (!isOnPhotoPreview()) {
        log(`  caption: WARNING — photo preview gone after caption step (snap may have been dismissed)`);
        return false;
      }
      return true;
    } catch (e) {
      if (e.message === "stopped") throw e;
      log(`  caption: error — ${e.message} — sending without caption`);
      return false;
    }
  }

  // The big one. Web Snapchat 2026 flow:
  //   1. Click big camera circle (button.qJKfS) on home.
  //   2. Click the 52x52 shutter (div[role=button] in camera pane bottom-center).
  //   3. The post-capture share screen shows the recipient list (ul.s7loS) inline.
  //   4. Click each recipient row in the list.
  //   5. Click "Send To" (button.YatIx.fGS78) — that's the actual send.
  // Snapchat's camera view has a quick-share sidebar that includes the
  // "Send To" button even with no photo taken — so findSendToButton() is NOT
  // a reliable photo-preview indicator. The reliable signal is the close X
  // (button.xHw7V.STlkX) that ONLY appears once a photo's been captured.
  function isOnPhotoPreview() {
    return !!document.querySelector("button.xHw7V.STlkX");
  }

  function isOnCleanCamera() {
    return (
      !document.querySelector("button.qJKfS") &&
      !isOnPhotoPreview() &&
      document.querySelectorAll("button.FBYjn").length >= 3
    );
  }

  async function runOneSnap({ recipients, iteration = 0, dwell = 200, captionPool = null }) {
    // Single robust entry: navigateToCamera handles every starting state —
    // home, camera, photo preview lingering from a previous Send, etc.
    log(iteration === 0 ? "Step 1: navigating to camera" : `Step 1: navigating to camera (iter ${iteration + 1})`);
    await navigateToCamera();

    // ----- Step 2: capture -----
    // Verify capture by looking for button.xHw7V.STlkX — the photo-preview
    // close X. It only exists once a photo's been taken. Send To button is
    // an unreliable signal because it's also visible in the camera quick-share
    // sidebar before any photo. Rapid-click in case the first click misses.
    log("Step 2: rapid-clicking capture until photo preview appears");
    const cap = await waitClickable(findCaptureButton, { timeout: 3000, label: "capture button", settleMs: 50 });
    const captured = await clickRapidly(
      cap,
      () => isOnPhotoPreview(),
      {
        totalTimeout: 3500,
        clickInterval: 220,
        verifyInterval: 50,
        hold: 90,
        label: "capture",
        refind: () => findCaptureButton(),
      }
    );
    if (!captured) throw new Error("Capture failed: photo preview never appeared after rapid clicks");

    // ----- Step 2.5: optional caption -----
    // Applies a random phrase from captionPool to the snap. Best-effort:
    // never throws (except on stop) — if the text tool can't be found, the
    // snap sends without a caption. Helps avoid "identical snap" detection.
    if (captionPool && captionPool.length) {
      await applyRandomCaption(captionPool);
    }

    // After the caption step (or if it was skipped) we MUST still be on the
    // photo preview — that's the only state where Send To works. If something
    // dismissed the snap (a misclicked close X, an unexpected keydown), fail
    // here with a clear message so the loop records a failure and moves on
    // cleanly instead of timing out waiting for a picker that'll never appear.
    if (!isOnPhotoPreview()) {
      throw new Error("photo preview was dismissed before Send To step (likely caption misclick)");
    }

    // ----- Step 3: open recipient picker -----
    log("Step 3: opening recipient picker");
    await waitForPickerWithFallbackSendTo();

    log(`Step 4: picking ${recipients.length} recipient(s)`);
    for (const recipient of recipients) {
      // Each recipient may be a plain string OR an object with multiple name
      // variants — { primary, candidates: [name, alias1, alias2, ...] }.
      const candidates = typeof recipient === "string" ? [recipient] : (recipient.candidates || [recipient.primary]);
      const primary = typeof recipient === "string" ? recipient : (recipient.primary || candidates[0]);

      log(`  picking: ${primary}${candidates.length > 1 ? ` (${candidates.length} variants)` : ""}`);
      let picked = false;
      for (const variant of candidates) {
        try {
          await clickByName(variant);
          picked = true;
          break;
        } catch (e) {
          if (candidates.length > 1) {
            log(`    "${variant}" not in picker, trying next variant`);
          } else {
            log(`  warn: ${primary} not found — ${e.message}`);
          }
        }
      }
      if (!picked && candidates.length > 1) {
        log(`  warn: ${primary} — none of [${candidates.join(", ")}] matched`);
      }
      await sleep(180);
    }

    log("Step 5: clicking the real Send button (TYX6O paper-plane)");
    clearRecipientSearch();
    await sleep(150);
    let send;
    try {
      send = await waitClickableLoose(findSendButton, {
        timeout: 8000, label: "Send (submit) button", settleMs: 200,
      });
    } catch (e) {
      log(`    Send not clickable: ${e.message}`);
      dumpSharePaneDiagnostics();
      throw e;
    }
    log(`    clicking Send (${send.tagName}.${(send.className || "noclass").toString().slice(0, 40)})`);
    try { send.scrollIntoView({ block: "center", behavior: "instant" }); } catch {}
    await sleep(80);
    const sent = await clickAndVerify(
      send,
      // Post-state: picker is gone OR we've returned to the home camera circle.
      () => !findRecipientPicker() || !!document.querySelector("button.qJKfS"),
      { timeout: 6000, retries: 2, label: "send" }
    );
    if (!sent) throw new Error("Send button click didn't dismiss the picker after 3 attempts");
    log("Snap sent.");
    // Don't try to "return to camera" here — Snapchat's actual steady state
    // after Send is the photo preview lingering, and any attempt to dismiss
    // raced with the UI's animation. Instead, the next iteration's
    // navigateToCamera() handles the photo-preview-to-camera transition
    // reliably from a known starting state.
  }

  // Silent path: open the friend list via the "New Chat" button. No photo
  // captured, no upload — used for both manual and auto refresh.
  async function openFriendListViaNewChat() {
    await ensureHomeScreen();
    log("opening New Chat picker");
    const btn = document.querySelector(SEL.newChatButton.cssSelector);
    if (!btn || !isVisible(btn)) {
      throw new Error('"New Chat" button not found on home screen');
    }
    await realClick(btn);
    await sleep(400);
    await waitFor(findRecipientPicker, { timeout: 6000, label: "New Chat picker" });
  }

  // Close the New Chat picker after we're done scraping. Try Escape first;
  // if that doesn't dismiss it, click the body well outside the panel.
  async function closeFriendListPicker() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, which: 27, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", keyCode: 27, which: 27, bubbles: true }));
    await sleep(300);
    if (findRecipientPicker()) {
      // Click somewhere safe — top-left corner is rarely interactive.
      const safe = new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
      document.body.dispatchEvent(safe);
      await sleep(200);
    }
  }

  // Make sure we're on the home screen before starting anything. The user
  // could be left on any of: camera view, photo preview, share pane (with
  // recipient picker), or a chat conversation. Walk through the known close
  // button variants up to 4 times, falling back to Escape, until qJKfS is back.
  async function ensureHomeScreen() {
    if (document.querySelector("button.qJKfS")) return; // already home
    log("Step 0: not on home — navigating back");

    const closeSelectors = [
      "button.AJ_5h",                  // camera mode X
      "button.xHw7V.STlkX",            // photo preview top-left X
      "button.xHw7V",                  // generic xHw7V close
      'button[aria-label="Close"]',
      'button[title="Close"]',
      'button[title="Back"]',
    ];

    for (let attempt = 0; attempt < 4; attempt++) {
      if (document.querySelector("button.qJKfS")) {
        log("  back on home");
        return;
      }

      let clicked = false;
      for (const sel of closeSelectors) {
        const btn = document.querySelector(sel);
        if (btn && isVisible(btn)) {
          await realClick(btn);
          clicked = true;
          break;
        }
      }
      if (!clicked) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, which: 27, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", keyCode: 27, which: 27, bubbles: true }));
      }
      await sleep(350);
    }

    if (document.querySelector("button.qJKfS")) {
      log("  back on home");
      return;
    }
    // Last-ditch Escape spam.
    for (let i = 0; i < 3; i++) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, which: 27, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", keyCode: 27, which: 27, bubbles: true }));
      await sleep(200);
      if (document.querySelector("button.qJKfS")) {
        log("  back on home (via Escape)");
        return;
      }
    }
    throw new Error("Couldn't return to home screen — try refreshing the Snapchat tab manually");
  }

  // After capture, the share pane shows a "Send To" button that opens the
  // recipient picker. Click it with verification — keep retrying until the
  // picker actually appears, then return it. Strict check uses ul.s7loS
  // specifically; the lenient findRecipientPicker can match a leftover Best
  // Friends carousel on the photo preview, which is NOT the recipient picker.
  async function waitForPickerWithFallbackSendTo() {
    const strictPicker = () => {
      const el = document.querySelector("ul.s7loS");
      return el && isVisible(el) ? el : null;
    };

    // Defensive: picker might already be open (manual flow), but only count
    // ul.s7loS — not arbitrary fallback ULs.
    const existing = strictPicker();
    if (existing) return existing;

    const sendTo = await waitClickableLoose(findSendToButton, {
      timeout: 8000, label: "Send To button (open picker)", settleMs: 100,
    });
    log(`  clicking Send To to open picker (${sendTo.tagName}.${(sendTo.className || "noclass").toString().slice(0, 40)})`);
    const opened = await clickAndVerify(
      sendTo,
      () => !!strictPicker(),
      { timeout: 5000, retries: 2, label: "open-picker" }
    );
    if (!opened) throw new Error("Picker didn't open after 3 attempts");
    return strictPicker() || findRecipientPicker();
  }

  // Diagnostic: log every candidate the shutter heuristic considered, so when
  // a click silently no-ops we can see whether we picked the right element.
  function logCaptureCandidates() {
    const sidebar = document.querySelector('div.QAr02[role="list"]');
    const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : 340;
    const cands = [...document.querySelectorAll('button, [role="button"], div[role="button"]')]
      .filter((el) => isVisible(el))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= sidebarRight - 5 && r.top + r.height / 2 > window.innerHeight * 0.55;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { tag: el.tagName, cls: el.className || "(empty)", w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
      });
    log(`  capture candidates (${cands.length}): ${JSON.stringify(cands)}`);
  }

  // Bump the daily snap counters in chrome.storage. Called from runLoop on
  // each completed iteration, success or fail. Best-effort — failures here
  // don't interrupt the snap flow.
  async function recordSnapStat(success) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const r = await chrome.storage.local.get("stats");
      const stats = r.stats || { sentByDay: {}, failedByDay: {}, totalSent: 0, totalFailed: 0 };
      if (success) {
        stats.totalSent = (stats.totalSent || 0) + 1;
        stats.sentByDay = stats.sentByDay || {};
        stats.sentByDay[today] = (stats.sentByDay[today] || 0) + 1;
      } else {
        stats.totalFailed = (stats.totalFailed || 0) + 1;
        stats.failedByDay = stats.failedByDay || {};
        stats.failedByDay[today] = (stats.failedByDay[today] || 0) + 1;
      }
      await chrome.storage.local.set({ stats });
    } catch {}
  }

  // ============================================================
  //   AUTO-OPENER — automatically views incoming snaps
  // ============================================================
  // Find a chat row in the friends feed for `name` that has a viewable snap.
  // Snapchat marks unread snaps with a "New Snap" or "View" tag in the row's
  // text content. If `mustBeUnread` is false, returns any row matching the
  // name (used for fall-through cases).
  function findChatRowForFriend(name, { mustBeUnread = true } = {}) {
    const feed = document.querySelector('div.QAr02[role="list"]');
    if (!feed) return null;
    const rows = feed.querySelectorAll('div.O4POs[role="button"]');
    const wanted = (name || "").trim().toLowerCase();
    for (const r of rows) {
      if (!isVisible(r)) continue;
      const text = (r.textContent || "").trim();
      const lc = text.toLowerCase();
      // Substring match — chat-row text usually starts with the friend's name.
      if (!lc.includes(wanted) && !wanted.includes(lc.slice(0, 30))) continue;
      if (mustBeUnread) {
        // "New Snap" or "View" appears when there's an incoming snap to view.
        if (!/(new snap|^view|·view|tap to view|view\s*$)/i.test(text)) continue;
      }
      return r;
    }
    return null;
  }

  // Sort rows in visual top-to-bottom order. Virtualized lists don't
  // guarantee DOM order matches what the user sees, so we sort by Y.
  function visibleFeedRows() {
    const feed = document.querySelector('div.QAr02[role="list"]');
    if (!feed) return [];
    return [...feed.querySelectorAll('div.O4POs[role="button"]')]
      .filter(isVisible)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  }

  // Pick the chat row IMMEDIATELY ABOVE the target user. Used as a "park"
  // click — the row above's chat opens, leaving the target unselected so
  // its in-row View icon stays clickable.
  function findFillerChatRow(targetName) {
    const rows = visibleFeedRows();
    if (!rows.length) return null;
    const lc = (targetName || "").trim().toLowerCase();
    const targetIdx = rows.findIndex((r) => (r.textContent || "").toLowerCase().includes(lc));
    if (targetIdx === -1) return rows[0];
    if (targetIdx > 0) return rows[targetIdx - 1];
    if (rows.length > 1) return rows[1];
    return null;
  }

  // Scroll the friends sidebar until BOTH the target row AND the row above
  // it are mounted in the DOM AND fully on-screen (within the feed's
  // bounding rect — not just mounted as an overscan buffer row).
  // ReactVirtualized often mounts items slightly past the viewport for
  // smoothness, so we have to verify the row's geometry, not just its
  // existence. Returns true if we end with both rows visually on screen.
  async function scrollFeedToTarget(name) {
    const feed = document.querySelector('div.QAr02[role="list"]');
    if (!feed) return false;
    const lc = (name || "").trim().toLowerCase();

    const isOnScreen = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const f = feed.getBoundingClientRect();
      // Fully within the feed's vertical extent (small fudge for sub-pixels).
      return r.top >= f.top - 1 && r.bottom <= f.bottom + 1 && r.height > 0;
    };

    const findTarget = () => {
      const rows = visibleFeedRows();
      for (let i = 0; i < rows.length; i++) {
        if ((rows[i].textContent || "").toLowerCase().includes(lc)) {
          return { row: rows[i], idx: i, rows };
        }
      }
      return null;
    };

    const isReady = (hit) => {
      if (!hit || !isOnScreen(hit.row)) return false;
      // Need a row above (we click it to park) AND it must be on screen.
      if (hit.idx > 0) return isOnScreen(hit.rows[hit.idx - 1]);
      // Target is at index 0 of mounted rows AND we're at scrollTop 0 — only
      // case where there's legitimately no row above.
      return feed.scrollTop <= 1;
    };

    let hit = findTarget();
    if (isReady(hit)) return true;

    // Sweep from top to find the target.
    feed.scrollTop = 0;
    feed.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(200);

    let lastTop = -1;
    let stableRounds = 0;
    let iter = 0;
    while (stableRounds < 3 && iter < 80) {
      iter++;
      if (state.stop) throw new Error("stopped");

      hit = findTarget();
      if (hit) {
        if (isReady(hit)) return true;

        const r = hit.row.getBoundingClientRect();
        const f = feed.getBoundingClientRect();
        const before = feed.scrollTop;
        let nextTop = before;

        if (r.bottom > f.bottom) {
          // Target extends BELOW the feed — scroll down so it sits in the
          // upper-middle area, leaving room for at least one row above it.
          nextTop = before + (r.top - f.top) - r.height - 8;
        } else if (r.top < f.top) {
          // Target extends ABOVE the feed — scroll up to reveal it.
          nextTop = before - (f.top - r.top) - r.height - 8;
        } else if (hit.idx === 0 || !isOnScreen(hit.rows[hit.idx - 1])) {
          // Target on screen but the row above isn't — back off a bit.
          nextTop = before - r.height - 8;
        }

        feed.scrollTop = Math.max(0, Math.min(feed.scrollHeight, nextTop));
        feed.dispatchEvent(new WheelEvent("wheel", { deltaY: nextTop - before, bubbles: true, cancelable: true }));
        feed.dispatchEvent(new Event("scroll", { bubbles: true }));
        await sleep(180);
        continue;
      }

      // Not found — scroll one viewport-ish down.
      const before = feed.scrollTop;
      const step = Math.max(120, feed.clientHeight * 0.6);
      feed.scrollTop = Math.min(feed.scrollHeight, before + step);
      feed.dispatchEvent(new WheelEvent("wheel", { deltaY: step, bubbles: true, cancelable: true }));
      feed.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(220);

      if (Math.abs(feed.scrollTop - lastTop) < 4 && Math.abs(feed.scrollTop - before) < 4) {
        stableRounds++;
      } else {
        stableRounds = 0;
      }
      lastTop = feed.scrollTop;
    }

    hit = findTarget();
    return isReady(hit);
  }

  // Poll the target row for a View icon. Used between snaps to handle the
  // brief re-render where the row's content updates after a snap is consumed
  // — without this, the loop sometimes exits early on a transient empty state.
  async function waitForViewIconOnTargetRow(name, timeoutMs = 1200) {
    const start = Date.now();
    let scrolledRecently = false;
    while (Date.now() - start < timeoutMs) {
      if (state.stop) throw new Error("stopped");
      let row = findChatRowForFriend(name, { mustBeUnread: false });
      if (!row && !scrolledRecently) {
        // Row went out of mounted area — re-scroll once.
        await scrollFeedToTarget(name).catch(() => {});
        scrolledRecently = true;
        row = findChatRowForFriend(name, { mustBeUnread: false });
      }
      if (row) {
        const icon = findViewIconInRow(row);
        if (icon) return { row, icon };
      }
      await sleep(70);
    }
    return null;
  }

  // Find the small 16x16 "view" icon WITHIN a specific sidebar chat row.
  // Snapchat puts it inline in the row when there's an unread snap — we click
  // it directly without ever opening the target's chat, so the previous
  // chat (the one above) stays selected and the snap viewer pops open.
  function findViewIconInRow(row) {
    if (!row) return null;
    // Require a multi-class signature. Single-class fallbacks (just .HEkDJ)
    // false-match other row icons (chat / streak), which caused the auto-open
    // loop to keep "finding" a View icon on rows with no actual pending snap.
    // Keep only the 4- and 3-class variants — both are specific to View.
    for (const sel of ["div.HEkDJ.DEp5Z.DClo3.VKjn5", "div.HEkDJ.DEp5Z.DClo3"]) {
      const el = row.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  // The X / close button that appears while a snap is playing.
  // Confirmed selector: button.h9IpV. Other selectors below are fallbacks
  // for adjacent contexts (camera mode close, photo-preview close).
  // NOTE: Do NOT use this as "is the snap viewer open?" — the fallbacks
  // match close buttons from other panes (sidebar, camera, photo preview)
  // and will keep the click-through loop alive long after the actual snap
  // viewer has dismissed. Use isSnapViewerOpen() for that check.
  function findSnapCloseButton() {
    const candidates = [
      "button.h9IpV",            // confirmed snap-viewer close X
      "button.AJ_5h",            // camera-style close X
      "button.xHw7V.STlkX",      // photo-preview close X
      "button.xHw7V",            // generic xHw7V
      'button[aria-label="Close"]',
      'button[title="Close"]',
    ];
    for (const sel of candidates) {
      const btn = document.querySelector(sel);
      if (btn && isVisible(btn)) return btn;
    }
    return null;
  }

  // Strict "is the snap-playback viewer currently mounted?" check. Used as
  // the exit gate for the click-through loop. Deliberately rejects close
  // buttons from neighboring contexts — only signals genuinely owned by
  // the snap viewer count. Without this, the loop saw a sidebar close
  // button after the viewer dismissed and concluded the viewer was still
  // open, spinning forever.
  function isSnapViewerOpen() {
    // Primary signal: the snap-viewer-specific close X.
    if (document.querySelector("button.h9IpV")) return true;
    // Secondary signal: the snap-viewer container (used by clickInSnapViewer).
    if (document.querySelector("div.b2f4R")) return true;
    return false;
  }

  // Close the snap viewer with strict targeting. Clicks button.h9IpV
  // directly (NOT the cascading findSnapCloseButton, which could click a
  // sidebar's close X and leave the viewer up). Falls back to dispatching
  // Escape, which Snapchat's viewer also responds to.
  async function closeSnapViewer() {
    const close = document.querySelector("button.h9IpV");
    if (close && isVisible(close)) {
      await realClick(close);
      return true;
    }
    // Escape fallback — Snapchat's snap viewer dismisses on Escape too.
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true,
    }));
    document.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true,
    }));
    return false;
  }

  // Diagnostic: dump every visible clickable in the chat pane. Used when the
  // View button can't be found so we can update the selector with what's
  // actually rendered.
  function dumpChatPaneButtons() {
    const sidebar = document.querySelector('div.QAr02[role="list"]');
    const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : 340;
    const buttons = [...document.querySelectorAll("button, [role='button'], div[tabindex='0']")]
      .filter((b) => {
        if (!isVisible(b)) return false;
        const r = b.getBoundingClientRect();
        return r.left >= sidebarRight - 5;
      })
      .slice(0, 20)
      .map((b) => {
        const r = b.getBoundingClientRect();
        return {
          tag: b.tagName,
          cls: (b.className || "").toString().slice(0, 40),
          text: (b.textContent || "").trim().slice(0, 30),
          rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        };
      });
    log(`    chat pane buttons: ${JSON.stringify(buttons)}`);
  }

  // Auto-open ALL pending snaps from `name`. Flow:
  //   1. Scroll the friends sidebar so the target's row is visually on screen.
  //   2. Click the View icon (in the target's row) once — snap viewer opens,
  //      first snap plays.
  //   3. LOOP: wait snapDwellMs, then left-click the snap viewer container
  //      to advance to the next snap. Snapchat auto-closes the viewer when
  //      the chain runs out, so we exit when button.h9IpV disappears.
  async function openSnapFromFriend(name, { snapDwellMs = 4000 } = {}) {
    if (state.stop) throw new Error("stopped");
    log(`  ${name}: starting`);

    log(`  ${name}: scrolling sidebar to bring target into view`);
    const inView = await scrollFeedToTarget(name);
    if (!inView) {
      log(`  ${name}: not found in friends sidebar (scrolled the whole list)`);
      return "no-new-snap";
    }
    if (state.stop) throw new Error("stopped");

    // Find and click the FIRST View icon — this opens the snap viewer.
    const found = await waitForViewIconOnTargetRow(name, 1500);
    if (!found) {
      log(`  ${name}: no View icon — no pending snaps`);
      return "no-new-snap";
    }
    log(`  ${name}: clicking View icon to open snap viewer`);
    await realClick(found.icon);
    await sleep(450);

    // Confirm viewer opened — close X (button.h9IpV) should now exist.
    if (!findSnapCloseButton()) {
      log(`  ${name}: snap viewer didn't open (no close X visible)`);
      return "error";
    }

    // Click-through loop. Exits when:
    //   (a) The viewer is no longer open per the STRICT check — Snapchat
    //       dismissed it naturally on chain-end.
    //   (b) The viewer signature stops changing after a click — chain end
    //       but viewer stayed open. Force-close.
    //   (c) Hard cap on snaps per friend (defensive).
    //   (d) Wall-clock cap (defensive against runaway dwell loops).
    //   (e) clickInSnapViewer can't find a safe spot — force-close.
    //   (f) Stop requested.
    const MAX_SNAPS_PER_FRIEND = 60;
    const MAX_LOOP_MS = 6 * 60 * 1000; // 6 minutes — matched to snap cap * worst dwell
    const loopStartedAt = Date.now();
    let opened = 1;
    let prevSig = snapViewerSignature();
    let stuckCycles = 0;

    while (true) {
      if (state.stop) throw new Error("stopped");

      // (c) Hard cap on snaps per friend.
      if (opened >= MAX_SNAPS_PER_FRIEND) {
        log(`  ${name}: hit per-friend cap (${MAX_SNAPS_PER_FRIEND}) — force-closing`);
        await closeSnapViewer();
        break;
      }
      // (d) Wall-clock cap — backstop in case dwell is set very high and
      // something else keeps the viewer technically "open".
      if (Date.now() - loopStartedAt > MAX_LOOP_MS) {
        log(`  ${name}: click-through ran ${Math.round((Date.now() - loopStartedAt) / 1000)}s — wall-clock cap, force-closing`);
        await closeSnapViewer();
        break;
      }

      // Snapshot the viewer signature BEFORE dwelling so we can detect
      // Snapchat's own auto-advance. In a focused window with playable
      // video, Snapchat ends each snap at its natural duration and calls
      // its internal advance — independent of our click. If that happens
      // during our dwell, we MUST NOT also click, or we double-advance and
      // skip a snap. In a background window video is throttled, so
      // auto-advance never fires and our click is the only mover.
      const sigBeforeDwell = snapViewerSignature();

      // Let the current snap play.
      await abortableSleep(snapDwellMs);

      // (a) Viewer no longer open? Done. STRICT check — using
      // findSnapCloseButton here would falsely keep us alive when the
      // sidebar surfaces a close button after the viewer dismisses.
      if (!isSnapViewerOpen()) {
        log(`  ${name}: viewer closed after ${opened} snap${opened === 1 ? "" : "s"} — done`);
        break;
      }

      // Did Snapchat auto-advance during the dwell? Two-step check:
      //   1. Did the signature change between dwell start and dwell end?
      //   2. If yes, did it STABILIZE at the new value? Real advances
      //      settle quickly (new snap loads, then nothing changes). Loading
      //      transitions (background tabs especially) keep the signature
      //      mutating as media elements swap in/out — that's the false
      //      positive that broke the bad window before. Requiring
      //      stabilization filters them out.
      const sigAfterDwell = snapViewerSignature();
      let autoAdvanced = false;
      if (sigBeforeDwell && sigAfterDwell && sigBeforeDwell !== sigAfterDwell) {
        await sleep(250);
        if (!isSnapViewerOpen()) {
          log(`  ${name}: viewer closed after ${opened} snap${opened === 1 ? "" : "s"} — done`);
          break;
        }
        const sigSettled = snapViewerSignature();
        if (sigSettled && sigSettled === sigAfterDwell) {
          autoAdvanced = true;
        } else {
          // Signature didn't settle — it's loading-state churn, not an
          // actual advance. Fall through to click.
          log(`  ${name}: sig changed but didn't settle (loading churn) — will click`);
        }
      }
      if (autoAdvanced) {
        log(`  ${name}: snap #${opened + 1} auto-advanced by Snapchat (no click needed)`);
        opened++;
        prevSig = sigAfterDwell;
        stuckCycles = 0;
        continue;
      }

      // No auto-advance — Snapchat is waiting for us. Click to advance.
      log(`  ${name}: clicking through to snap #${opened + 1}`);
      const clicked = await clickInSnapViewer();
      if (!clicked) {
        log(`  ${name}: couldn't find a safe spot to click in viewer — manually closing`);
        await closeSnapViewer();
        break;
      }

      // Wait a short beat for the next snap to mount, then check whether the
      // viewer's content actually changed. If two consecutive clicks didn't
      // advance the snap (same signature), the chain has ended but Snapchat
      // is keeping the viewer open — force-close instead of looping forever.
      await sleep(180);

      // The click might have actually closed the viewer (last snap auto-dismiss).
      // Re-check before bothering with the signature comparison.
      if (!isSnapViewerOpen()) {
        log(`  ${name}: viewer closed after ${opened} snap${opened === 1 ? "" : "s"} (post-click) — done`);
        break;
      }

      const nowSig = snapViewerSignature();
      if (nowSig && prevSig && nowSig === prevSig) {
        stuckCycles++;
        if (stuckCycles >= 2) {
          log(`  ${name}: viewer didn't advance after ${stuckCycles + 1} click(s) — end of chain, force-closing`);
          await closeSnapViewer();
          break;
        }
      } else {
        stuckCycles = 0;
        prevSig = nowSig;
      }
      opened++;
    }

    return "viewed";
  }

  // Per-snap signature used by the click-through loop to detect "stuck on
  // last snap" (Snapchat sometimes keeps the viewer open instead of auto-
  // closing). Combines media src (changes every snap) with the close-X
  // position. Returns null if the viewer isn't visible.
  function snapViewerSignature() {
    if (!isSnapViewerOpen()) return null;
    // Prefer the snap-viewer container as the search root; fall back to the
    // close button's ancestor chain if the container's class re-minted.
    const container = document.querySelector("div.b2f4R") || document.querySelector("button.h9IpV");
    let root = container;
    if (root && root.tagName === "BUTTON") {
      for (let i = 0; i < 6 && root; i++) root = root.parentElement;
    }
    root = root || document;
    const media = root.querySelectorAll("img, video, [style*='background-image']");
    const srcs = [...media].slice(0, 3).map((el) => {
      if (el.tagName === "IMG" || el.tagName === "VIDEO") {
        return (el.currentSrc || el.src || "").slice(-50);
      }
      const bg = el.getAttribute("style") || "";
      const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
      return m ? m[1].slice(-50) : "";
    }).join("|");
    const close = document.querySelector("button.h9IpV");
    const r = close ? close.getBoundingClientRect() : { x: 0, y: 0 };
    return `${srcs}::${Math.round(r.x)},${Math.round(r.y)}`;
  }

  // Advance to the next snap in the viewer.
  //
  // Preferred path: a dedicated "next snap" chevron button (button.hRnph) —
  // clicking a real <button> calls its onClick once, period. This is way
  // more reliable than clicking the snap container, which has a tap-anywhere
  // handler that interacts weirdly with focused-window auto-advance and is
  // the source of every "rapid click" / "skips snaps" symptom we've hit.
  //
  // Fallback 1: the snap-viewer container (div.b2f4R...). Kept because the
  // next button might not be mounted in every viewer state (e.g. last snap,
  // story playback).
  //
  // Fallback 2: elementFromPoint near viewer center.
  //
  // realClickSingle is used throughout — exactly one click event, no
  // doubled native el.click() trailer.
  async function clickInSnapViewer() {
    // Preferred: dedicated next-snap button.
    const nextBtnSel = SEL.snapViewerNextButton?.cssSelector;
    if (nextBtnSel) {
      const btn = document.querySelector(nextBtnSel);
      if (btn && isVisible(btn)) {
        await realClickSingle(btn);
        return true;
      }
    }

    // Fallback 1: snap-viewer container click.
    const containerSelectors = [
      "div.b2f4R.IbYNR.zsqlD",
      "div.b2f4R.IbYNR",
      "div.b2f4R",
      // Older guess from a prior diagnostic — kept in case Snapchat
      // re-mints b2f4R.
      "div.BN1L1.evmU8.ngwnc",
      "div.BN1L1",
    ];
    for (const sel of containerSelectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) {
        await realClickSingle(el);
        return true;
      }
    }

    // Fallback 2: aim for the center of the chat pane via elementFromPoint.
    const sidebar = document.querySelector('div.QAr02[role="list"]');
    const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : 340;
    const cx = Math.floor(sidebarRight + (window.innerWidth - sidebarRight) / 2);
    const cy = Math.floor(window.innerHeight / 2);
    const points = [[cx, cy], [cx, cy + 80], [cx, cy - 80], [cx - 60, cy], [cx + 60, cy]];
    const isInteractive = (el) => !el ||
      el.matches?.('button, [role="button"], a, input, textarea, svg, path') ||
      !!el.closest?.('button, [role="button"]');
    for (const [x, y] of points) {
      const target = document.elementFromPoint(x, y);
      if (!target || isInteractive(target)) continue;
      await realClickSingle(target);
      return true;
    }
    return false;
  }

  // Inner open pass — walks the user list once, opening any pending snaps.
  // Does NOT touch state.running or send loop-ended, so it's safe to call
  // from inside runLoop (interleaved opens) without breaking the send-loop
  // lifecycle. Returns { viewed, skipped, errored } so callers can log.
  async function runOpenPass({ users = [], snapDwellMs = 4000, label = "Auto-open" }) {
    let viewed = 0, skipped = 0, errored = 0;
    log(`${label}: walking ${users.length} friend(s)`);
    for (const name of users) {
      if (state.stop) {
        log(`${label}: stop requested.`);
        break;
      }
      try {
        const result = await openSnapFromFriend(name, { snapDwellMs });
        if (result === "viewed") viewed++;
        else if (result === "no-new-snap") skipped++;
      } catch (e) {
        if (e.message === "stopped") throw e;
        log(`  ${name}: error — ${e.message}`);
        errored++;
      }
      await abortableSleep(400);
    }
    log(`${label}: ${viewed} viewed, ${skipped} skipped (no new snap), ${errored} error(s).`);
    return { viewed, skipped, errored };
  }

  // Top-level open loop — owns the state.running lifecycle. Called from the
  // popup's "Open snaps" button. For interleaved opens inside runLoop, use
  // runOpenPass instead.
  async function openLoop({ users = [], snapDwellMs = 4000 }) {
    try {
      await runOpenPass({ users, snapDwellMs, label: "Auto-open" });
    } catch (e) {
      if (e.message !== "stopped") log(`Auto-open: error — ${e.message}`);
    } finally {
      state.running = false;
      state.stop = false;
      try { chrome.runtime.sendMessage({ type: "loop-ended" }); } catch {}
    }
  }

  // Poll the friends sidebar for a View icon on `friendName`'s row. Returns
  // true as soon as one appears, false after `timeoutMs`. Re-scrolls every
  // few seconds so the row stays mounted even on long waits — Snapchat
  // virtualizes the sidebar and rows can unmount when scrolled out.
  async function waitForIncomingSnap(friendName, timeoutMs) {
    const start = Date.now();
    let lastScroll = 0;
    let nextLogTickAt = 10;
    while (Date.now() - start < timeoutMs) {
      if (state.stop) throw new Error("stopped");

      // Re-scroll periodically so the target row remains in the mounted area.
      // The sidebar is virtualized and rows go out of the DOM when off-screen.
      if (Date.now() - lastScroll > 5000) {
        lastScroll = Date.now();
        try { await scrollFeedToTarget(friendName); } catch (e) {
          if (e.message === "stopped") throw e;
        }
      }

      // Check for the View icon.
      const row = findChatRowForFriend(friendName, { mustBeUnread: false });
      if (row) {
        const icon = findViewIconInRow(row);
        if (icon) {
          log(`  detected incoming snap from ${friendName}`);
          return true;
        }
      }

      // Heartbeat every 10s so a long wait is visible in the log.
      const elapsed = Math.round((Date.now() - start) / 1000);
      if (elapsed >= nextLogTickAt) {
        log(`  waited ${elapsed}s for incoming snap from ${friendName}…`);
        nextLogTickAt += 10;
      }

      await abortableSleep(1000);
    }
    return false;
  }

  // Ping-pong mode: send one snap → wait for the partner to send one back →
  // open it → repeat. Designed for the two-account side-by-side setup where
  // each window mirrors the other. Uses the first recipient as the partner;
  // any additional recipients in the config are ignored.
  //
  // Settings:
  //   recipients     — same shape as runLoop (objects with primary+candidates)
  //   captionPool    — optional, applied to each outgoing snap
  //   snapDwellMs    — dwell when opening incoming snaps
  //   waitTimeoutMs  — how long to wait for an incoming snap before giving
  //                    up and sending another (keeps the loop unblocked if
  //                    the partner crashes / pauses)
  async function runPingPongLoop({
    recipients,
    captionPool = null,
    snapDwellMs = 4000,
    waitTimeoutMs = 60000,
  }) {
    if (!recipients || recipients.length === 0) {
      log("Ping-pong: no recipient configured");
      return;
    }
    const first = recipients[0];
    const partner = typeof first === "string"
      ? first
      : (first.primary || first.candidates?.[0]);
    if (!partner) {
      log("Ping-pong: couldn't determine partner name from recipient");
      return;
    }
    if (recipients.length > 1) {
      log(`Ping-pong: config has ${recipients.length} recipient(s); using only "${partner}"`);
    }
    log(`Ping-pong: starting — partner "${partner}", wait timeout ${Math.round(waitTimeoutMs / 1000)}s`);

    let cycle = 0;
    let consecutiveTimeouts = 0;
    try {
      while (true) {
        if (state.stop) {
          log("Stop requested — exiting ping-pong loop.");
          break;
        }
        cycle++;
        log(`---- Ping-pong cycle ${cycle} ----`);

        // 1. SEND.
        log(`Step 1: sending snap to ${partner}`);
        let sendOk = false;
        try {
          await runOneSnap({ recipients: [first], iteration: cycle - 1, captionPool });
          sendOk = true;
        } catch (e) {
          if (e.message === "stopped") break;
          log(`Send failed: ${e.message}`);
        }
        await recordSnapStat(sendOk);
        if (state.stop) break;

        // 2. RETURN HOME so the sidebar / View icon is visible.
        try { await ensureHomeScreen(); } catch (e) {
          if (e.message === "stopped") break;
          log(`return-to-home failed: ${e.message}; continuing`);
        }
        if (state.stop) break;

        // 3. WAIT for the partner's snap.
        const received = await waitForIncomingSnap(partner, waitTimeoutMs);
        if (state.stop) break;

        if (!received) {
          consecutiveTimeouts++;
          log(`No snap from ${partner} within timeout (consecutive: ${consecutiveTimeouts}) — sending another`);
          // After several no-reply cycles, partner is probably offline. We
          // could bail here, but the safer default is to keep going; the
          // user can hit Stop. Just surface it loudly.
          if (consecutiveTimeouts === 3) {
            log(`Heads up: 3 timeouts in a row from "${partner}". Check the other window is running.`);
          }
          continue;
        }
        consecutiveTimeouts = 0;

        // 4. OPEN the snap(s).
        log(`Step 4: opening snap(s) from ${partner}`);
        try {
          const result = await openSnapFromFriend(partner, { snapDwellMs });
          log(`Open result: ${result}`);
        } catch (e) {
          if (e.message === "stopped") break;
          log(`Open failed: ${e.message}`);
        }

        // 5. RETURN HOME so the next send starts from a known state.
        try { await ensureHomeScreen(); } catch (e) {
          if (e.message === "stopped") break;
        }
      }
    } finally {
      state.running = false;
      state.stop = false;
      log("Ping-pong loop ended.");
      try { chrome.runtime.sendMessage({ type: "loop-ended" }); } catch {}
    }
  }

  async function runLoop({
    recipients,
    count = 1,
    intervalMs = 4000,
    unlimited = false,
    jitterPct = 0,
    captionPool = null,
    interleaveOpens = null, // { everyN, snapDwellMs, users? } | null
  }) {
    let i = 0;
    let sentSinceOpen = 0;
    // Backoff: when an open pass returns 0 viewed (friend hasn't sent
    // anything back yet), we don't want to burn ~1.5s on every interleave
    // window thereafter. Skip the next N interleaves, where N grows with
    // each consecutive empty pass (1, 2, 3, capped at 4). Reset on the
    // first non-empty pass.
    let consecutiveEmptyOpens = 0;
    let skippedOpens = 0;
    // Default the open-pass user list to the same names we're sending to —
    // typical use case is A↔B (send to & open from the same alt). Caller can
    // override via interleaveOpens.users if they want a different set.
    const openUsers = interleaveOpens?.users?.length
      ? interleaveOpens.users
      : (recipients || []).map((r) =>
          typeof r === "string" ? r : (r.primary || r.candidates?.[0])
        ).filter(Boolean);
    try {
      while (unlimited || i < count) {
        if (state.stop) {
          log("Stop requested — exiting loop.");
          break;
        }
        const total = unlimited ? "∞" : String(count);
        log(`---- Snap ${i + 1} / ${total} ----`);
        let success = false;
        try {
          await runOneSnap({ recipients, iteration: i, captionPool });
          success = true;
        } catch (e) {
          if (e.message === "stopped") {
            log("Stopped mid-snap.");
            await recordSnapStat(false);
            break;
          }
          log(`Snap ${i + 1} failed: ${e.message}`);
        }
        await recordSnapStat(success);
        i++;
        sentSinceOpen++;

        // Interleaved open pass: every N successful-or-failed sends, walk
        // the open list to view any incoming snaps. This makes the account
        // look like a real two-way user, not a pure emitter. We recover to
        // the camera before the next iteration so capture works cleanly.
        const everyN = interleaveOpens?.everyN | 0;
        if (
          everyN > 0 &&
          openUsers.length > 0 &&
          sentSinceOpen >= everyN &&
          (unlimited || i < count) &&
          !state.stop
        ) {
          // Backoff: if recent open passes found nothing, skip this one
          // entirely. The friend hasn't sent anything back yet — no point
          // re-scanning. Counter decrements each skipped window.
          if (skippedOpens > 0) {
            log(`---- Skipping interleave open pass (cooldown, ${skippedOpens} left) ----`);
            skippedOpens--;
            sentSinceOpen = 0;
          } else {
            log(`---- Interleaved open pass (after ${sentSinceOpen} sends) ----`);
            let passResult = null;
            try {
              passResult = await runOpenPass({
                users: openUsers,
                snapDwellMs: interleaveOpens?.snapDwellMs ?? 4000,
                label: "Interleaved open",
              });
            } catch (e) {
              if (e.message === "stopped") {
                log("Stopped during interleaved open pass.");
                break;
              }
              log(`Interleaved open pass error: ${e.message}`);
            }
            sentSinceOpen = 0;

            // Adjust cooldown based on pass outcome. If the friend sent us
            // anything (viewed > 0), reset. Otherwise grow the skip window
            // up to 4, so the longer they stay quiet, the less we check.
            const viewed = passResult?.viewed | 0;
            if (viewed === 0) {
              consecutiveEmptyOpens++;
              skippedOpens = Math.min(consecutiveEmptyOpens, 4);
              log(`No new snaps to view; next ${skippedOpens} interleave window(s) will be skipped`);
            } else {
              consecutiveEmptyOpens = 0;
              skippedOpens = 0;
            }

            // After viewing snaps we're somewhere in the friends sidebar /
            // chat view — bounce home so the next navigateToCamera is fast.
            try { await ensureHomeScreen(); } catch (e) {
              if (e.message === "stopped") break;
              log(`post-open ensureHomeScreen failed: ${e.message}`);
            }
          }
        }

        if (unlimited || i < count) {
          // Apply optional ± jitter so the wait varies snap-to-snap. Helps the
          // pacing look less mechanical; user can dial it 0–100%.
          let waitMs = intervalMs;
          if (jitterPct > 0) {
            const variance = waitMs * (jitterPct / 100);
            waitMs = Math.max(0, waitMs + (Math.random() * 2 - 1) * variance);
          }
          try {
            await abortableWaitUntilReady(waitMs);
          } catch (e) {
            if (e.message === "stopped") {
              log("Stopped during interval pause.");
              break;
            }
            throw e;
          }
        }
      }
    } finally {
      state.running = false;
      state.stop = false; // reset so next Start works cleanly
      log("Loop ended.");
      // Push a notification so the popup re-enables Start immediately
      // instead of waiting for its next status poll.
      try { chrome.runtime.sendMessage({ type: "loop-ended" }); } catch {}
    }
  }

  // ---------- runtime state + messaging ----------

  const state = { running: false, stop: false, log: [] };

  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    state.log.push(line);
    if (state.log.length > 200) state.log.shift();
    console.log("[AutoSnapper]", msg);
    chrome.runtime?.sendMessage?.({ type: "log", line }).catch?.(() => {});
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg.type === "ping") return sendResponse({ ok: true, url: location.href });

        if (msg.type === "scrape-recipients") {
          // Default: silent path via the "New Chat" button. No photo captured.
          // openVia: "newchat" (default) | "camera" | "manual" (already open).
          const via = msg.openVia || (msg.openPickerFirst ? "newchat" : "manual");
          log(`scrape: starting (via ${via})`);

          // Always make sure we're on the default home screen before doing
          // anything else — both newchat and camera paths require the home
          // header buttons (qJKfS / n6VkK). Skip for the manual path since
          // the user is responsible for the picker being open.
          if (via !== "manual") {
            await ensureHomeScreen();
          }
          let opened = false;

          if (via === "newchat") {
            try {
              await openFriendListViaNewChat();
              opened = true;
            } catch (e) {
              log(`  New Chat path failed: ${e.message}; falling back to camera path`);
            }
          }

          if (!opened && (via === "camera" || via === "newchat")) {
            log("scrape: capturing snap to reach picker");
            const cam = await waitClickable(findCameraButton, { timeout: 15000, label: "camera button" });
            await realClick(cam);
            await waitFor(() => !document.querySelector("button.qJKfS"), {
              timeout: 8000, label: "camera mode",
            }).catch((e) => log(`warn: ${e.message} — continuing anyway`));
            await sleep(500);

            logCaptureCandidates();
            const cap = await waitClickable(findCaptureButton, { timeout: 10000, label: "capture button" });
            await realClick(cap, { hold: 100 });

            const picker = await waitForPickerWithFallbackSendTo();
            log(`scrape: picker found via camera path (${picker.tagName}.${picker.className || "noclass"})`);
            await sleep(400);
            opened = true;
          }

          log("scrape: scrolling list and collecting names");
          const result = await scrapeRecipients({ onProgress: (p) => log(`  scraped ${p.count}`) });
          const cats = Object.entries(result.byCategory)
            .map(([k, v]) => `${k}=${v.length}`).join(", ");
          const avatarCount = Object.keys(result.avatars || {}).length;
          const aliasCount = Object.keys(result.aliases || {}).length;
          log(`scrape done: ${result.names.length} unique, ${avatarCount} with avatars, ${aliasCount} merged via avatar (${cats || "no sections detected"})`);

          // Close the picker we opened, but only via the New Chat path —
          // closing the camera-path picker would discard the captured snap.
          if (opened && via !== "camera") {
            log("closing picker (Escape)");
            await closeFriendListPicker();
          }

          return sendResponse({
            ok: true,
            names: result.names,
            byCategory: result.byCategory,
            avatars: result.avatars,
            usernames: result.usernames,
            aliases: result.aliases,
            streaks: result.streaks,
          });
        }

        if (msg.type === "run") {
          if (state.running) return sendResponse({ ok: false, error: "Already running" });
          state.running = true;
          state.stop = false;
          if (msg.payload?.pingPong) {
            runPingPongLoop({
              recipients: msg.payload.recipients,
              captionPool: msg.payload.captionPool,
              snapDwellMs: msg.payload.pingPong.snapDwellMs,
              waitTimeoutMs: msg.payload.pingPong.waitTimeoutMs,
            }).catch((e) => log("ping-pong loop error: " + e.message));
          } else {
            runLoop(msg.payload).catch((e) => log("loop error: " + e.message));
          }
          return sendResponse({ ok: true });
        }

        if (msg.type === "stop") {
          state.stop = true;
          return sendResponse({ ok: true });
        }

        if (msg.type === "open") {
          if (state.running) return sendResponse({ ok: false, error: "Already running (sender or opener)" });
          state.running = true;
          state.stop = false;
          openLoop(msg.payload || {}).catch((e) => log("open loop error: " + e.message));
          return sendResponse({ ok: true });
        }

        if (msg.type === "status") {
          return sendResponse({ ok: true, running: state.running, log: state.log.slice(-50) });
        }

        if (msg.type === "clear-log") {
          state.log.length = 0;
          return sendResponse({ ok: true });
        }

        if (msg.type === "go-home") {
          try {
            await ensureHomeScreen();
            return sendResponse({ ok: true });
          } catch (e) {
            return sendResponse({ ok: false, error: e.message });
          }
        }

        sendResponse({ ok: false, error: "unknown message" });
      } catch (e) {
        log(`ERROR (${msg?.type}): ${e.message}`);
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true; // async response
  });

  // Expose a tiny API the in-page overlay (overlay.js) can call directly.
  // Same handler logic as the chrome.runtime onMessage listener — just a
  // local function call instead of a runtime message round-trip.
  window.__autoSnapperAPI = {
    status() {
      return { ok: true, running: state.running, log: state.log.slice(-50) };
    },
    run(payload) {
      if (state.running) return { ok: false, error: "Already running" };
      state.running = true;
      state.stop = false;
      if (payload?.pingPong) {
        runPingPongLoop({
          recipients: payload.recipients,
          captionPool: payload.captionPool,
          snapDwellMs: payload.pingPong.snapDwellMs,
          waitTimeoutMs: payload.pingPong.waitTimeoutMs,
        }).catch((e) => log("ping-pong loop error: " + e.message));
      } else {
        runLoop(payload).catch((e) => log("loop error: " + e.message));
      }
      return { ok: true };
    },
    open(payload) {
      if (state.running) return { ok: false, error: "Already running" };
      state.running = true;
      state.stop = false;
      openLoop(payload || {}).catch((e) => log("open loop error: " + e.message));
      return { ok: true };
    },
    stop() { state.stop = true; return { ok: true }; },
    goHome: async () => { try { await ensureHomeScreen(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } },
  };

  // Expose for manual debugging from DevTools.
  window.__autoSnapper = {
    runOneSnap,
    runLoop,
    runPingPongLoop,
    waitForIncomingSnap,
    scrapeRecipients,
    findCameraButton,
    findCaptureButton,
    findSendToButton,
    findSendButton,
    findRecipientPicker,
    state,
  };

  log("content script loaded");
})();
