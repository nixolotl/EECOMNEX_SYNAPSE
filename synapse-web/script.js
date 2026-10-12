const generateBtn = document.getElementById("generateBtn");
const preview = document.getElementById("preview");

// Fake AI for now. In Step 3 this becomes a real AI call.
function makeFakeDeck(name) {
  return {
    name: name || "My Deck",
    cards: [
      {
        q: "What does Ohm's law state?",
        a: "V = I x R",
        w: ["V = I / R", "P = V x I", "R = V x I"]
      },
      {
        q: "What is the unit of resistance?",
        a: "Ohm",
        w: ["Farad", "Henry", "Volt"]
      }
    ]
  };
}

function showDeck(deck) {
  preview.innerHTML = `<h2>${deck.name} (${deck.cards.length} cards)</h2>`;
  deck.cards.forEach((c) => {
    preview.innerHTML += `
      <div class="card">
        <div class="q">${c.q}</div>
        <div class="a">Answer: ${c.a}</div>
        <div class="w">Wrong: ${c.w.join(" | ")}</div>
      </div>`;
  });
}

generateBtn.addEventListener("click", () => {
  const name = document.getElementById("deckName").value;
  showDeck(makeFakeDeck(name));
});