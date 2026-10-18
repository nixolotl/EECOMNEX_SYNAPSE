// ============================================================
//  model.js - the prediction model for Synapse (no libraries needed)
//
//  Question the model answers for every card:
//     "If we show this card now, will the student get it right?"
//
//  It is a logistic regression with 4 inputs (all between 0 and 1):
//     accuracy  = correct / seen             how often the card was right so far
//     gap       = min(sessions since seen, 5) / 5
//     lastWrong = 1 if the previous answer was wrong, else 0
//     streak    = min(right answers in a row, 5) / 5
//
//     z = b0 + b1*accuracy + b2*gap + b3*lastWrong + b4*streak
//     P(correct) = 1 / (1 + e^-z)          forget-risk = 1 - P(correct)
//
//  The same 4 inputs are used on the device (Stage 5), so the learned
//  weights can be copied straight into the firmware.
// ============================================================

const FEATURE_NAMES = ["accuracy", "gap", "lastWrong", "streak"];
const GAP_CAP = 5;
const STREAK_CAP = 5;
const MIN_ROWS_TO_TRAIN = 50;

// The hand-made weights currently inside the firmware (Stage 2)
const HAND_WEIGHTS = { accuracy: 0.6, gap: 0.3, lastWrong: 0.1 };

// ---------------- small helpers ----------------
function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

// A seeded random generator, so the same seed gives the same simulation
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A random number with a bell-curve shape (mean 0, spread 1)
function gauss(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// ---------------- the 4 inputs of one answer ----------------
// row = { seen, correct, streak, lastWrong, gap, result }
function features(r) {
  return [
    r.correct / r.seen,
    Math.min(r.gap, GAP_CAP) / GAP_CAP,
    r.lastWrong ? 1 : 0,
    Math.min(r.streak, STREAK_CAP) / STREAK_CAP
  ];
}

// w = [b0, b1, b2, b3, b4]
function predict(w, x) {
  let z = w[0];
  for (let i = 0; i < x.length; i++) z += w[i + 1] * x[i];
  return sigmoid(z);
}

// ---------------- simulated students ----------------
// Each simulated student forgets following a simple forgetting curve:
//   - every card has a "memory strength" S (measured in sessions)
//   - chance of a right answer = 0.25 + 0.75 * e^(-gap / S)   (0.25 = lucky guess of 4 choices)
//   - a right answer makes S bigger (x1.7), a wrong one makes it smaller (x0.65)
// Better students and easier cards start with a bigger S.
// The rows have the same shape as the rows the device sends.
function simulate(opts) {
  const students = Math.max(1, Math.min(opts.students || 40, 200));
  const cards = opts.cards || 12;
  const sessions = opts.sessions || 12;
  const rng = makeRng(opts.seed || 1);
  const rows = [];

  for (let s = 0; s < students; s++) {
    const ability = gauss(rng) * 0.5;
    const state = [];
    for (let c = 0; c < cards; c++) {
      const difficulty = gauss(rng) * 0.7;
      const strength = Math.min(6, Math.max(0.3, 1.2 * Math.exp(ability - difficulty)));
      state.push({ seen: 0, correct: 0, streak: 0, lastWrong: 0, last: 0, S: strength, first: sigmoid(ability - difficulty) });
    }
    for (let t = 1; t <= sessions; t++) {
      for (let c = 0; c < cards; c++) {
        if (rng() > 0.75) continue;                  // not every card is studied every session
        const st = state[c];
        const gap = st.seen > 0 ? t - st.last : 0;
        const p = st.seen > 0
          ? 0.25 + 0.75 * Math.exp(-gap / st.S)
          : 0.25 + 0.75 * st.first;
        const right = rng() < p;

        rows.push({
          card: c, seen: st.seen, correct: st.correct, streak: st.streak,
          lastWrong: st.lastWrong, gap: Math.min(gap, 255), result: right ? 1 : 0
        });

        st.seen++;
        if (right) { st.correct++; st.streak++; st.lastWrong = 0; st.S = Math.min(st.S * 1.7, 40); }
        else { st.streak = 0; st.lastWrong = 1; st.S = Math.max(st.S * 0.65, 0.3); }
        st.last = t;
      }
    }
  }
  return rows;
}

// ---------------- training ----------------
// Plain gradient descent on the log-loss (with a very small L2 penalty).
function fit(X, y) {
  const n = X.length, d = X[0].length;
  const w = new Array(d + 1).fill(0);
  const lr = 1.0, lambda = 0.001, epochs = 4000;
  for (let e = 0; e < epochs; e++) {
    const g = new Array(d + 1).fill(0);
    for (let i = 0; i < n; i++) {
      const err = predict(w, X[i]) - y[i];
      g[0] += err;
      for (let j = 0; j < d; j++) g[j + 1] += err * X[i][j];
    }
    w[0] -= lr * g[0] / n;
    for (let j = 1; j <= d; j++) w[j] -= lr * (g[j] / n + lambda * w[j]);
  }
  return w;
}

// Area under the ROC curve: "if I pick one positive and one negative at random,
// how often does the positive get the higher score?"  0.5 = coin flip, 1 = perfect.
function auc(scores, labels) {
  const idx = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
  const ranks = new Array(scores.length);
  for (let i = 0; i < idx.length;) {                // average the ranks of ties
    let j = i;
    while (j + 1 < idx.length && scores[idx[j + 1]] === scores[idx[i]]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]] = r;
    i = j + 1;
  }
  let pos = 0, sumRanks = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === 1) { pos++; sumRanks += ranks[i]; }
  }
  const neg = labels.length - pos;
  if (pos === 0 || neg === 0) return null;
  return (sumRanks - pos * (pos + 1) / 2) / (pos * neg);
}

