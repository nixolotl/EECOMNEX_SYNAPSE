// ==========================================================================
// Synapse Deck Maker - script.js
// New design (index.html + style.css from the team) + the server logic.
// ==========================================================================

const SERVER = "http://localhost:3000";
const MAX_NOTES = 8000; // the server rejects notes longer than this

const $ = (id) => document.getElementById(id);

// ---------- State ----------
let currentDeck = null;   // the deck shown in the preview card
let allDecks = [];        // list of saved decks from the server
let studyOriginal = [];   // cards in their original order
let studyCards = [];      // cards in the order being studied
let studyIndex = 0;
let studyName = "";
let flipped = false;

// ---------- Elements ----------
const views = {
  home: $("viewHome"),
  deck: $("viewDeck"),
  history: $("viewHistory"),
  settings: $("viewSettings")
};

const navButtons = {
  home: [$("navHomeBtn"), $("mobHomeBtn")],
  history: [$("navHistoryBtn"), $("mobHistoryBtn")],
  settings: [$("navSettingsBtn"), $("mobSettingsBtn")]
};

const generateBtn = $("generateBtn");
const genBtnText = $("genBtnText");
const genMsg = $("genMsg");
const copyPromptBtn = $("copyPromptBtn");
const copyPromptText = $("copyPromptText");
const copyMsg = $("copyMsg");
const loadDeckBtn = $("loadDeckBtn");
const loadMsg = $("loadMsg");
const uploadMsg = $("uploadMsg");
const preview = $("preview");
const previewCardSection = $("previewCardSection");

// ==========================================================================
// Small helpers
// ==========================================================================
function setMsg(el, text, kind) {
  if (!el) return;
  el.textContent = text || "";
  el.className = "msg-banner" + (kind ? " " + kind : "");
}

function shuffled(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ==========================================================================
// Settings (saved in this browser only)
// ==========================================================================
const SETTINGS_KEY = "synapse.settings";
const settings = { shuffle: false, autoSave: true, reminders: true };

function loadSettings() {
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
  } catch (e) { /* use defaults */ }
  $("settingShuffle").checked = !!settings.shuffle;
  $("settingAutoSave").checked = !!settings.autoSave;
  $("settingReminders").checked = !!settings.reminders;
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) { /* storage blocked, ignore */ }
}

$("settingShuffle").addEventListener("change", (e) => { settings.shuffle = e.target.checked; saveSettings(); });
$("settingAutoSave").addEventListener("change", (e) => { settings.autoSave = e.target.checked; saveSettings(); });
$("settingReminders").addEventListener("change", (e) => { settings.reminders = e.target.checked; saveSettings(); });

// ==========================================================================
// Navigation (sidebar, mobile bar, logo)
// ==========================================================================
function showView(name) {
  Object.keys(views).forEach((key) => {
    views[key].classList.toggle("hidden", key !== name);
  });

  const activeNav = name === "deck" ? "home" : name;
  Object.keys(navButtons).forEach((key) => {
    navButtons[key].forEach((btn) => btn.classList.toggle("active", key === activeNav));
  });

  if (name === "history") loadSavedDecks();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

[
  ["navHomeBtn", "home"], ["mobHomeBtn", "home"],
  ["navHistoryBtn", "history"], ["mobHistoryBtn", "history"],
  ["navSettingsBtn", "settings"], ["mobSettingsBtn", "settings"]
].forEach(([id, view]) => {
  $(id).addEventListener("click", () => showView(view));
});

[$("sidebarLogo"), $("headerBrandLink")].forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    showView("home");
  });
});

// ==========================================================================
// Prompt + JSON helpers (backup flow: any AI chat)
// ==========================================================================
// The length limits match what fits on the Synapse screen.
function buildPrompt(name, notes) {
  return `You are making a flashcard deck for a small handheld study device.

Deck name: ${name || "My Deck"}

Read the notes below and create 5 to 8 multiple-choice flashcards from them.

Rules:
- Use ONLY facts from the notes.
- "q" is the question, maximum 60 characters.
- "a" is the correct answer, maximum 18 characters.
- "w" is exactly 3 wrong answers that sound believable, each maximum 18 characters.
- Use plain keyboard characters only. Write x for multiplication, / for division, and spell out symbols.
- Reply with JSON only. No explanation and no code fences.

Use exactly this shape:
{"name":"${name || "My Deck"}","cards":[{"q":"","a":"","w":["","",""]}]}

NOTES:
${notes}`;
}

