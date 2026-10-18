const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const model = require("./model.js");   // NEW (Stage 4): simulation + training

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));

const MODEL = "gemini-3.1-flash-lite";
const API_KEY = process.env.GEMINI_API_KEY;

const MAX_CARDS = 20;      // most cards one deck can hold (the device reads 20)
const MORE_CARDS = 5;      // how many new cards one "more" request asks for
const COOLDOWN_MS = 3000;  // wait between "more" requests (protects the free AI limit)
const DB_FILE = path.join(__dirname, "decks.json");
const REVIEWS_FILE = path.join(__dirname, "reviews.json");   // NEW (Stage 3): answers sent by the device
const MAX_REVIEWS = 20000;   // keep the newest 20000 answers
const MAX_PER_REQUEST = 200; // answers accepted in one request
const MODEL_FILE = path.join(__dirname, "model.json");       // NEW (Stage 4): the last trained model

let lastMoreAt = 0;

// ---------------- Saved decks (a simple file: decks.json) ----------------
function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    return {};   // no file yet
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// "Computer Basics!" -> "computer-basics"
function makeId(name) {
  const id = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (id || "deck").slice(0, 40);
}

// Saves a deck. A deck with the same name is replaced.
function saveDeck(name, notes, cards) {
  const db = loadDb();
  const id = makeId(name);
  db[id] = { id, name, notes: notes || "", cards, updated: new Date().toISOString() };
  saveDb(db);
  return db[id];
}

// ---------------- Saved answers (a simple file: reviews.json) ----------------
// One row = one answer the student gave, with the card's history BEFORE it:
//   card, seen, correct, streak, lastWrong, gap (sessions since last seen), result (1 right / 0 wrong)
function loadReviews() {
  try {
    const list = JSON.parse(fs.readFileSync(REVIEWS_FILE, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];   // no file yet
  }
}

function saveReviews(list) {
  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(list));   // compact on purpose, the file can get big
}

// Checks one answer sent as [card, seen, correct, streak, lastWrong, gap, result]
function parseReview(e) {
  if (!Array.isArray(e) || e.length !== 7) return null;
  const n = e.map((x) => Number(x));
  if (n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  const [card, seen, correct, streak, lastWrong, gap, result] = n;
  if (correct > seen) return null;          // cannot be right more often than it was seen
  if (lastWrong > 1 || result > 1) return null;
  return { card, seen, correct, streak, lastWrong, gap, result };
}

// ---------------- Card cleaning ----------------
// Keeps plain keyboard characters and the lengths the device screen can show.
function clean(s, max) {
  return String(s == null ? "" : s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, max);
}

function cleanCards(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const c of list) {
    if (!c || !Array.isArray(c.w) || c.w.length !== 3) continue;
    const card = {
      q: clean(c.q, 60),
      a: clean(c.a, 18),
      w: c.w.map((x) => clean(x, 18))
    };
    if (!card.q || !card.a || card.w.some((x) => !x)) continue;
    out.push(card);
  }
  return out;
}

// ---------------- Prompts ----------------
const RULES = `Rules:
- "q" is the question, maximum 60 characters.
- "a" is the correct answer, maximum 18 characters.
- "w" is exactly 3 wrong answers that sound believable, each maximum 18 characters.
- Use plain keyboard characters only. Write x for multiplication, / for division, and spell out symbols.
- Reply with JSON only. No explanation and no code fences.`;

function buildPrompt(name, notes) {
  return `You are making a flashcard deck for a small handheld study device.

Deck name: ${name || "My Deck"}

Read the notes below and create 5 to 8 multiple-choice flashcards from them.

Use ONLY facts from the notes.
${RULES}

Use exactly this shape:
{"name":"${name || "My Deck"}","cards":[{"q":"","a":"","w":["","",""]}]}

NOTES:
${notes}`;
}

function buildMorePrompt(deck, want) {
  const asked = deck.cards.map((c) => "- " + c.q).join("\n");
  let source;
  if (deck.notes) {
    source = `Use ONLY facts from these notes:\n${deck.notes}`;
  } else {
    const known = deck.cards.map((c) => `${c.q} -> ${c.a}`).join("\n");
    source = `There are no notes. Stay on the same topic as these existing cards:\n${known}`;
  }
  return `You are adding flashcards to a deck for a small handheld study device.

Deck name: ${deck.name}

Create exactly ${want} NEW multiple-choice flashcards.
Do not repeat or reword any of these questions that already exist:
${asked}

${source}

${RULES}

Use exactly this shape:
{"cards":[{"q":"","a":"","w":["","",""]}]}`;
}

