// ==========================================================================
// Synapse Deck Maker - Application Logic
// Replicated from base44 reference (https://hidden-synapse-deck-flow.base44.app)
// ==========================================================================

// Preloaded starter deck matching base44 reference
const DEFAULT_STARTER_DECKS = [
  {
    id: "deck-telecom-default",
    name: "Electronics & Telecom",
    cards: [
      {
        q: "What is bandwidth?",
        a: "Data transfer rate",
        w: ["Storage capacity", "Signal frequency", "Cable resistance"]
      },
      {
        q: "What does modulation do?",
        a: "Converts signals",
        w: ["Amplifies power", "Filters noise", "Stores packets"]
      },
      {
        q: "What is multiplexing?",
        a: "Combining signals",
        w: ["Splitting data", "Encrypting bits", "Regulating power"]
      },
      {
        q: "What does Shannon's theorem define?",
        a: "Max channel rate",
        w: ["Min cable length", "Battery voltage", "Antenna height"]
      },
      {
        q: "What is a repeater?",
        a: "Signal regenerator",
        w: ["Network router", "Power converter", "Grounding wire"]
      },
      {
        q: "What is full-duplex communication?",
        a: "Two-way at once",
        w: ["One-way only", "Alternating flow", "Broadcast only"]
      },
      {
        q: "What is a checksum used for?",
        a: "Error detection",
        w: ["Data encryption", "Clock timing", "Signal boost"]
      },
      {
        q: "What does Nyquist's theorem state?",
        a: "Max noiseless rate",
        w: ["Thermal noise limit", "Battery lifespan", "Phase delay"]
      },
      {
        q: "What is packet switching?",
        a: "Chunk-based routing",
        w: ["Dedicated circuits", "Continuous waves", "Analog tuning"]
      }
    ]
  }
];

// App State
let savedDecks = [];
let currentDeck = null;
let currentCardIndex = 0;
let isFlipped = false;
let studyCardIndices = [];
let activeView = "home";

// User Settings
let userSettings = {
  shuffleByDefault: false,
  autoSave: true,
  reminders: true
};

// DOM Elements
const views = {
  home: document.getElementById("viewHome"),
  deck: document.getElementById("viewDeck"),
  history: document.getElementById("viewHistory"),
  settings: document.getElementById("viewSettings")
};

const navBtns = {
  home: document.getElementById("navHomeBtn"),
  history: document.getElementById("navHistoryBtn"),
  settings: document.getElementById("navSettingsBtn"),
  mobHome: document.getElementById("mobHomeBtn"),
  mobHistory: document.getElementById("mobHistoryBtn"),
  mobSettings: document.getElementById("mobSettingsBtn")
};

// --- Initialization ---
function init() {
  loadStoredSettings();
  loadStoredDecks();
  setupNavigation();
  setupFormHandlers();
  setupDocxUpload();
  setupStudyMode();
  setupHistoryView();
  setupSettingsView();
  renderSavedDecks();
}

// --- Storage Handlers ---
function loadStoredSettings() {
  try {
    const raw = localStorage.getItem("synapse_settings");
    if (raw) userSettings = Object.assign(userSettings, JSON.parse(raw));
  } catch (e) {
    console.warn("Could not load settings:", e);
  }

  const shuffleToggle = document.getElementById("settingShuffle");
  const autoSaveToggle = document.getElementById("settingAutoSave");
  const remindersToggle = document.getElementById("settingReminders");

  if (shuffleToggle) shuffleToggle.checked = !!userSettings.shuffleByDefault;
  if (autoSaveToggle) autoSaveToggle.checked = !!userSettings.autoSave;
  if (remindersToggle) remindersToggle.checked = !!userSettings.reminders;
}

function saveStoredSettings() {
  try {
    localStorage.setItem("synapse_settings", JSON.stringify(userSettings));
  } catch (e) {
    console.warn("Could not save settings:", e);
  }
}

function loadStoredDecks() {
  try {
    const raw = localStorage.getItem("synapse_decks");
    if (raw) {
      savedDecks = JSON.parse(raw);
    } else {
      savedDecks = [...DEFAULT_STARTER_DECKS];
      saveStoredDecks();
    }
  } catch (e) {
    savedDecks = [...DEFAULT_STARTER_DECKS];
  }
}

