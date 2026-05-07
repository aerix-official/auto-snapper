// selectors.js
// Centralized selectors for web.snapchat.com.
// Snapchat ships obfuscated CSS classes that change between deploys, so we
// rely first on stable signals (aria-label, role, text content) and fall back
// to structural heuristics. Anything in this file is intended to be tuned
// after running the diagnostic script in diagnostics.js.

window.SNAP_SELECTORS = {
  // Home screen: the big circular camera button ("Click the camera to send Snaps").
  // Confirmed from diagnostics 2026-05-06: class "qJKfS", 177x177, borderRadius 100%.
  cameraButton: {
    cssSelector: "button.qJKfS",
    // Fallback: any button >=140px square with circular border-radius in the main column.
    largeCircleMinSize: 140,
  },

  // Friends Feed sidebar (left list of recent chats / friends).
  friendsFeed: {
    cssSelector: 'div.QAr02[role="list"]',
    ariaLabel: "Friends Feed",
  },

  // Chat row inside the Friends Feed.
  chatRow: {
    cssSelector: 'div.O4POs[role="button"][data-projection-id]',
  },

  // Friend avatar buttons that have aria-label = display name.
  friendAvatar: {
    cssSelector: "button.DV8P1[aria-label]",
  },

  // Top-left menu toggle (likely opens a side menu / friend list).
  topLeftMenu: {
    cssSelector: "button#downshift-0-toggle-button",
  },

  // "New Chat" button on the home screen — opens a panel with the full friend
  // list (Best Friends + A-Z) WITHOUT requiring a photo. Lets us scrape silently.
  newChatButton: {
    cssSelector: 'button[title="New Chat"], button.n6VkK',
  },

  // The shutter / capture button inside the camera view.
  // Confirmed from diagnostics 2026-05-06: it's a <div role="button" class="">
  // 52×52 in the camera pane bottom-center. Snapchat gives it no aria, id, or
  // class — we have to find it positionally: largest role=button in the
  // camera pane below 55% viewport height. Beats the 36×36 .FBYjn filter row.
  captureButton: {
    paneRightOfFriendsFeed: true,
    bottomFraction: 0.55,
    minSize: 40,
    // Heuristic: when in camera mode (qJKfS is gone), the capture is the
    // largest role=button in the camera pane bottom area.
  },

  // Close ("X") button shown in camera mode (top of camera pane).
  cameraCloseButton: {
    cssSelector: "button.AJ_5h",
  },

  // Filter / lens icons in the camera pane.
  lensIcons: {
    cssSelector: "button.FBYjn",
  },

  // After capture, the right pane becomes a single share screen with:
  //  - search input (input.dmsdi inside the share pane, no placeholder)
  //  - caption preset chips (button.c47Sk)
  //  - recipient list (ul.s7loS) — scrollable, contains "Best Friends" + all friends
  //  - Download button (button.YatIx.G9yiL, text="Download")
  //  - Send To button (button.YatIx.fGS78, text="Send To") — THIS sends.
  //
  // So the click sequence is: camera → shutter → click recipients in ul.s7loS → click Send To.
  // There is no separate dialog — the picker is inline.

  recipientPicker: {
    cssSelector: "ul.s7loS",
  },

  // The button that ACTUALLY sends the snap once recipients are selected.
  // Confirmed 2026-05-06: class "TYX6O", type="submit", text "Send", with a
  // paper-plane SVG icon. Distinct from the Send To button below — that one
  // only opens the recipient picker, this one is the real submit.
  sendButton: {
    cssSelector: 'button.TYX6O[type="submit"], button[type="submit"].TYX6O',
    textEquals: ["Send"],
  },

  // Intermediate "Send To" button — opens the recipient picker. Not the
  // submit; clicking this twice does NOT send a snap.
  sendToButton: {
    cssSelector: "button.YatIx.fGS78",
    textEquals: ["Send To"],
  },

  // Download button next to Send To (skipped, but worth keeping for reference).
  downloadButton: {
    cssSelector: "button.YatIx.G9yiL",
    textEquals: ["Download"],
  },

  // Caption preset chips ("New Friends", emoji presets) — not used by automation.
  captionChips: {
    cssSelector: "button.c47Sk",
  },

  // Search input inside the share pane. Distinguished from the home search by
  // having no placeholder. Both share the class `.dmsdi` with role=searchbox.
  recipientSearchInput: {
    cssSelector: 'input.dmsdi[role="searchbox"]',
    // Pick the one without a placeholder, OR the one whose x > friends-feed right edge.
  },
};
