/**
 * inject.js — PAGE context (same origin as YouTube, no CORS issues).
 *
 * Strategy: Hook window.fetch + XHR, then wait for YouTube's own
 * timedtext request (triggered by toggling the CC button).
 * YouTube sends the request with full auth/cookies/headers — we just
 * read the response from the clone.
 *
 * Guards prevent double-hooking if injected more than once.
 * Cache is stored on window so it survives re-injections.
 */
(function () {

  // ── 1. Set up fetch + XHR hooks (once only) ──────────────────────────────
  if (!window.__YT_HOOK_SET__) {
    window.__YT_HOOK_SET__ = true;
    window.__YT_TX_CACHE__    = null;
    window.__YT_TX_VIDEO_ID__ = null;

    // Hook fetch
    const _origFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await _origFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        if (url.includes('timedtext')) {
          processClone(response.clone(), url);
        }
      } catch (_) {}
      return response;
    };

    // Hook XHR
    const _XHR = window.XMLHttpRequest;
    function PatchedXHR() {
      const xhr = new _XHR();
      const _open = xhr.open.bind(xhr);
      const _send = xhr.send.bind(xhr);
      let xhrUrl = '';

      xhr.open = function (method, url) {
        xhrUrl = url || '';
        return _open.apply(xhr, arguments);
      };
      xhr.send = function () {
        if (xhrUrl.includes('timedtext')) {
          xhr.addEventListener('load', () => processText(xhr.responseText, xhrUrl));
        }
        return _send.apply(xhr, arguments);
      };
      return xhr;
    }
    PatchedXHR.prototype = _XHR.prototype;
    window.XMLHttpRequest = PatchedXHR;

    console.log('[YT Transcript] fetch + XHR hooks installed.');
  }

  // ── 2. Message listener (add once, guarded by flag) ───────────────────────
  if (!window.__YT_MSG_LISTENER__) {
    window.__YT_MSG_LISTENER__ = true;

    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data) return;

      // content.js is asking: do we have cached data?
      if (e.data.type === 'YT_QUERY_CACHE') {
        const currentId = new URLSearchParams(location.search).get('v');
        const cacheValid = window.__YT_TX_CACHE__ && window.__YT_TX_VIDEO_ID__ === currentId;

        if (cacheValid) {
          window.postMessage(
            { type: 'YT_TRANSCRIPT_DATA', text: window.__YT_TX_CACHE__, language: 'English' },
            '*'
          );
        } else {
          // Stale or empty — discard and signal content.js to trigger CC
          window.__YT_TX_CACHE__    = null;
          window.__YT_TX_VIDEO_ID__ = null;
          window.postMessage({ type: 'YT_CACHE_EMPTY' }, '*');
        }
      }
    });
  }

  // ── 3. Parse helpers ──────────────────────────────────────────────────────
  async function processClone(clone, url) {
    try {
      processText(await clone.text(), url);
    } catch (_) {}
  }

  function processText(raw, url) {
    if (!raw || raw.trim().length < 10) return;

    let transcript = tryJson3(raw) || tryXml(raw);

    if (transcript && transcript.length > 20) {
      const videoId = new URLSearchParams(location.search).get('v');
      console.log('[YT Transcript] ✓ Captured from:', url.split('?')[0], '| video:', videoId, '| chars:', transcript.length);
      window.__YT_TX_CACHE__    = transcript;
      window.__YT_TX_VIDEO_ID__ = videoId;
      window.postMessage({ type: 'YT_TRANSCRIPT_DATA', text: transcript, language: 'English' }, '*');
    }
  }

  function tryJson3(raw) {
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data.events)) return null;
      const parts = [];
      for (const ev of data.events) {
        if (!Array.isArray(ev.segs)) continue;
        const seg = ev.segs.map(s => (s.utf8 || '').replace(/\n/g, ' ')).join('').trim();
        if (seg) parts.push(seg);
      }
      return parts.length ? parts.join(' ').replace(/\s{2,}/g, ' ').trim() : null;
    } catch (_) { return null; }
  }

  function tryXml(raw) {
    try {
      const doc = new DOMParser().parseFromString(raw, 'text/xml');
      const nodes = doc.querySelectorAll('text');
      if (!nodes.length) return null;
      const tmp = document.createElement('div');
      let out = '';
      nodes.forEach(n => { tmp.innerHTML = n.textContent; out += (tmp.textContent || '') + ' '; });
      return out.replace(/\s{2,}/g, ' ').trim() || null;
    } catch (_) { return null; }
  }

})();