// Trains on the given rows and tests on rows it has never seen.
// Returns everything the page needs to show.
function train(allRows, opts) {
  opts = opts || {};
  const usable = allRows.filter((r) => r.seen > 0 && r.correct <= r.seen);
  const skipped = allRows.length - usable.length;   // first-time answers have no history
  if (usable.length < MIN_ROWS_TO_TRAIN) {
    const err = new Error(
      `Not enough answers to train: need at least ${MIN_ROWS_TO_TRAIN} that have history, have ${usable.length}. ` +
      `Generate simulated students first.`
    );
    err.status = 400;
    throw err;
  }

  // shuffle with a fixed seed, then 80% to learn from and 20% to test on
  const rng = makeRng(opts.seed || 7);
  const rows = usable.slice();
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  const cut = Math.floor(rows.length * 0.8);
  const trainRows = rows.slice(0, cut);
  const testRows = rows.slice(cut);

  const w = fit(trainRows.map(features), trainRows.map((r) => r.result));

  // --- how good is it on the test rows? ---
  const Xt = testRows.map(features);
  const yt = testRows.map((r) => r.result);
  const p = Xt.map((x) => predict(w, x));

  let right = 0, loss = 0;
  for (let i = 0; i < p.length; i++) {
    if ((p[i] >= 0.5 ? 1 : 0) === yt[i]) right++;
    const q = Math.min(Math.max(p[i], 1e-9), 1 - 1e-9);
    loss += -(yt[i] * Math.log(q) + (1 - yt[i]) * Math.log(1 - q));
  }
  const trainRate = trainRows.reduce((a, r) => a + r.result, 0) / trainRows.length;
  const baselineGuess = trainRate >= 0.5 ? 1 : 0;       // "always say the usual answer"
  const baselineRight = yt.filter((v) => v === baselineGuess).length;

  // predicting a WRONG answer: learned score = 1 - P(correct); hand formula = its risk
  const wrongLabels = yt.map((v) => 1 - v);
  const learnedAuc = auc(p.map((v) => 1 - v), wrongLabels);
  const handScores = testRows.map((r) =>
    HAND_WEIGHTS.accuracy * (1 - r.correct / r.seen) +
    HAND_WEIGHTS.gap * Math.min(r.gap, GAP_CAP) / GAP_CAP +
    HAND_WEIGHTS.lastWrong * (r.lastWrong ? 1 : 0)
  );
  const handAuc = auc(handScores, wrongLabels);

  const round = (v, k) => (v == null ? null : Math.round(v * 10 ** k) / 10 ** k);
  return {
    weights: {
      b0: round(w[0], 4), accuracy: round(w[1], 4), gap: round(w[2], 4),
      lastWrong: round(w[3], 4), streak: round(w[4], 4)
    },
    w: w.map((v) => round(v, 6)),
    metrics: {
      testRows: testRows.length,
      accuracy: round(right / testRows.length, 4),
      baselineAccuracy: round(baselineRight / testRows.length, 4),
      auc: round(learnedAuc, 4),
      handFormulaAuc: round(handAuc, 4),
      logLoss: round(loss / testRows.length, 4)
    },
    rows: {
      used: usable.length, train: trainRows.length, test: testRows.length,
      skippedFirstTime: skipped, rightRate: round(trainRate, 4)
    }
  };
}

module.exports = { FEATURE_NAMES, features, predict, simulate, train, auc, MIN_ROWS_TO_TRAIN };