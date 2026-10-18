const SERVER = "http://localhost:3000";

let currentDeck = null;

const generateBtn = document.getElementById("generateBtn");
const genMsg = document.getElementById("genMsg");
const copyPromptBtn = document.getElementById("copyPromptBtn");
const copyMsg = document.getElementById("copyMsg");
const loadDeckBtn = document.getElementById("loadDeckBtn");
const loadMsg = document.getElementById("loadMsg");
const downloadBtn = document.getElementById("downloadBtn");
const preview = document.getElementById("preview");
const savedList = document.getElementById("savedList");
const savedMsg = document.getElementById("savedMsg");

// Builds the instructions we send to the AI (backup flow).
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
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");

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

function addLine(parent, className, text) {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;   // textContent keeps pasted text safe
  parent.appendChild(div);
}

function showDeck(deck) {
  currentDeck = deck;
  downloadBtn.style.display = "inline-block";

  preview.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = `${deck.name || "My Deck"} (${deck.cards.length} cards)`;
  preview.appendChild(title);

  deck.cards.forEach((c) => {
    const card = document.createElement("div");
    card.className = "card";
    addLine(card, "q", c.q);
    addLine(card, "a", "Answer: " + c.a);
    addLine(card, "w", "Wrong: " + c.w.join(" | "));
    preview.appendChild(card);
  });
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

// ---------- Saved decks (kept by the server) ----------
function makeButton(text, onClick) {
  const b = document.createElement("button");
  b.textContent = text;
  b.className = "small";
  b.addEventListener("click", onClick);
  return b;
}

async function loadSavedDecks() {
  savedList.innerHTML = "";
  try {
    const response = await fetch(SERVER + "/api/decks");
    const list = await response.json();

    if (list.length === 0) {
      savedMsg.textContent = "No saved decks yet. Generate one above.";
      return;
    }
    savedMsg.textContent = "";

    list.forEach((d) => {
      const row = document.createElement("div");
      row.className = "card row";

      const label = document.createElement("div");
      label.className = "q";
      label.textContent = `${d.name} (${d.cards} cards)`;
      row.appendChild(label);

      const buttons = document.createElement("div");
      buttons.className = "buttons";

      buttons.appendChild(makeButton("Open", async () => {
        const r = await fetch(SERVER + "/api/decks/" + d.id);
        showDeck(await r.json());
        preview.scrollIntoView({ behavior: "smooth" });
      }));

      buttons.appendChild(makeButton("Download", async () => {
        const r = await fetch(SERVER + "/api/decks/" + d.id);
        downloadDeck(await r.json());
      }));

      buttons.appendChild(makeButton("Delete", async () => {
        if (!confirm(`Delete "${d.name}" from the server?`)) return;
        await fetch(SERVER + "/api/decks/" + d.id, { method: "DELETE" });
        loadSavedDecks();
      }));

      row.appendChild(buttons);
      savedList.appendChild(row);
    });
  } catch (err) {
    savedMsg.textContent = "Could not reach the server. Is it running?";
  }
}

// ---------- Automatic: ask our server, which asks the AI ----------
generateBtn.addEventListener("click", async () => {
  const name = document.getElementById("deckName").value.trim();
  const notes = document.getElementById("notes").value.trim();

  if (!notes) {
    genMsg.textContent = "Paste your notes first.";
    return;
  }

  generateBtn.disabled = true;
  genMsg.textContent = "Making your deck... this takes a few seconds.";
  preview.innerHTML = "";

  try {
    const response = await fetch(SERVER + "/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, notes })
    });
    const data = await response.json();

    if (!response.ok) {
      genMsg.textContent = data.error || "Something went wrong.";
    } else {
      genMsg.textContent = "Deck ready and saved.";
      showDeck(data);
      loadSavedDecks();
    }
  } catch (err) {
    genMsg.textContent = "Could not reach the server. Is it running?";
  }
  generateBtn.disabled = false;
});

// ---------- Backup: copy a prompt, paste the AI's answer ----------
copyPromptBtn.addEventListener("click", async () => {
  const name = document.getElementById("deckName").value.trim();
  const notes = document.getElementById("notes").value.trim();

  if (!notes) {
    copyMsg.textContent = "Paste your notes first.";
    return;
  }

  try {
    await navigator.clipboard.writeText(buildPrompt(name, notes));
    copyMsg.textContent = "Prompt copied! Paste it into an AI chat.";
  } catch (err) {
    copyMsg.textContent = "Could not copy. Try again.";
  }
});

loadDeckBtn.addEventListener("click", async () => {
  const text = document.getElementById("aiReply").value;
  const result = parseDeck(text);

  if (result.error) {
    loadMsg.textContent = result.error;
    preview.innerHTML = "";
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
    loadMsg.textContent = response.ok ? "Deck loaded and saved." : "Deck loaded (not saved on the server).";
    loadSavedDecks();
  } catch (err) {
    loadMsg.textContent = "Deck loaded (server not reachable, so not saved).";
  }
});

// ---------- Download the deck as a .json file ----------
downloadBtn.addEventListener("click", () => {
  if (currentDeck) downloadDeck(currentDeck);
});

// Show the saved decks when the page opens
loadSavedDecks();