// ---------------- Talking to Gemini ----------------
async function askGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("AI error:", data);
    const err = new Error(data.error?.message || "The AI request failed.");
    err.status = 502;
    throw err;
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

function parseAiJson(text) {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

function sendError(res, err) {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Something went wrong." });
}

// ---------------- Routes ----------------

// Quick check that the server is running
app.get("/api/ping", (req, res) => res.json({ ok: true }));

// Make a new deck from notes, and save it
app.post("/api/generate", async (req, res) => {
  const name = (req.body.name || "").trim();
  const notes = (req.body.notes || "").trim();

  if (!API_KEY) return res.status(500).json({ error: "Server has no API key. Check .env." });
  if (!notes) return res.status(400).json({ error: "Paste your notes first." });
  if (notes.length > 8000) return res.status(400).json({ error: "Notes are too long. Keep them under 8000 characters." });

  try {
    const text = await askGemini(buildPrompt(name, notes));
    const parsed = parseAiJson(text);
    const cards = cleanCards(parsed.cards).slice(0, MAX_CARDS);
    if (cards.length === 0) throw new Error("The AI did not return usable cards. Try again.");

    const deck = saveDeck(name || parsed.name || "My Deck", notes, cards);
    res.json({ name: deck.name, cards: deck.cards });
  } catch (err) {
    sendError(res, err);
  }
});

// List of saved decks (small, so the device can use it too)
app.get("/api/decks", (req, res) => {
  const db = loadDb();
  const list = Object.values(db).map((d) => ({ id: d.id, name: d.name, cards: d.cards.length }));
  res.json(list);
});

// One deck, in the same shape as the deck file (now with its id)
app.get("/api/decks/:id", (req, res) => {
  const deck = loadDb()[req.params.id];
  if (!deck) return res.status(404).json({ error: "Deck not found." });
  res.json({ id: deck.id, name: deck.name, cards: deck.cards });
});

// Save a deck that was pasted in (no notes)
app.post("/api/decks", (req, res) => {
  const name = clean(req.body.name || "My Deck", 23) || "My Deck";
  const cards = cleanCards(req.body.cards).slice(0, MAX_CARDS);
  if (cards.length === 0) return res.status(400).json({ error: "No usable cards." });
  const deck = saveDeck(name, "", cards);
  res.json({ id: deck.id, name: deck.name, cards: deck.cards.length });
});

// Make more cards for a saved deck
app.post("/api/decks/:id/more", async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: "Server has no API key. Check .env." });

  const db = loadDb();
  const deck = db[req.params.id];
  if (!deck) return res.status(404).json({ error: "Deck not found." });

  const room = MAX_CARDS - deck.cards.length;
  if (room <= 0) return res.status(400).json({ error: `Deck is full (${MAX_CARDS} cards).` });

  if (Date.now() - lastMoreAt < COOLDOWN_MS) {
    return res.status(429).json({ error: "Please wait a few seconds and try again." });
  }
  lastMoreAt = Date.now();

  try {
    const want = Math.min(MORE_CARDS, room);
    const text = await askGemini(buildMorePrompt(deck, want));
    const parsed = parseAiJson(text);

    // drop any question we already have
    const have = new Set(deck.cards.map((c) => c.q.toLowerCase()));
    const fresh = cleanCards(parsed.cards)
      .filter((c) => !have.has(c.q.toLowerCase()))
      .slice(0, want);
    if (fresh.length === 0) throw new Error("The AI gave no new cards. Try again.");

    deck.cards.push(...fresh);
    deck.updated = new Date().toISOString();
    saveDb(db);
    res.json({ name: deck.name, cards: fresh, total: deck.cards.length });
  } catch (err) {
    sendError(res, err);
  }
});

// Delete a saved deck
app.delete("/api/decks/:id", (req, res) => {
  const db = loadDb();
  if (!db[req.params.id]) return res.status(404).json({ error: "Deck not found." });
  delete db[req.params.id];
  saveDb(db);
  res.json({ ok: true });
});

// ---------------- Answers from the device (Stage 3) ----------------

// The device sends its answers here when you press Sync Decks.
// Body: { "source": "device", "events": [[card, seen, correct, streak, lastWrong, gap, result], ...] }
app.post("/api/log", (req, res) => {
  const events = req.body && req.body.events;
  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: "No events sent." });
  }
  if (events.length > MAX_PER_REQUEST) {
    return res.status(400).json({ error: `Send at most ${MAX_PER_REQUEST} answers at a time.` });
  }

  const source = req.body.source === "sim" ? "sim" : "device";
  const at = new Date().toISOString();
  const rows = [];
  for (const e of events) {
    const row = parseReview(e);
    if (!row) return res.status(400).json({ error: "Bad answer in the list. Nothing was saved." });
    rows.push({ ...row, source, at });
  }

  let all = loadReviews().concat(rows);
  if (all.length > MAX_REVIEWS) all = all.slice(all.length - MAX_REVIEWS);
  saveReviews(all);

  console.log(`Saved ${rows.length} answers from the ${source} (total ${all.length})`);
  res.json({ saved: rows.length, total: all.length });
});

