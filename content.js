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

const logger = (() => {
  const ENABLE_LOGS = false; 
  const noop = () => {};
  return ENABLE_LOGS
    ? { debug: console.debug.bind(console), warn: console.warn.bind(console), log: console.log.bind(console), info: console.info.bind(console), error: console.error.bind(console) }
    : { debug: noop, warn: noop, log: noop, info: noop, error: noop };
})();


let _hookInjected = false;   
let _waitingResult = false;  
let _timeoutId    = null;
let _lastVideoId  = new URLSearchParams(location.search).get('v') || '';

//  Reset on YouTube SPA navigation (new video = new page without reload) 
function onYouTubeNavigate() {
  const newId = new URLSearchParams(location.search).get('v') || '';
  if (newId && newId !== _lastVideoId) {
    _lastVideoId  = newId;
    _hookInjected = false;   
    _waitingResult = false;
    clearTimeout(_timeoutId);
    logger.debug('[YT Transcript] Navigation to new video detected:', newId);
  }
}
window.addEventListener('yt-navigate-finish', onYouTubeNavigate); 
window.addEventListener('popstate', onYouTubeNavigate);          

// Persistent window message listener 
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const { type, text, language } = event.data || {};

  if (type === 'YT_TRANSCRIPT_DATA' && _waitingResult) {
    _waitingResult = false;
    clearTimeout(_timeoutId);
    logger.debug('[YT Transcript] Received transcript, chars:', text?.length);
    chrome.runtime.sendMessage({ type: 'TRANSCRIPT_RESULT', transcript: text, language });
  }

  if (type === 'YT_CACHE_EMPTY') {
    logger.debug('[YT Transcript] Cache empty — toggling CC button to trigger fetch…');
    triggerCCButton();
  }
});

// Handle GET_TRANSCRIPT from popup 
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'GET_TRANSCRIPT') return;

  if (_waitingResult) {
    logger.debug('[YT Transcript] Already waiting, ignoring duplicate request.');
    return;
  }

  logger.debug('[YT Transcript] GET_TRANSCRIPT received.');
  _waitingResult = true;
  startTimeout('Timed out waiting for inject.js to load.');

  if (_hookInjected) {
    window.postMessage({ type: 'YT_QUERY_CACHE' }, '*');
  } else {
    _hookInjected = true;
    injectHook(() => {
      window.postMessage({ type: 'YT_QUERY_CACHE' }, '*');
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
    logger.debug('[YT Transcript] inject.js loaded, hook active.');
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
    logger.warn('[YT Transcript] CC button not found.');
    chrome.runtime.sendMessage({
      type: 'TRANSCRIPT_ERROR',
      error: 'Subtitles button not found. Make sure a video is playing and wait for the player to fully load.',
    });
    _waitingResult = false;
    clearTimeout(_timeoutId);
    return;
  }

  const isOn = btn.getAttribute('aria-pressed') === 'true';
  logger.debug('[YT Transcript] CC button found, aria-pressed=' + isOn + '. Toggling…');

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