// background.js
// Minimal service worker. Mostly forwards log messages so the popup can
// listen even when the popup is closed.

const recentLog = [];

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "log" && msg.line) {
    recentLog.push(msg.line);
    if (recentLog.length > 500) recentLog.shift();
  }
  if (msg?.type === "get-recent-log") {
    sendResponse({ ok: true, log: recentLog.slice(-200) });
    return true;
  }
});