// A quick look at what has arrived (open http://localhost:3000/api/log/summary)
app.get("/api/log/summary", (req, res) => {
  const all = loadReviews();
  const count = (src) => all.filter((r) => r.source === src).length;
  const right = all.filter((r) => r.result === 1).length;
  res.json({
    total: all.length,
    fromDevice: count("device"),
    simulated: count("sim"),
    answeredRight: right,
    answeredWrong: all.length - right,
    lastReceived: all.length ? all[all.length - 1].at : null
  });
});

// All answers (the website's training page reads this in Stage 4)
app.get("/api/log", (req, res) => {
  res.json(loadReviews());
});

// Forget all saved answers (for testing)
app.delete("/api/log", (req, res) => {
  saveReviews([]);
  res.json({ ok: true });
});

// ---------------- Prediction model (Stage 4) ----------------

// The training page. Open http://localhost:3000/train
app.get("/train", (req, res) => {
  res.sendFile(path.join(__dirname, "train.html"));
});

// Makes simulated students and saves their answers (marked "sim").
// Old simulated answers are replaced. Real answers from the device are never touched.
// Body: { "students": 40 }
app.post("/api/sim/generate", (req, res) => {
  const students = Math.max(5, Math.min(parseInt(req.body && req.body.students, 10) || 40, 200));
  const rows = model.simulate({ students, seed: Math.floor(Math.random() * 1e9) });
  const at = new Date().toISOString();
  const simRows = rows.map((r) => ({
    card: r.card, seen: r.seen, correct: r.correct, streak: r.streak,
    lastWrong: r.lastWrong, gap: r.gap, result: r.result, source: "sim", at
  }));

  const real = loadReviews().filter((r) => r.source !== "sim");
  let all = simRows.concat(real);
  if (all.length > MAX_REVIEWS) all = all.slice(all.length - MAX_REVIEWS);
  saveReviews(all);

  console.log(`Generated ${simRows.length} simulated answers from ${students} students`);
  res.json({ generated: simRows.length, students, total: all.length });
});

// Removes all simulated answers
app.delete("/api/sim", (req, res) => {
  const real = loadReviews().filter((r) => r.source !== "sim");
  saveReviews(real);
  res.json({ ok: true, total: real.length });
});

// Trains the model and saves it. Body: { "source": "all" | "sim" | "device" }
app.post("/api/model/train", (req, res) => {
  const source = ["all", "sim", "device"].includes(req.body && req.body.source) ? req.body.source : "all";
  const rows = loadReviews().filter((r) => source === "all" || r.source === source);

  try {
    const result = model.train(rows, { seed: 7 });
    const usedSim = rows.some((r) => r.source === "sim");
    const usedDevice = rows.some((r) => r.source === "device");
    const saved = {
      trained: true,
      trainedAt: new Date().toISOString(),
      source,
      data: { simulated: usedSim, device: usedDevice, answers: rows.length },
      features: model.FEATURE_NAMES,
      ...result
    };
    fs.writeFileSync(MODEL_FILE, JSON.stringify(saved, null, 2));
    console.log(`Trained on ${result.rows.used} answers (${source}). AUC ${result.metrics.auc}`);
    res.json(saved);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });   // a normal mistake, no stack trace
    sendError(res, err);
  }
});

// The last trained model (or { trained: false } if none yet)
app.get("/api/model", (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(MODEL_FILE, "utf8")));
  } catch (e) {
    res.json({ trained: false });
  }
});

// NEW (Stage 5): just the 5 weights, small enough for the ESP32 to download.
// w = [b0, accuracy, gap, lastWrong, streak]. 404 when no model has been trained yet.
app.get("/api/model/device", (req, res) => {
  try {
    const m = JSON.parse(fs.readFileSync(MODEL_FILE, "utf8"));
    if (!m.trained || !Array.isArray(m.w) || m.w.length !== 5 || m.w.some((v) => !Number.isFinite(v))) {
      throw new Error("no usable model");
    }
    res.json({ w: m.w, trainedAt: m.trainedAt });
  } catch (e) {
    res.status(404).json({ error: "No trained model yet. Open /train and train one." });
  }
});

// "0.0.0.0" lets other devices on the Wi-Fi (the ESP32) reach this server
app.listen(3000, "0.0.0.0", () => {
  console.log("Server running at http://localhost:3000");
});