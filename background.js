/**
 * background.js — Service Worker relay.
 *
 * The popup can close at any time. Messages from content scripts arrive here
 * and are stored temporarily so the popup can retrieve them when it opens.
 *
 * Flow: content.js → background → popup
 */

let pendingResult = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "TRANSCRIPT_RESULT" || msg.type === "TRANSCRIPT_ERROR") {
    pendingResult = msg;

    // Try to forward to any open popup — if it's closed this is a no-op
    chrome.runtime.sendMessage(msg).catch(() => {
      // Popup not open; result is stored in pendingResult for next open
    });
  }

  if (msg.type === "POPUP_READY") {
    // Popup just opened and is asking for any pending result
    if (pendingResult) {
      sendResponse(pendingResult);
      pendingResult = null;
    } else {
      sendResponse(null);
    }
    return true;
  }
});
