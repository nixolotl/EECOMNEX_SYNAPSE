const copyPromptBtn = document.getElementById("copyPromptBtn");
const loadDeckBtn = document.getElementById("loadDeckBtn");
const copyMsg = document.getElementById("copyMsg");
const loadMsg = document.getElementById("loadMsg");
const preview = document.getElementById("preview");

// Builds the instructions we send to the AI.
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

// Turns the AI's text into a deck, or returns an error message.
function parseDeck(text) {
  // Remove ```json fences in case the AI added them
  let clean = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  // Keep only the part from the first { to the last }
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end !== -1) clean = clean.slice(start, end + 1);

  // Fix line breaks and curly quotes that copying can add
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

function addLine(parent, className, text) {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;   // textContent keeps pasted text safe
  parent.appendChild(div);
}

function showDeck(deck) {
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

loadDeckBtn.addEventListener("click", () => {
  const text = document.getElementById("aiReply").value;
  const result = parseDeck(text);

  if (result.error) {
    loadMsg.textContent = result.error;
    preview.innerHTML = "";
    return;
  }
  loadMsg.textContent = "Deck loaded.";
  showDeck(result.deck);
});
const generateBtn = document.getElementById("generateBtn");
const genMsg = document.getElementById("genMsg");

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
    const response = await fetch("http://localhost:3000/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, notes })
    });
    const data = await response.json();

    if (!response.ok) {
      genMsg.textContent = data.error || "Something went wrong.";
    } else {
      genMsg.textContent = "Deck ready.";
      showDeck(data);
    }
  } catch (err) {
    genMsg.textContent = "Could not reach the server. Is it running?";
  }
  generateBtn.disabled = false;
});