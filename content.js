/**
 * content.js — Isolated world content script.
 *
 * Flow on GET_TRANSCRIPT:
 *  1. Inject inject.js → hook is installed in page context
 *  2. After hook is ready, query existing cache (YT_QUERY_CACHE)
 *  3a. If cache hit → relay immediately
 *  3b. If cache empty → toggle CC button to make YouTube fetch timedtext
 *           → hook fires → YT_TRANSCRIPT_DATA arrives → relay
 *  4. 12-second timeout at each stage with clear error messages
 */

let _hookInjected = false;    // have we injected inject.js yet?
let _waitingResult = false;   // are we currently waiting for a transcript?
let _timeoutId    = null;
let _lastVideoId  = new URLSearchParams(location.search).get('v') || '';

//  Reset on YouTube SPA navigation (new video = new page without reload) 
function onYouTubeNavigate() {
  const newId = new URLSearchParams(location.search).get('v') || '';
  if (newId && newId !== _lastVideoId) {
    _lastVideoId  = newId;
    _hookInjected = false;   // force re-inject so hooks run fresh for new video
    _waitingResult = false;
    clearTimeout(_timeoutId);
    console.log('[YT Transcript] Navigation to new video detected:', newId);
  }
}
window.addEventListener('yt-navigate-finish', onYouTubeNavigate); // YouTube SPA event
window.addEventListener('popstate', onYouTubeNavigate);            // fallback

// Persistent window message listener 
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const { type, text, language } = event.data || {};

  if (type === 'YT_TRANSCRIPT_DATA' && _waitingResult) {
    _waitingResult = false;
    clearTimeout(_timeoutId);
    console.log('[YT Transcript] ✓ Received transcript, chars:', text?.length);
    chrome.runtime.sendMessage({ type: 'TRANSCRIPT_RESULT', transcript: text, language });
  }

  if (type === 'YT_CACHE_EMPTY') {
    // Hook is live but no cached data — trigger the CC button
    console.log('[YT Transcript] Cache empty — toggling CC button to trigger fetch…');
    triggerCCButton();
  }
});

// Handle GET_TRANSCRIPT from popup 
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'GET_TRANSCRIPT') return;

  if (_waitingResult) {
    console.log('[YT Transcript] Already waiting, ignoring duplicate request.');
    return;
  }

  console.log('[YT Transcript] GET_TRANSCRIPT received.');
  _waitingResult = true;
  startTimeout('Timed out waiting for inject.js to load.');

  if (_hookInjected) {
    // Hook already in page — ask for cached data first
    window.postMessage({ type: 'YT_QUERY_CACHE' }, '*');
    // If cache is empty, YT_CACHE_EMPTY listener above will trigger CC
  } else {
    _hookInjected = true;
    injectHook(() => {
      // Hook is now live — check cache, if we already have this transcript then will get that directly
      window.postMessage({ type: 'YT_QUERY_CACHE' }, '*');
      // Trigger CC after a short delay to let the hook settle and check if we got result or not  
      setTimeout(() => {
        if (_waitingResult) {        
          triggerCCButton();
        }
      }, 400);
    });
  }
});

//  Inject inject.js into the real page context 
function injectHook(onReady) {
  const existing = document.getElementById('__yt_tx_hook__');
  if (existing) existing.remove();

  const script = document.createElement('script');
  script.id = '__yt_tx_hook__';
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = () => {
    console.log('[YT Transcript] inject.js loaded, hook active.');
    script.remove();
    if (onReady) onReady();
  };
  script.onerror = () => {
    _waitingResult = false;
    clearTimeout(_timeoutId);
    chrome.runtime.sendMessage({
      type: 'TRANSCRIPT_ERROR',
      error: 'Failed to load inject.js. Please reload the YouTube tab.',
    });
  };
  (document.head || document.documentElement).appendChild(script);
}

//  Toggle the CC/Subtitles button to make YouTube fetch timedtext 
function triggerCCButton() {
  const btn = document.querySelector('.ytp-subtitles-button');
  if (!btn) {
    console.warn('[YT Transcript] CC button not found.');
    chrome.runtime.sendMessage({
      type: 'TRANSCRIPT_ERROR',
      error: 'Subtitles button not found. Make sure a video is playing and wait for the player to fully load.',
    });
    _waitingResult = false;
    clearTimeout(_timeoutId);
    return;
  }

  const isOn = btn.getAttribute('aria-pressed') === 'true';
  console.log('[YT Transcript] CC button found, aria-pressed=' + isOn + '. Toggling…');

  if (isOn) {
    btn.click();
    setTimeout(() => btn.click(), 600);
  } else {
    btn.click();
  }

  // Reset timeout for this new phase
  clearTimeout(_timeoutId);
  startTimeout(
    'YouTube did not return caption data. The video may not have captions, ' +
    'or they may be in a format we cannot read. Try a video with English captions.'
  );
}

// Helpers 
function startTimeout(errorMessage) {
  clearTimeout(_timeoutId);
  _timeoutId = setTimeout(() => {
    if (_waitingResult) {
      _waitingResult = false;
      chrome.runtime.sendMessage({ type: 'TRANSCRIPT_ERROR', error: errorMessage });
    }
  }, 12000);
}