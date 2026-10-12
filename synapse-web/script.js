const generateBtn = document.getElementById("generateBtn");
const preview = document.getElementById("preview");

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

generateBtn.addEventListener("click", async () => {
  const name = document.getElementById("deckName").value;
  const notes = document.getElementById("notes").value;

  generateBtn.textContent = "Generating...";
  try {
    const response = await fetch("http://localhost:3000/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, notes })
    });
    const deck = await response.json();
    showDeck(deck);
  } catch (err) {
    preview.innerHTML = "<p>Could not reach the server. Is it running?</p>";
  }
  generateBtn.textContent = "Generate deck";
});