function saveStoredDecks() {
  try {
    localStorage.setItem("synapse_decks", JSON.stringify(savedDecks));
  } catch (e) {
    console.warn("Could not persist decks to localStorage:", e);
  }
  renderSavedDecks();
  renderHistoryDecks();
}

// --- View Router ---
function switchView(viewName) {
  activeView = viewName;

  // Toggle views
  Object.keys(views).forEach((v) => {
    if (views[v]) {
      if (v === viewName) {
        views[v].classList.remove("hidden");
      } else {
        views[v].classList.add("hidden");
      }
    }
  });

  // Update nav buttons active states
  ["home", "history", "settings"].forEach((v) => {
    const desktopBtn = navBtns[v];
    const mobBtn = navBtns["mob" + v.charAt(0).toUpperCase() + v.slice(1)];
    const isActive = viewName === v || (viewName === "deck" && v === "home");

    if (desktopBtn) desktopBtn.classList.toggle("active", isActive);
    if (mobBtn) mobBtn.classList.toggle("active", isActive);
  });

  window.scrollTo({ top: 0, behavior: "smooth" });

  if (viewName === "history") {
    renderHistoryDecks();
  }
}

function setupNavigation() {
  navBtns.home?.addEventListener("click", () => switchView("home"));
  navBtns.history?.addEventListener("click", () => switchView("history"));
  navBtns.settings?.addEventListener("click", () => switchView("settings"));
  navBtns.mobHome?.addEventListener("click", () => switchView("home"));
  navBtns.mobHistory?.addEventListener("click", () => switchView("history"));
  navBtns.mobSettings?.addEventListener("click", () => switchView("settings"));

  document.getElementById("sidebarLogo")?.addEventListener("click", (e) => {
    e.preventDefault();
    switchView("home");
  });

  document.getElementById("btnBackToDecks")?.addEventListener("click", () => {
    switchView("home");
  });

  document.getElementById("btnStudyActiveDeck")?.addEventListener("click", () => {
    if (currentDeck) startStudyDeck(currentDeck);
  });
}

// --- Prompt Builder matching Synapse screen limits ---
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

// Resilient JSON Deck Parser
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

  // Handle format where cards might be called "cards" or "flashcards"
  const cards = deck.cards || deck.flashcards;
  if (!cards || !Array.isArray(cards) || cards.length === 0) {
    return { error: 'The JSON needs a "cards" list.' };
  }

  // Standardize card shape: support {q, a, w} or {front, back}
  const validatedCards = [];
  for (const c of cards) {
    const q = c.q || c.front || c.question;
    const a = c.a || c.back || c.answer;
    let w = c.w || c.wrong || c.distractors;

    if (!q || !a) continue;

    if (!Array.isArray(w) || w.length === 0) {
      w = ["Option A", "Option B", "Option C"];
    } else if (w.length < 3) {
      while (w.length < 3) w.push("Option " + (w.length + 1));
    } else if (w.length > 3) {
      w = w.slice(0, 3);
    }

    validatedCards.push({ q, a, w });
  }

  if (validatedCards.length === 0) {
    return { error: "Every card needs a question (q) and answer (a)." };
  }

  return {
    deck: {
      id: "deck-" + Date.now(),
      name: deck.name || "My Deck",
      cards: validatedCards,
      created_date: new Date().toISOString()
    }
  };
}

