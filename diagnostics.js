// diagnostics.js
// Paste this whole file into the DevTools console on https://web.snapchat.com/.
// It defines a function `__diag(label)` you can call repeatedly with a label.
//
// Usage (run each line in order, on the matching screen):
//   __diag("home")     // on the home screen with the camera circle
//   __diag("camera")   // after clicking the camera circle
//   __diag("sendto")   // after capturing and clicking Send To
//
// After each call run:  copy(window.__lastDiag)
// then paste the JSON back to me.

(() => {
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };

  // Only count elements actually inside the viewport — strips off-screen noise.
  const inViewport = (el) => {
    const r = el.getBoundingClientRect();
    return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
  };

  const summarize = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      tag: el.tagName,
      role: el.getAttribute("role"),
      aria: el.getAttribute("aria-label"),
      id: el.id || null,
      classes: typeof el.className === "string" ? el.className : null,
      dataAttrs: Object.fromEntries(
        [...el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => [a.name, a.value])
      ),
      text: (el.textContent || "").trim().slice(0, 80),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      borderRadius: s.borderRadius,
      cursor: s.cursor,
    };
  };

  window.__diag = function (label = "unlabeled") {
    const info = {
      label,
      timestamp: new Date().toISOString(),
      url: location.href,
      viewport: { w: innerWidth, h: innerHeight },
      candidates: {},
    };

    const buttons = [...document.querySelectorAll('button, [role="button"], div[tabindex="0"]')]
      .filter(visible)
      .filter(inViewport);

    info.candidates.allButtonCount = buttons.length;
    info.candidates.allButtons = buttons.map(summarize);

    const KW = {
      camera: ["camera", "snap"],
      capture: ["capture", "record", "photo", "shutter", "take"],
      sendTo: ["send to"],
      send: ["send"],
      search: ["search", "to:"],
    };
    for (const [k, words] of Object.entries(KW)) {
      info.candidates[k] = buttons
        .filter((b) => {
          const a = (b.getAttribute("aria-label") || "").toLowerCase();
          const t = (b.textContent || "").toLowerCase();
          return words.some((w) => a.includes(w) || t.includes(w));
        })
        .map(summarize);
    }

    info.candidates.bottomCenterCircles = buttons
      .map((b) => {
        const r = b.getBoundingClientRect();
        const s = getComputedStyle(b);
        return {
          b,
          r,
          score:
            r.width * r.height -
            Math.abs(r.left + r.width / 2 - innerWidth / 2) * 2 -
            (innerHeight - (r.top + r.height / 2)) * 1.5,
          borderRadius: s.borderRadius,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => ({ ...summarize(x.b), score: Math.round(x.score) }));

    info.candidates.dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
      .filter(visible)
      .filter(inViewport)
      .map(summarize);

    info.candidates.inputs = [...document.querySelectorAll("input, textarea")]
      .filter(visible)
      .filter(inViewport)
      .map((i) => ({ ...summarize(i), placeholder: i.placeholder || null, type: i.type }));

    info.candidates.scrollers = [...document.querySelectorAll("*")]
      .filter((el) => {
        if (!visible(el) || !inViewport(el)) return false;
        const s = getComputedStyle(el);
        return (s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 10;
      })
      .slice(0, 8)
      .map(summarize);

    window.__lastDiag = info;
    console.log(`[AutoSnapper] dump "${label}" — ${buttons.length} on-screen buttons. Run: copy(window.__lastDiag)`);
    console.log(info);
    return info;
  };

  console.log(
    "%c[AutoSnapper] diagnostic loaded. Call __diag('home'), __diag('camera'), __diag('sendto'), then copy(window.__lastDiag) after each.",
    "color:#fffc00;font-weight:bold"
  );
})();
