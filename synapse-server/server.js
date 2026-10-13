const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));

const MODEL = "gemini-3.1-flash-lite";
const API_KEY = process.env.GEMINI_API_KEY;

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

// Turns the AI's text into a checked deck, or throws an error
function readDeck(text, name) {
  let clean = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end !== -1) clean = clean.slice(start, end + 1);

  const deck = JSON.parse(clean);
  if (!Array.isArray(deck.cards) || deck.cards.length === 0) {
    throw new Error("The AI did not return any cards.");
  }
  deck.cards = deck.cards.filter(
    (c) => c.q && c.a && Array.isArray(c.w) && c.w.length === 3
  );
  if (deck.cards.length === 0) throw new Error("The cards had the wrong shape.");
  deck.name = name || deck.name || "My Deck";
  return deck;
}

app.post("/api/generate", async (req, res) => {
  const name = (req.body.name || "").trim();
  const notes = (req.body.notes || "").trim();

  if (!API_KEY) return res.status(500).json({ error: "Server has no API key. Check .env." });
  if (!notes) return res.status(400).json({ error: "Paste your notes first." });
  if (notes.length > 8000) return res.status(400).json({ error: "Notes are too long. Keep them under 8000 characters." });

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(name, notes) }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("AI error:", data);
      return res.status(502).json({ error: data.error?.message || "The AI request failed." });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    res.json(readDeck(text, name));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not make a deck: " + err.message });
  }
});

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});