'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#64b5f6', // J - pale blue
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggleBtn = document.getElementById('theme-toggle');
const nameEntry = document.getElementById('name-entry');
const nameInput = document.getElementById('name-input');
const nameSubmitBtn = document.getElementById('name-submit-btn');
const recordsTableGameOver = document.getElementById('records-table-gameover');
const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const recordsTableStart = document.getElementById('records-table-start');
const bestComboStartEl = document.getElementById('best-combo-start');
const maxLinesStartEl = document.getElementById('max-lines-start');
const resetRecordsBtn = document.getElementById('reset-records-btn');
const comboEl = document.getElementById('combo');

const THEME_KEY = 'tetris-theme';
let gridColor, blockHighlight;

function readThemeColors() {
  const styles = getComputedStyle(document.documentElement);
  gridColor = styles.getPropertyValue('--grid-color').trim();
  blockHighlight = styles.getPropertyValue('--block-highlight').trim();
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  themeToggleBtn.textContent = theme === 'light' ? '☀️' : '🌙';
  localStorage.setItem(THEME_KEY, theme);
  readThemeColors();
  if (board) {
    draw();
    drawNext();
  }
}

themeToggleBtn.addEventListener('click', () => {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  applyTheme(isLight ? 'dark' : 'light');
});

applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

// ---- Records (localStorage) ----
const RECORDS_KEY = 'tetris-records';
const DEFAULT_RECORDS = { topScores: [], bestCombo: 0, maxLines: 0 };

function loadRecords() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECORDS_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_RECORDS, topScores: [] };
    return {
      topScores: Array.isArray(raw.topScores) ? raw.topScores : [],
      bestCombo: Number(raw.bestCombo) || 0,
      maxLines: Number(raw.maxLines) || 0,
    };
  } catch {
    return { ...DEFAULT_RECORDS, topScores: [] };
  }
}

function saveRecords(records) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    // localStorage unavailable/full (e.g. private browsing) — fail silently,
    // the in-memory records object still reflects this session's state.
  }
}

const MAX_RECORDS = 5;

function qualifiesForTopScores(records, points) {
  return records.topScores.length < MAX_RECORDS || points > records.topScores[records.topScores.length - 1].score;
}

function addTopScore(records, name, points) {
  const entry = { name, score: points, date: new Date().toISOString() };
  records.topScores.push(entry);
  records.topScores.sort((a, b) => b.score - a.score);
  records.topScores = records.topScores.slice(0, MAX_RECORDS);
  saveRecords(records);
  return records.topScores.indexOf(entry);
}

function renderRecordsTable(container, highlightIndex) {
  const records = loadRecords();
  container.innerHTML = '';
  if (records.topScores.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'records-empty';
    empty.textContent = 'Sin récords todavía';
    container.appendChild(empty);
    return;
  }
  const table = document.createElement('table');
  table.className = 'records-table';
  records.topScores.forEach((entry, i) => {
    const row = document.createElement('tr');
    if (i === highlightIndex) row.classList.add('records-highlight');
    const posCell = document.createElement('td');
    posCell.textContent = `${i + 1}.`;
    const nameCell = document.createElement('td');
    nameCell.textContent = entry.name;
    const scoreCell = document.createElement('td');
    scoreCell.textContent = entry.score.toLocaleString();
    row.appendChild(posCell);
    row.appendChild(nameCell);
    row.appendChild(scoreCell);
    table.appendChild(row);
  });
  container.appendChild(table);
}

function renderStartScreenStats() {
  const records = loadRecords();
  renderRecordsTable(recordsTableStart);
  bestComboStartEl.textContent = records.bestCombo;
  maxLinesStartEl.textContent = records.maxLines;
}

resetRecordsBtn.addEventListener('click', () => {
  localStorage.removeItem(RECORDS_KEY);
  renderStartScreenStats();
  renderRecordsTable(recordsTableGameOver);
});

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let currentCombo, maxComboThisGame;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    currentCombo++;
    if (currentCombo > maxComboThisGame) maxComboThisGame = currentCombo;
    updateHUD();
  } else {
    currentCombo = 0;
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  if (comboEl) comboEl.textContent = currentCombo;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = blockHighlight;
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

// Tracks the currently-attached name-entry listeners so they can always be
// detached before a new pair is attached (or when the player abandons the
// prompt via restart), preventing stale closures from stacking up.
let pendingNameHandlers = null;

function detachNameHandlers() {
  if (!pendingNameHandlers) return;
  nameSubmitBtn.removeEventListener('click', pendingNameHandlers.confirmName);
  nameInput.removeEventListener('keydown', pendingNameHandlers.onKeydown);
  pendingNameHandlers = null;
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
  detachNameHandlers();

  const records = loadRecords();
  let changed = false;
  if (maxComboThisGame > records.bestCombo) {
    records.bestCombo = maxComboThisGame;
    changed = true;
  }
  if (lines > records.maxLines) {
    records.maxLines = lines;
    changed = true;
  }
  if (changed) saveRecords(records);

  if (qualifiesForTopScores(records, score) && score > 0) {
    nameEntry.classList.remove('hidden');
    recordsTableGameOver.classList.add('hidden');
    nameInput.value = '';
    setTimeout(() => nameInput.focus(), 0);

    const confirmName = () => {
      const name = nameInput.value.trim() || 'Jugador';
      const idx = addTopScore(records, name, score);
      nameEntry.classList.add('hidden');
      recordsTableGameOver.classList.remove('hidden');
      renderRecordsTable(recordsTableGameOver, idx);
      detachNameHandlers();
    };
    const onKeydown = e => {
      if (e.code === 'Enter') confirmName();
    };
    pendingNameHandlers = { confirmName, onKeydown };
    nameSubmitBtn.addEventListener('click', confirmName);
    nameInput.addEventListener('keydown', onKeydown);
  } else {
    nameEntry.classList.add('hidden');
    recordsTableGameOver.classList.remove('hidden');
    renderRecordsTable(recordsTableGameOver);
  }
}

function togglePause() {
  if (!board || gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    nameEntry.classList.add('hidden');
    recordsTableGameOver.classList.add('hidden');
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  currentCombo = 0;
  maxComboThisGame = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  nameEntry.classList.add('hidden');
  detachNameHandlers();
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (!board || paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

startBtn.addEventListener('click', () => {
  startScreen.classList.add('hidden');
  init();
});

renderStartScreenStats();
startScreen.classList.remove('hidden');