// Turns the AI's text into a deck, or returns an error message.
function parseDeck(text) {
  let clean = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end !== -1) clean = clean.slice(start, end + 1);

  clean = clean
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

  let deck;
  try {
    deck = JSON.parse(clean);
  } catch (e) {
    return { error: "Could not read the JSON: " + e.message };
  }

  if (!deck.cards || !Array.isArray(deck.cards) || deck.cards.length === 0) {
    return { error: 'The JSON needs a "cards" list.' };
  }
  for (const c of deck.cards) {
    if (!c.q || !c.a || !Array.isArray(c.w) || c.w.length !== 3) {
      return { error: "Every card needs q, a, and exactly 3 wrong answers (w)." };
    }
  }
  return { deck };
}

function downloadDeck(deck) {
  const fileName =
    (deck.name || "deck").toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".json";
  const blob = new Blob([JSON.stringify(deck, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ==========================================================================
// Preview card (after generating or loading a deck)
// ==========================================================================
function showDeck(deck) {
  currentDeck = deck;

  previewCardSection.classList.remove("hidden");
  $("previewDeckTitle").textContent = `${deck.name || "My Deck"} (${deck.cards.length} cards)`;

  preview.innerHTML = "";
  deck.cards.forEach((c) => {
    const item = document.createElement("div");
    item.className = "deck-item";

    const body = document.createElement("div");

    const q = document.createElement("div");
    q.className = "deck-title";
    q.textContent = c.q;

    const a = document.createElement("div");
    a.className = "deck-count";
    a.textContent = "Answer: " + c.a;

    const w = document.createElement("div");
    w.className = "deck-count";
    w.textContent = "Wrong: " + c.w.join(" | ");

    body.append(q, a, w); // textContent keeps pasted text safe
    item.appendChild(body);
    preview.appendChild(item);
  });

  previewCardSection.scrollIntoView({ behavior: "smooth" });
}

$("btnStudyActiveDeck").addEventListener("click", () => {
  if (currentDeck) openStudy(currentDeck);
});

// ==========================================================================
// Saved decks (kept by the server) - used by Home and History
// ==========================================================================
function makeActionButton(text, kind, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.className = kind === "outline" ? "btn-action-outline" : "btn-action-primary";
  b.addEventListener("click", onClick);
  return b;
}

async function fetchDeck(id) {
  const response = await fetch(SERVER + "/api/decks/" + encodeURIComponent(id));
  if (!response.ok) throw new Error("Deck not found.");
  return response.json();
}

function buildDeckRow(d) {
  const row = document.createElement("div");
  row.className = "deck-item";

  const info = document.createElement("div");
  info.className = "deck-info";

  const title = document.createElement("span");
  title.className = "deck-title";
  title.textContent = d.name;

  const count = document.createElement("span");
  count.className = "deck-count";
  count.textContent = `(${d.cards} cards)`;

  info.append(title, count);

  const actions = document.createElement("div");
  actions.className = "deck-actions";

  actions.appendChild(makeActionButton("Study", "primary", async () => {
    try {
      openStudy(await fetchDeck(d.id));
    } catch (err) {
      alert("Could not open that deck. Is the server running?");
    }
  }));

  actions.appendChild(makeActionButton("Download", "outline", async () => {
    try {
      downloadDeck(await fetchDeck(d.id));
    } catch (err) {
      alert("Could not download that deck. Is the server running?");
    }
  }));

  actions.appendChild(makeActionButton("Delete", "outline", async () => {
    if (!confirm(`Delete "${d.name}" from the server?`)) return;
    try {
      await fetch(SERVER + "/api/decks/" + encodeURIComponent(d.id), { method: "DELETE" });
    } catch (err) {
      alert("Could not reach the server.");
    }
    loadSavedDecks();
  }));

  row.append(info, actions);
  return row;
}

function renderEmpty(container, title, desc) {
  container.innerHTML = "";
  const box = document.createElement("div");
  box.className = "empty-state";

  const t = document.createElement("p");
  t.className = "empty-title";
  t.textContent = title;

  const d = document.createElement("p");
  d.className = "empty-desc";
  d.textContent = desc;

  box.append(t, d);
  container.appendChild(box);
}

function renderSaved() {
  const n = allDecks.length;
  $("savedDecksHeading").textContent = `${n} Saved deck${n === 1 ? "" : "s"}`;

  const list = $("savedDecksList");
  if (n === 0) {
    renderEmpty(list, "No saved decks yet", "Generate one above.");
    return;
  }
  list.innerHTML = "";
  allDecks.forEach((d) => list.appendChild(buildDeckRow(d)));
}

function renderHistory() {
  const term = $("historySearchInput").value.trim().toLowerCase();
  $("historySearchClear").classList.toggle("hidden", term === "");

  const list = $("historyDecksList");
  const matches = allDecks.filter((d) => d.name.toLowerCase().includes(term));

  if (allDecks.length === 0) {
    renderEmpty(list, "No decks yet", "Decks you generate will show up here.");
    return;
  }
  if (matches.length === 0) {
    renderEmpty(list, "No matches", "Try a different name.");
    return;
  }
  list.innerHTML = "";
  matches.forEach((d) => list.appendChild(buildDeckRow(d)));
}

async function loadSavedDecks() {
  try {
    const response = await fetch(SERVER + "/api/decks");
    if (!response.ok) throw new Error("Server error " + response.status);
    allDecks = await response.json();
    renderSaved();
    renderHistory();
  } catch (err) {
    allDecks = [];
    $("savedDecksHeading").textContent = "Saved decks";
    renderEmpty($("savedDecksList"), "Could not reach the server", "Is it running? Start it with: node server.js");
    renderEmpty($("historyDecksList"), "Could not reach the server", "Is it running? Start it with: node server.js");
  }
}

$("historySearchInput").addEventListener("input", renderHistory);
$("historySearchClear").addEventListener("click", () => {
  $("historySearchInput").value = "";
  renderHistory();
});

// ==========================================================================
// Upload a Word (.docx) or .txt file -> fills the notes box
// ==========================================================================
const dropzone = $("dropzone");
const docxInput = $("docxInput");

function showUploading(on) {
  $("uploadIcon").classList.toggle("hidden", on);
  $("uploadSpinner").classList.toggle("hidden", !on);
  if (on) $("uploadTitleText").textContent = "Reading file...";
}


async function handleFile(file) {
  if (!file) return;

  setMsg(uploadMsg, "", "");
  showUploading(true);

  try {
    const lower = file.name.toLowerCase();
    const allowed = [".pdf", ".txt", ".docx"];
    const ext = allowed.find((ending) => lower.endsWith(ending));

    if (!ext) {
      throw new Error("Please choose a PDF, TXT, or DOCX file.");
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new Error("File is too large. Please choose a file under 5 MB.");
    }

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(SERVER + "/api/upload", {
      method: "POST",
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not read that file.");
    }

    const text = (data.notes || "").trim();

    if (!text) {
      throw new Error("No readable text was found in that file.");
    }

    $("notes").value = text;
    $("uploadTitleText").textContent = file.name;
    $("uploadDescText").textContent =
      "Text extracted into the notes field below";

    if (data.truncated) {
      setMsg(
        uploadMsg,
        "Text was shortened to 8,000 characters. Review it before generating.",
        "info"
      );
    } else {
      setMsg(uploadMsg, "Text loaded into your notes.", "success");
    }
  } catch (err) {
    $("uploadTitleText").textContent =
      "Click or drop a PDF, DOCX, or TXT file";
    setMsg(uploadMsg, err.message || "Could not read that file.", "error");
  } finally {
    showUploading(false);
    docxInput.value = "";
  }
}

dropzone.addEventListener("click", () => docxInput.click());
docxInput.addEventListener("change", () => handleFile(docxInput.files[0]));

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  handleFile(e.dataTransfer.files[0]);
});

// ==========================================================================
// Automatic: ask our server, which asks the AI
// ==========================================================================
generateBtn.addEventListener("click", async () => {
  const name = $("deckName").value.trim();
  const notes = $("notes").value.trim();

  if (!notes) {
    setMsg(genMsg, "Paste your notes first.", "error");
    return;
  }
  if (notes.length > MAX_NOTES) {
    setMsg(genMsg, `Notes are too long (${notes.length} characters). Keep them under ${MAX_NOTES}.`, "error");
    return;
  }

  generateBtn.disabled = true;
  genBtnText.textContent = "Making your deck...";
  setMsg(genMsg, "Making your deck... this takes a few seconds.", "info");

  let data;
  try {
    const response = await fetch(SERVER + "/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, notes })
    });
    data = await response.json();

    if (!response.ok) {
      setMsg(genMsg, data.error || "Something went wrong.", "error");
      return;
    }
  } catch (err) {
    setMsg(genMsg, "Could not reach the server. Is it running?", "error");
    return;
  } finally {
    generateBtn.disabled = false;
    genBtnText.textContent = "Generate deck automatically";
  }

  setMsg(genMsg, "Deck ready and saved.", "success");
  showDeck(data);
  loadSavedDecks();
});

// ==========================================================================
// Backup: copy a prompt, paste the AI's answer
// ==========================================================================
copyPromptBtn.addEventListener("click", async () => {
  const name = $("deckName").value.trim();
  const notes = $("notes").value.trim();

  if (!notes) {
    setMsg(copyMsg, "Paste your notes first.", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(buildPrompt(name, notes));
    setMsg(copyMsg, "Prompt copied! Paste it into an AI chat.", "success");
    copyPromptText.textContent = "Copied!";
    setTimeout(() => { copyPromptText.textContent = "Copy prompt for AI"; }, 2000);
  } catch (err) {
    setMsg(copyMsg, "Could not copy. Try again.", "error");
  }
});

loadDeckBtn.addEventListener("click", async () => {
  const result = parseDeck($("aiReply").value);

  if (result.error) {
    setMsg(loadMsg, result.error, "error");
    return;
  }
  showDeck(result.deck);

  // Also save it on the server so the Synapse can sync it later
  try {
    const response = await fetch(SERVER + "/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result.deck)
    });
    if (response.ok) {
      setMsg(loadMsg, "Deck loaded and saved.", "success");
    } else {
      setMsg(loadMsg, "Deck loaded (not saved on the server).", "error");
    }
    loadSavedDecks();
  } catch (err) {
    setMsg(loadMsg, "Deck loaded (server not reachable, so not saved).", "error");
  }
});

// ==========================================================================
// 3D study view
// ==========================================================================
function openStudy(deck) {
  if (!deck || !Array.isArray(deck.cards) || deck.cards.length === 0) return;

  studyName = deck.name || "My Deck";
  studyOriginal = deck.cards.slice();
  studyCards = settings.shuffle ? shuffled(studyOriginal) : studyOriginal.slice();
  studyIndex = 0;

  showView("deck");
  renderStudy();
}

function renderStudy() {
  const n = studyCards.length;
  if (n === 0) return;

  const card = studyCards[studyIndex];
  const pct = Math.round(((studyIndex + 1) / n) * 100);

  $("studyDeckTitle").textContent = studyName;
  $("studyDeckSub").textContent = `${n} cards \u00B7 tap a card to flip it`;
  $("studyProgressLabel").textContent = `Card ${studyIndex + 1} of ${n}`;
  $("studyPercentLabel").textContent = pct + "%";
  $("studyProgressFill").style.width = pct + "%";

  // Flip back to the question first, then swap the answer side
  // after the flip, so the next answer is never visible early.
  const wasFlipped = flipped;
  flipped = false;
  $("flashcardInner").classList.remove("flipped");
  $("cardQuestionText").textContent = card.q;

  const fillBack = () => {
    $("cardAnswerText").textContent = card.a;
    const box = $("cardDistractors");
    box.innerHTML = "";
    card.w.forEach((wrong) => {
      const pill = document.createElement("div");
      pill.className = "distractor-pill";
      pill.textContent = wrong;
      box.appendChild(pill);
    });
  };
  if (wasFlipped) setTimeout(fillBack, 300);
  else fillBack();

  const prev = $("btnStudyPrev");
  const next = $("btnStudyNext");
  prev.disabled = studyIndex === 0;
  next.disabled = studyIndex === n - 1;
  prev.style.opacity = prev.disabled ? "0.5" : "1";
  next.style.opacity = next.disabled ? "0.5" : "1";
}

function flipCard() {
  flipped = !flipped;
  $("flashcardInner").classList.toggle("flipped", flipped);
}

function nextCard() {
  if (studyIndex < studyCards.length - 1) {
    studyIndex++;
    renderStudy();
  }
}

function prevCard() {
  if (studyIndex > 0) {
    studyIndex--;
    renderStudy();
  }
}

$("flashcard3d").addEventListener("click", flipCard);
$("btnStudyNext").addEventListener("click", nextCard);
$("btnStudyPrev").addEventListener("click", prevCard);
$("btnBackToDecks").addEventListener("click", () => showView("home"));

$("btnShuffleDeck").addEventListener("click", () => {
  studyCards = shuffled(studyCards);
  studyIndex = 0;
  renderStudy();
});

$("btnResetDeck").addEventListener("click", () => {
  studyCards = studyOriginal.slice();
  studyIndex = 0;
  renderStudy();
});

document.addEventListener("keydown", (e) => {
  if (views.deck.classList.contains("hidden")) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;

  if (e.code === "Space") {
    e.preventDefault();
    flipCard();
  } else if (e.key === "ArrowRight") {
    nextCard();
  } else if (e.key === "ArrowLeft") {
    prevCard();
  }
});

// ==========================================================================
// Start
// ==========================================================================
loadSettings();
loadSavedDecks();