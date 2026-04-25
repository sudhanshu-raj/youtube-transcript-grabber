/**
 * popup.js — Controls the extension popup UI.
 *
 * Transcript data is now a JSON array of { start, dur, text } segments.
 * We group them into ~5-second paragraphs and render with timestamp badges.
 * A "Plain Text" toggle switches to the raw textarea for easy copying.
 */

const getCaptionsBtn   = document.getElementById("getCaptions");
const btnText          = document.getElementById("btnText");

const statusEl         = document.getElementById("status");
const statusText       = document.getElementById("statusText");
const spinner          = document.getElementById("spinner");
const outputContainer  = document.getElementById("outputContainer");
const outputEl         = document.getElementById("output");
const transcriptView   = document.getElementById("transcriptView");
const outputLabel      = document.getElementById("outputLabel");
const copyBtn          = document.getElementById("copyBtn");
const clearBtn         = document.getElementById("clearBtn");
const toggleViewBtn    = document.getElementById("toggleViewBtn");
const wordCount        = document.getElementById("wordCount");
const footer           = document.getElementById("footer");
const mainBody         = document.getElementById("mainBody");
const notYouTube       = document.getElementById("notYouTube");
const videoInfo        = document.getElementById("videoInfo");
const videoInfoText    = document.getElementById("videoInfoText");

let _plainText  = '';    
let _isPlain    = false;

// On popup open: detect current tab
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const isYouTubeVideo =
    tab?.url?.includes("youtube.com/watch") ||
    tab?.url?.includes("youtube.com/shorts");

  if (!isYouTubeVideo) {
    mainBody.style.display  = "none";
    notYouTube.classList.add("visible");
    return;
  }

  videoInfo.classList.add("visible");
  try {
    const title = tab.title?.replace(" - YouTube", "").trim();
    videoInfoText.textContent = title || "YouTube video detected";
  } catch (_) {}

  // Check if background has a pending result
  chrome.runtime.sendMessage({ type: "POPUP_READY" }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.type === "TRANSCRIPT_RESULT") {
      showResult(response.transcript, response.language);
    } else if (response?.type === "TRANSCRIPT_ERROR") {
      showError(response.error);
    }
  });
})();

// Button click 
getCaptionsBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  setLoading(true);
  hideOutput();

  chrome.tabs.sendMessage(tab.id, { type: "GET_TRANSCRIPT" }, () => {
    if (chrome.runtime.lastError) {
      setLoading(false);
      showError("Cannot connect to the page. Please reload the YouTube tab and try again.");
    }
  });
});

// Listen for results from background relay 
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TRANSCRIPT_RESULT") {
    setLoading(false);
    showResult(msg.transcript, msg.language);
  } else if (msg.type === "TRANSCRIPT_ERROR") {
    setLoading(false);
    showError(msg.error);
  }
});

// Toggle between timestamp view and plain-text view 
toggleViewBtn.addEventListener("click", () => {
  _isPlain = !_isPlain;
  if (_isPlain) {
    transcriptView.style.display = "none";
    outputEl.style.display       = "block";
    toggleViewBtn.textContent    = "Timestamps";
  } else {
    outputEl.style.display       = "none";
    transcriptView.style.display = "block";
    toggleViewBtn.textContent    = "Plain Text";
  }
});

// Copy button 
copyBtn.addEventListener("click", async () => {
  if (!_plainText) return;
  await navigator.clipboard.writeText(_plainText);
  const prev = copyBtn.textContent;
  copyBtn.textContent = "Copied!";
  setTimeout(() => (copyBtn.textContent = prev), 1500);
});

// Clear button 
clearBtn.addEventListener("click", () => {
  hideOutput();
  setStatus("", "");
});

// Helper: format seconds → [mm:ss] 
function formatTime(seconds) {
  if (seconds === null || isNaN(seconds)) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Helper: group segments into paragraphs (~N seconds each) 
const GROUP_SECONDS = 30;

function groupSegments(segments) {
  if (!segments.length) return [];

  const groups = [];
  let current  = null;

  for (const seg of segments) {
    const start = seg.start ?? 0;
    if (!current || (seg.start !== null && start - current.startSec >= GROUP_SECONDS)) {
      current = { startSec: start, startFmt: formatTime(start), lines: [] };
      groups.push(current);
    }
    current.lines.push(seg.text);
  }

  return groups;
}

// Render segments into the transcript-view div 
function renderSegments(segments, language) {
  transcriptView.innerHTML = '';

  const hasTimestamps = segments.some(s => s.start !== null);
  const groups = hasTimestamps ? groupSegments(segments) : [{ startSec: null, startFmt: null, lines: segments.map(s => s.text) }];

  groups.forEach((group) => {
    const block = document.createElement('div');
    block.className = 'tx-block';

    if (group.startFmt) {
      const stamp = document.createElement('span');
      stamp.className = 'tx-stamp';
      stamp.textContent = group.startFmt;
      block.appendChild(stamp);
    }

    const para = document.createElement('p');
    para.className = 'tx-para';
    para.textContent = group.lines.join(' ');
    block.appendChild(para);

    transcriptView.appendChild(block);
  });
}

// Main show/hide helpers 
function showResult(transcriptRaw, language) {
  let segments = null;
  try {
    const parsed = JSON.parse(transcriptRaw);
    if (Array.isArray(parsed) && parsed.length && typeof parsed[0] === 'object') {
      segments = parsed;
    }
  } catch (_) {}

  if (segments) {
    _plainText = segments.map(s => s.text).join(' ').replace(/\s{2,}/g, ' ').trim();
  } else {
    _plainText = typeof transcriptRaw === 'string' ? transcriptRaw : '';
  }

  outputEl.value = _plainText;
  outputLabel.textContent = `Transcript${language ? ` (${language})` : ""}`;

  if (segments) {
    renderSegments(segments, language);
  } else {
    transcriptView.innerHTML = `<div class="tx-block"><p class="tx-para">${_plainText}</p></div>`;
  }

  // Default: show timestamp view
  _isPlain = false;
  transcriptView.style.display = "block";
  outputEl.style.display       = "none";
  toggleViewBtn.textContent    = "Plain Text";

  outputContainer.classList.add("visible");
  footer.style.display = "flex";

  const words = _plainText.trim().split(/\s+/).filter(Boolean).length;
  wordCount.textContent = `${words.toLocaleString()} words`;

  setStatus("Transcript extracted successfully", "success");
}

function showError(errorMsg) {
  setStatus(`${errorMsg}`, "error");
}

function hideOutput() {
  _plainText             = '';
  outputEl.value         = '';
  transcriptView.innerHTML = '';
  outputContainer.classList.remove("visible");
  footer.style.display   = "none";
  _isPlain = false;
}

function setLoading(active) {
  getCaptionsBtn.disabled = active;
  if (active) {
    btnText.textContent = "Extracting…";
    setStatus("Enabling captions to capture transcript…", "loading");
    spinner.style.display = "block";
  } else {
    btnText.textContent = "Get Transcript";
    spinner.style.display = "none";
  }
}

function setStatus(text, type) {
  statusText.textContent = text;
  statusEl.className     = "status";
  if (type) {
    statusEl.classList.add("visible", type);
    spinner.style.display = type === "loading" ? "block" : "none";
  }
  if (!text) {
    statusEl.classList.remove("visible");
  }
}