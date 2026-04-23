/**
 * popup.js — Controls the extension popup UI.
 *
 * On open:  checks if current tab is a YouTube video page.
 * On click: sends GET_TRANSCRIPT to content.js via chrome.tabs.sendMessage,
 *           then listens for TRANSCRIPT_RESULT or TRANSCRIPT_ERROR from background.js.
 */

const getCaptionsBtn = document.getElementById("getCaptions");
const btnText        = document.getElementById("btnText");
const btnIcon        = document.getElementById("btnIcon");
const statusEl       = document.getElementById("status");
const statusText     = document.getElementById("statusText");
const spinner        = document.getElementById("spinner");
const outputContainer = document.getElementById("outputContainer");
const outputEl       = document.getElementById("output");
const outputLabel    = document.getElementById("outputLabel");
const copyBtn        = document.getElementById("copyBtn");
const clearBtn       = document.getElementById("clearBtn");
const wordCount      = document.getElementById("wordCount");
const footer         = document.getElementById("footer");
const mainBody       = document.getElementById("mainBody");
const notYouTube     = document.getElementById("notYouTube");
const videoInfo      = document.getElementById("videoInfo");
const videoInfoText  = document.getElementById("videoInfoText");

// On popup open: detect current tab 
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const isYouTubeVideo =
    tab?.url?.includes("youtube.com/watch") ||
    tab?.url?.includes("youtube.com/shorts");

  if (!isYouTubeVideo) {
    mainBody.style.display   = "none";
    notYouTube.classList.add("visible");
    return;
  }

  // Show video info
  videoInfo.classList.add("visible");
  try {
    const title = tab.title?.replace(" - YouTube", "").trim();
    videoInfoText.textContent = title || "YouTube video detected";
  } catch (_) {}

  // Checking if background has a pending result from a previous extraction
  chrome.runtime.sendMessage({ type: "POPUP_READY" }, (response) => {
    if (chrome.runtime.lastError) return; // background not ready yet
    if (response?.type === "TRANSCRIPT_RESULT") {
      showResult(response.transcript, response.language);
    } else if (response?.type === "TRANSCRIPT_ERROR") {
      showError(response.error);
    }
  });
})();

// Button click: request transcript 
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

//  Copy button 
copyBtn.addEventListener("click", async () => {
  if (!outputEl.value) return;
  await navigator.clipboard.writeText(outputEl.value);
  const prev = copyBtn.textContent;
  copyBtn.textContent = "Copied ✓";
  setTimeout(() => (copyBtn.textContent = prev), 1500);
});

// Clear button 
clearBtn.addEventListener("click", () => {
  hideOutput();
  setStatus("", "");
});

//  Helper functions 
function setLoading(active) {
  getCaptionsBtn.disabled = active;
  if (active) {
    btnIcon.textContent = "";
    btnText.textContent = "Extracting…";
    setStatus("Enabling captions to capture transcript…", "loading");
    spinner.style.display = "block";
  } else {
    btnIcon.textContent = "📋";
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

function showResult(transcript, language) {
  outputEl.value = transcript;
  outputLabel.textContent = `Transcript${language ? ` (${language})` : ""}`;
  outputContainer.classList.add("visible");
  footer.style.display = "flex";

  const words = transcript.trim().split(/\s+/).filter(Boolean).length;
  wordCount.textContent = `${words.toLocaleString()} words`;

  setStatus(`✓ Transcript extracted successfully`, "success");
}

function showError(errorMsg) {
  setStatus(`✗ ${errorMsg}`, "error");
}

function hideOutput() {
  outputEl.value = "";
  outputContainer.classList.remove("visible");
  footer.style.display = "none";
}