// --- Step 1 & 3 Event Handlers ---
function setupFormHandlers() {
  const generateBtn = document.getElementById("generateBtn");
  const genBtnText = document.getElementById("genBtnText");
  const genMsg = document.getElementById("genMsg");
  const copyPromptBtn = document.getElementById("copyPromptBtn");
  const copyPromptText = document.getElementById("copyPromptText");
  const copyPromptIcon = document.getElementById("copyPromptIcon");
  const copyMsg = document.getElementById("copyMsg");
  const loadDeckBtn = document.getElementById("loadDeckBtn");
  const loadMsg = document.getElementById("loadMsg");

  // Copy Prompt Button
  copyPromptBtn?.addEventListener("click", async () => {
    const name = document.getElementById("deckName").value.trim();
    const notes = document.getElementById("notes").value.trim();

    if (!notes) {
      setMsg(copyMsg, "Paste your notes first.", "error");
      return;
    }

    try {
      await navigator.clipboard.writeText(buildPrompt(name, notes));
      copyPromptText.textContent = "Copied!";
      copyPromptIcon.innerHTML = `<polyline points="20 6 9 17 4 12"/>`;
      setMsg(copyMsg, "Prompt copied! Paste it into your AI chat.", "success");

      setTimeout(() => {
        copyPromptText.textContent = "Copy prompt for AI";
        copyPromptIcon.innerHTML = `
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
        `;
      }, 2500);
    } catch (err) {
      setMsg(copyMsg, "Could not copy prompt to clipboard. Please copy manually.", "error");
    }
  });

  // Load Deck Button
  loadDeckBtn?.addEventListener("click", () => {
    const text = document.getElementById("aiReply").value;
    const name = document.getElementById("deckName").value.trim();
    const result = parseDeck(text);

    if (result.error) {
      setMsg(loadMsg, result.error, "error");
      return;
    }

    if (name) result.deck.name = name;

    if (userSettings.autoSave) {
      savedDecks.unshift(result.deck);
      saveStoredDecks();
    }

    currentDeck = result.deck;
    setMsg(loadMsg, `Deck "${result.deck.name}" loaded with ${result.deck.cards.length} cards!`, "success");
    showDeckPreview(result.deck);
  });

  // Generate Deck Automatically
  generateBtn?.addEventListener("click", async () => {
    const name = document.getElementById("deckName").value.trim();
    const notes = document.getElementById("notes").value.trim();

    if (!notes) {
      setMsg(genMsg, "Paste your notes first.", "error");
      return;
    }

    generateBtn.disabled = true;
    genBtnText.textContent = "Generating deck…";
    setMsg(genMsg, "Contacting Synapse AI engine… this takes a few seconds.", "info");

    try {
      const response = await fetch("http://localhost:3000/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, notes })
      });

      const data = await response.json();

      if (!response.ok) {
        setMsg(genMsg, data.error || "Generation error from server.", "error");
      } else {
        const newDeck = {
          id: "deck-" + Date.now(),
          name: data.name || name || "My Deck",
          cards: data.cards,
          created_date: new Date().toISOString()
        };

        if (userSettings.autoSave) {
          savedDecks.unshift(newDeck);
          saveStoredDecks();
        }

        currentDeck = newDeck;
        setMsg(genMsg, `Deck ready! Created ${newDeck.cards.length} cards.`, "success");
        showDeckPreview(newDeck);
      }
    } catch (err) {
      setMsg(
        genMsg,
        "Server unreachable. You can use 'Or: use any AI chat yourself' below to generate your deck instantly!",
        "error"
      );
    } finally {
      generateBtn.disabled = false;
      genBtnText.textContent = "Generate deck automatically";
    }
  });
}

function setMsg(el, text, type = "info") {
  if (!el) return;
  el.textContent = text;
  el.className = "msg-banner " + type;
}

