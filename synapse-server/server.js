const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// The page will send notes here
app.post("/api/generate", (req, res) => {
  const { name, notes } = req.body;
  console.log("Got notes with", notes.length, "characters");

  // Fake answer for now. Part 2 replaces this with the real AI.
  res.json({
    name: name || "My Deck",
    cards: [
      {
        q: "The server received " + notes.length + " characters of notes",
        a: "It works",
        w: ["It failed", "Nothing", "Unknown"]
      }
    ]
  });
});

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});