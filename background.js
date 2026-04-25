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

    // Try to forward to any open popup, if it's closed just ingore bcz we storing it pendingResult
    // which will send when on the lisener POPUP_READY 
    chrome.runtime.sendMessage(msg).catch(() => {});
  }

  if (msg.type === "POPUP_READY") {
    if (pendingResult) {
      sendResponse(pendingResult);
      pendingResult = null;
    } else {
      sendResponse(null);
    }
    return true;
  }
});
