// focus-spoof.js
// Runs in the PAGE'S MAIN world at document_start (see manifest.json).
//
// Snapchat's web client pauses / hides the snap viewer when the tab loses
// focus or becomes hidden. That breaks the multi-account workflow where one
// browser window is opening snaps while another is in the foreground.
//
// This script overrides the Page Visibility + focus APIs so Snapchat always
// sees the tab as "visible" and "focused", and swallows the events that
// would otherwise notify it of focus loss. It only runs on web.snapchat.com.
//
// Side effects to be aware of:
//   - Snaps won't auto-pause when you legitimately switch tabs (fine — you
//     don't see them anyway).
//   - Browser-level throttling of setTimeout / rAF on backgrounded tabs is
//     enforced by the browser, not the page, and we can't undo it here.
//     For the auto-open click-through loop that's OK because OUR setTimeout
//     fires from a content script which is throttled the same way but still
//     advances; the snap viewer itself doesn't auto-advance on its own timer
//     during automation.

(() => {
  try {
    // ---- 1. document.hidden — always false. -----------------------------
    // Snapchat checks this directly in render paths. The getter on
    // Document.prototype is normally non-writable but configurable, so we
    // can redefine it.
    Object.defineProperty(Document.prototype, "hidden", {
      configurable: true,
      get() { return false; },
    });
    // Vendor-prefixed twin (older code paths sometimes still read this).
    Object.defineProperty(Document.prototype, "webkitHidden", {
      configurable: true,
      get() { return false; },
    });

    // ---- 2. document.visibilityState — always "visible". ----------------
    Object.defineProperty(Document.prototype, "visibilityState", {
      configurable: true,
      get() { return "visible"; },
    });
    Object.defineProperty(Document.prototype, "webkitVisibilityState", {
      configurable: true,
      get() { return "visible"; },
    });

    // ---- 3. document.hasFocus() — always true. --------------------------
    Document.prototype.hasFocus = function hasFocus() { return true; };

    // ---- 4. Swallow visibility / blur events at the capture phase. ------
    // We listen on the capture phase BEFORE Snapchat's own handlers can run,
    // and stop propagation so the page never sees them. We're careful:
    //
    //   * visibilitychange / pagehide — always safe to swallow, these only
    //     fire on document and signal tab-level state change.
    //
    //   * blur — only swallow when the target is the window itself. Form
    //     inputs (like the recipient search) also fire blur, and we MUST
    //     let those reach Snapchat or the picker breaks.
    const stopAll = (e) => {
      try {
        e.stopImmediatePropagation();
        e.stopPropagation();
      } catch {}
    };
    const stopWindowOnly = (e) => {
      // For blur/focusout, e.target is the element (or window) that lost
      // focus. We only swallow when the WINDOW lost focus (tab switch /
      // app switch), not when an input element blurred.
      if (e.target !== window && e.target !== document) return;
      try {
        e.stopImmediatePropagation();
        e.stopPropagation();
      } catch {}
    };

    const swallowAlways = ["visibilitychange", "webkitvisibilitychange", "pagehide", "freeze"];
    for (const type of swallowAlways) {
      document.addEventListener(type, stopAll, true);
      window.addEventListener(type, stopAll, true);
    }
    window.addEventListener("blur", stopWindowOnly, true);
    window.addEventListener("focusout", stopWindowOnly, true);

    // Beacon so we can confirm this ran. Visible in DevTools console.
    console.log("%c[AutoSnapper] focus-spoof active", "color:#fffc00;font-weight:bold");
  } catch (e) {
    console.warn("[AutoSnapper] focus-spoof failed:", e);
  }
})();