// --- Docx / Document Upload Handling ---
function setupDocxUpload() {
  const dropzone = document.getElementById("dropzone");
  const docxInput = document.getElementById("docxInput");
  const notesTextarea = document.getElementById("notes");
  const uploadSpinner = document.getElementById("uploadSpinner");
  const uploadIcon = document.getElementById("uploadIcon");
  const uploadTitleText = document.getElementById("uploadTitleText");
  const uploadDescText = document.getElementById("uploadDescText");
  const uploadMsg = document.getElementById("uploadMsg");

  if (!dropzone || !docxInput) return;

  dropzone.addEventListener("click", () => docxInput.click());

  // Drag and drop events
  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });

  dropzone.addEventListener("drop", (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) processFile(files[0]);
  });

  docxInput.addEventListener("change", (e) => {
    const files = e.target.files;
    if (files && files.length > 0) processFile(files[0]);
  });

  async function processFile(file) {
    const isDocx = file.name.toLowerCase().endsWith(".docx");
    const isTxt = file.name.toLowerCase().endsWith(".txt") || file.name.toLowerCase().endsWith(".md");

    if (!isDocx && !isTxt) {
      setMsg(uploadMsg, "Please upload a .docx or .txt document.", "error");
      return;
    }

    uploadSpinner.classList.remove("hidden");
    uploadIcon.classList.add("hidden");
    uploadTitleText.textContent = "Extracting text from " + file.name + "…";
    uploadDescText.textContent = "Please wait a moment";
    setMsg(uploadMsg, "", "info");

    try {
      if (isDocx && window.mammoth) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await window.mammoth.extractRawText({ arrayBuffer });
        const extracted = result.value.trim();

        if (extracted) {
          notesTextarea.value = notesTextarea.value
            ? notesTextarea.value + "\n\n" + extracted
            : extracted;
          setMsg(uploadMsg, `Extracted ${extracted.length} characters from ${file.name}!`, "success");
        } else {
          setMsg(uploadMsg, "No readable text found in document.", "error");
        }
      } else {
        const text = await file.text();
        notesTextarea.value = notesTextarea.value ? notesTextarea.value + "\n\n" + text : text;
        setMsg(uploadMsg, `Imported ${text.length} characters from ${file.name}!`, "success");
      }
    } catch (err) {
      setMsg(uploadMsg, "Failed to read document: " + err.message, "error");
    } finally {
      uploadSpinner.classList.add("hidden");
      uploadIcon.classList.remove("hidden");
      uploadTitleText.textContent = "Click or drop another file";
      uploadDescText.textContent = "Text will be appended into the notes field below";
      docxInput.value = "";
    }
  }
}

// --- Render Saved Decks ---
function renderSavedDecks() {
  const container = document.getElementById("savedDecksList");
  const heading = document.getElementById("savedDecksHeading");

  if (heading) heading.textContent = `${savedDecks.length} Saved decks`;
  if (!container) return;

  if (savedDecks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
          <path d="M6 6h10"/>
          <path d="M6 10h10"/>
        </svg>
        <p class="empty-title">No decks yet</p>
        <p class="empty-desc">Generate or load a deck to save it here.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = savedDecks
    .map(
      (deck, idx) => `
    <div class="deck-item" data-id="${deck.id || idx}">
      <div class="deck-info">
        <svg class="deck-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
          <path d="M6 6h10"/>
          <path d="M6 10h10"/>
        </svg>
        <span class="deck-title">${escapeHtml(deck.name || "Untitled deck")}</span>
        <span class="deck-count">(${deck.cards?.length || 0} cards)</span>
      </div>
      <div class="deck-actions">
        <button class="btn-action-primary btn-open-deck" data-idx="${idx}">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Open
        </button>
        <button class="btn-action-primary btn-dl-deck" data-idx="${idx}">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download
        </button>
        <button class="btn-action-outline btn-del-deck" data-idx="${idx}">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Delete
        </button>
      </div>
    </div>
  `
    )
    .join("");

  // Attach event handlers
  container.querySelectorAll(".btn-open-deck").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"), 10);
      if (savedDecks[idx]) startStudyDeck(savedDecks[idx]);
    });
  });

  container.querySelectorAll(".btn-dl-deck").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"), 10);
      if (savedDecks[idx]) downloadDeck(savedDecks[idx]);
    });
  });

  container.querySelectorAll(".btn-del-deck").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"), 10);
      deleteDeck(idx);
    });
  });
}

function deleteDeck(idx) {
  if (confirm(`Delete "${savedDecks[idx]?.name || "this deck"}"?`)) {
    savedDecks.splice(idx, 1);
    saveStoredDecks();
  }
}

function downloadDeck(deck) {
  const exportData = {
    name: deck.name || "My Deck",
    cards: deck.cards
  };
  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(deck.name || "deck").toLowerCase().replace(/[^a-z0-9]/gi, "_")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Preview Section ---
function showDeckPreview(deck) {
  const previewSection = document.getElementById("previewCardSection");
  const previewTitle = document.getElementById("previewDeckTitle");
  const previewContainer = document.getElementById("preview");

  if (!previewSection || !previewContainer) return;

  previewSection.classList.remove("hidden");
  previewTitle.textContent = `${deck.name || "My Deck"} (${deck.cards.length} cards)`;

  previewContainer.innerHTML = deck.cards
    .map(
      (c, i) => `
    <div class="deck-item" style="flex-direction: column; align-items: flex-start; gap: 0.35rem;">
      <div style="display: flex; align-items: baseline; gap: 0.5rem; width: 100%;">
        <span style="font-size: 0.75rem; font-weight: 700; color: hsl(var(--syn-orange));">#${i + 1}</span>
        <strong style="color: hsl(var(--syn-ink)); font-size: 0.9375rem;">${escapeHtml(c.q)}</strong>
      </div>
      <div style="color: hsl(var(--syn-teal-deep)); font-size: 0.875rem; font-weight: 600;">
        Answer: ${escapeHtml(c.a)}
      </div>
      <div style="color: hsl(var(--syn-ink-soft)); font-size: 0.8125rem;">
        Distractors: ${escapeHtml(c.w?.join(" | ") || "None")}
      </div>
    </div>
  `
    )
    .join("");

  previewSection.scrollIntoView({ behavior: "smooth" });
}

// --- 3D Flashcard Study Studio ---
function setupStudyMode() {
  const flashcard = document.getElementById("flashcard3d");
  const flashcardInner = document.getElementById("flashcardInner");
  const btnPrev = document.getElementById("btnStudyPrev");
  const btnNext = document.getElementById("btnStudyNext");
  const btnShuffle = document.getElementById("btnShuffleDeck");
  const btnReset = document.getElementById("btnResetDeck");

  // Flip card on click
  flashcard?.addEventListener("click", () => {
    isFlipped = !isFlipped;
    flashcardInner.classList.toggle("flipped", isFlipped);
  });

  // Next / Previous buttons
  btnNext?.addEventListener("click", () => nextCard());
  btnPrev?.addEventListener("click", () => prevCard());

  // Shuffle & Reset buttons
  btnShuffle?.addEventListener("click", () => shuffleStudyCards());
  btnReset?.addEventListener("click", () => resetStudyOrder());

  // Keyboard navigation
  window.addEventListener("keydown", (e) => {
    if (activeView !== "deck") return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    if (e.code === "Space") {
      e.preventDefault();
      isFlipped = !isFlipped;
      flashcardInner.classList.toggle("flipped", isFlipped);
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      nextCard();
    } else if (e.code === "ArrowLeft") {
      e.preventDefault();
      prevCard();
    }
  });
}

function startStudyDeck(deck) {
  currentDeck = deck;
  studyCardIndices = deck.cards.map((_, i) => i);

  if (userSettings.shuffleByDefault) {
    shuffleArray(studyCardIndices);
  }

  currentCardIndex = 0;
  isFlipped = false;

  document.getElementById("studyDeckTitle").textContent = deck.name || "Untitled deck";
  document.getElementById("studyDeckSub").textContent = `${deck.cards.length} cards · tap a card to flip it`;

  renderCurrentCard();
  switchView("deck");
}

function renderCurrentCard() {
  if (!currentDeck || !currentDeck.cards || currentDeck.cards.length === 0) return;

  const total = studyCardIndices.length;
  const currentActualIndex = studyCardIndices[currentCardIndex];
  const card = currentDeck.cards[currentActualIndex];

  // Unflip with smooth transition
  isFlipped = false;
  document.getElementById("flashcardInner").classList.remove("flipped");

  // Populate content
  document.getElementById("cardQuestionText").textContent = card.q;
  document.getElementById("cardAnswerText").textContent = card.a;

  const distractorsContainer = document.getElementById("cardWrongAnswers");
  if (distractorsContainer) {
    if (card.w && card.w.length > 0) {
      distractorsContainer.innerHTML = card.w
        .map((w) => `<div class="distractor-pill">Wrong: ${escapeHtml(w)}</div>`)
        .join("");
    } else {
      distractorsContainer.innerHTML = "";
    }
  }

  // Update progress
  const progressPercent = Math.round(((currentCardIndex + 1) / total) * 100);
  document.getElementById("studyProgressLabel").textContent = `Card ${currentCardIndex + 1} of ${total}`;
  document.getElementById("studyPercentLabel").textContent = `${progressPercent}%`;
  document.getElementById("studyProgressFill").style.width = `${progressPercent}%`;
}

function nextCard() {
  if (!currentDeck || studyCardIndices.length === 0) return;
  currentCardIndex = (currentCardIndex + 1) % studyCardIndices.length;
  renderCurrentCard();
}

function prevCard() {
  if (!currentDeck || studyCardIndices.length === 0) return;
  currentCardIndex = (currentCardIndex - 1 + studyCardIndices.length) % studyCardIndices.length;
  renderCurrentCard();
}

function shuffleStudyCards() {
  shuffleArray(studyCardIndices);
  currentCardIndex = 0;
  renderCurrentCard();
}

function resetStudyOrder() {
  if (!currentDeck) return;
  studyCardIndices = currentDeck.cards.map((_, i) => i);
  currentCardIndex = 0;
  renderCurrentCard();
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// --- History View ---
function setupHistoryView() {
  const searchInput = document.getElementById("historySearchInput");
  const clearBtn = document.getElementById("historySearchClear");

  searchInput?.addEventListener("input", () => {
    const query = searchInput.value.trim();
    clearBtn.classList.toggle("hidden", !query);
    renderHistoryDecks(query);
  });

  clearBtn?.addEventListener("click", () => {
    searchInput.value = "";
    clearBtn.classList.add("hidden");
    renderHistoryDecks("");
  });
}

function renderHistoryDecks(query = "") {
  const container = document.getElementById("historyDecksList");
  if (!container) return;

  const filtered = query
    ? savedDecks.filter((d) => (d.name || "").toLowerCase().includes(query.toLowerCase()))
    : savedDecks;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <p class="empty-title">${query ? "No decks match your search" : "No decks in history"}</p>
        <p class="empty-desc">${query ? "Try a different keyword." : "Generate or load a deck to see it here."}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered
    .map((deck, idx) => {
      const realIdx = savedDecks.indexOf(deck);
      return `
      <div class="deck-item">
        <div class="deck-info">
          <svg class="deck-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
            <path d="M6 6h10"/>
            <path d="M6 10h10"/>
          </svg>
          <span class="deck-title">${escapeHtml(deck.name || "Untitled deck")}</span>
          <span class="deck-count">(${deck.cards?.length || 0} cards)</span>
        </div>
        <div class="deck-actions">
          <button class="btn-action-primary btn-history-open" data-idx="${realIdx}">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Open
          </button>
          <button class="btn-action-outline btn-history-del" data-idx="${realIdx}">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Delete
          </button>
        </div>
      </div>
    `;
    })
    .join("");

  container.querySelectorAll(".btn-history-open").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"), 10);
      if (savedDecks[idx]) startStudyDeck(savedDecks[idx]);
    });
  });

  container.querySelectorAll(".btn-history-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"), 10);
      deleteDeck(idx);
    });
  });
}

// --- Settings View ---
function setupSettingsView() {
  const shuffleToggle = document.getElementById("settingShuffle");
  const autoSaveToggle = document.getElementById("settingAutoSave");
  const remindersToggle = document.getElementById("settingReminders");

  shuffleToggle?.addEventListener("change", (e) => {
    userSettings.shuffleByDefault = e.target.checked;
    saveStoredSettings();
  });

  autoSaveToggle?.addEventListener("change", (e) => {
    userSettings.autoSave = e.target.checked;
    saveStoredSettings();
  });

  remindersToggle?.addEventListener("change", (e) => {
    userSettings.reminders = e.target.checked;
    saveStoredSettings();
  });
}

// --- Utilities ---
function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Start application when DOM is ready
document.addEventListener("DOMContentLoaded", init);