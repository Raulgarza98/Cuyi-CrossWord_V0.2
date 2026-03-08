/**
 * Crossword game module.
 * Renders the grid, handles input, tracks time, and checks answers.
 */

let puzzleData = null;
let gridState = [];       // 2D array of entered letters (empty string = unfilled)
let selectedRow = -1;
let selectedCol = -1;
let direction = "across"; // "across" or "down"
let timerStarted = false;
let timerInterval = null;
let startTime = null;
let accumulatedSeconds = 0;
let completed = false;
let clueSequence = [];
let currentClueIndex = 0;

let currentUserId = null;
let currentPuzzleDate = null;

// Callback that will be set by main.js when the puzzle is solved
let onComplete = null;

function isTouchDevice() {
  return (
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0
  );
}

export function setOnComplete(callback) {
  onComplete = callback;
}

export function getGridState() {
  return gridState;
}

export function startTimer() {
  if (completed) return;
  if (timerInterval) return;  // Interval already running

  timerStarted = true;
  startTime = Date.now();
  timerInterval = setInterval(updateTimer, 100);
}

export function cleanup() {
  // Stop the timer interval
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // Accumulate the time from this session into the base
  if (timerStarted && startTime) {
    const sessionSeconds = (Date.now() - startTime) / 1000;
    accumulatedSeconds += sessionSeconds;
    startTime = null;
  }

  // Remove the keyboard listener
  document.removeEventListener("keydown", handleKeyDown);

  // Return the current state so main.js can save it
  return {
    gridState: gridState,
    elapsedSeconds: accumulatedSeconds,
    completed: completed,
  };
}

export function resetState() {
  puzzleData = null;
  gridState = [];
  selectedRow = -1;
  selectedCol = -1;
  direction = "across";
  timerStarted = false;
  timerInterval = null;
  startTime = null;
  completed = false;
  clueSequence = [];
  currentClueIndex = 0;
  accumulatedSeconds = 0;
  currentUserId = null;
  currentPuzzleDate = null;
  onComplete = null;
}

export async function initCrossword(containerId, savedProgress = null, userId = null, puzzleDate = null) {
    currentUserId = userId;
    currentPuzzleDate = puzzleDate;
    // Fetch puzzle data from the backend
    const response = await fetch("/api/puzzle/today");
    if (!response.ok) {
        throw new Error(`Failed to fetch puzzle: ${response.status}`);
    }
    puzzleData = await response.json();

    const { rows, columns } = puzzleData.dimensions;

    // Initialize empty grid state
    gridState = [];
    for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < columns; c++) {
        row.push("");
        }
        gridState.push(row);
    }

    

    // Render the UI
    const container = document.getElementById(containerId);
    container.innerHTML = `
        <div id="crossword-header">
          <button id="back-button" aria-label="Volver">&lt; Volver</button>
          <h1>Mini Crossword</h1>
        </div>
        <div id="timer">0:00</div>
        <div id="crossword-grid"></div>
        <div id="current-clue"></div>
        <div id="clue-carousel">
        <button id="clue-prev" aria-label="Previous clue">&lt;</button>
        <div id="clue-display">
            <span id="clue-prefix"></span>
            <span id="clue-text"></span>
        </div>
        <button id="clue-next" aria-label="Next clue">&gt;</button>
        </div>
        <div id="completion-message"></div>
    `;

    

    // Build clueSequence
        clueSequence = [
        ...puzzleData.clues.across
            .map(c => ({ ...c, direction: "across" }))
            .sort((a, b) => Number(a.label) - Number(b.label)),
        ...puzzleData.clues.down
            .map(c => ({ ...c, direction: "down" }))
            .sort((a, b) => Number(a.label) - Number(b.label)),
        ];
        currentClueIndex = 0;
        
    renderGrid(rows, columns);
    // Restore saved progress if available
    if (savedProgress) {
      restoreProgress(savedProgress);
    }

    if (!completed) {
      selectCell(0, findFirstInputCol(0));

      // Listen for keyboard input
      document.addEventListener("keydown", handleKeyDown);

      document.getElementById("clue-prev").addEventListener("click", () => {
          navigateClue(-1);
      });
      document.getElementById("clue-next").addEventListener("click", () => {
          navigateClue(1);
      });

      if (isTouchDevice()) {
          renderOnScreenKeyboard();
      }
    }
}

function restoreProgress(saved) {
  const { rows, columns } = puzzleData.dimensions;

  // Restore grid state — use optional chaining in case the stored grid
  // has different dimensions than the current puzzle (e.g. stale data).
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const letter = saved.grid_state?.[r]?.[c];
      if (letter && letter !== null) {
        gridState[r][c] = letter;
        renderCellLetter(r, c, letter);
      }
    }
  }

  // Restore elapsed time
  accumulatedSeconds = saved.elapsed_seconds;
  updateTimerDisplay(accumulatedSeconds);

  if (saved.completed) {
    // Show completed state
    completed = true;

    // Mark all cells as correct
    document.querySelectorAll(".grid-cell:not(.block)").forEach((el) => {
      el.classList.add("correct");
    });

    document.getElementById("completion-message").textContent =
      `Solved in ${formatTime(Math.floor(saved.elapsed_seconds))}!`;

    // Do not attach the keydown listener -- leave it inactive
    return;
  }

  // If not completed but has progress, mark timer as started
  if (saved.elapsed_seconds > 0) {
    // Timer will be started by main.js after the welcome screen.
    // Just mark that we have accumulated time so the display is correct.
    timerStarted = false;
  }
}

function renderGrid(rows, cols) {
  const gridEl = document.getElementById("crossword-grid");
  gridEl.style.gridTemplateColumns = `repeat(${cols}, 56px)`;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellData = puzzleData.grid[r][c];
      const div = document.createElement("div");
      div.classList.add("grid-cell");
      div.dataset.row = r;
      div.dataset.col = c;

      if (cellData.type === "block") {
        div.classList.add("block");
      } else {
        // Add label if present
        if (cellData.label) {
          const labelSpan = document.createElement("span");
          labelSpan.classList.add("label");
          labelSpan.textContent = cellData.label;
          div.appendChild(labelSpan);
        }
        // Add letter container
        const letterSpan = document.createElement("span");
        letterSpan.classList.add("letter");
        div.appendChild(letterSpan);

        // Click handler
        div.addEventListener("click", () => {
          if (selectedRow === r && selectedCol === c) {
            // Clicking same cell toggles direction
            direction = direction === "across" ? "down" : "across";
          }
          selectCell(r, c);
        });
      }

      gridEl.appendChild(div);
    }
  }
}

function navigateClue(delta) {
  if (completed) return;

  // Wrap around the sequence
  currentClueIndex = (currentClueIndex + delta + clueSequence.length) % clueSequence.length;

  const clue = clueSequence[currentClueIndex];

  // Set the direction to match the clue
  direction = clue.direction;

  // Select the first cell of this clue's word
  const firstCellIdx = clue.cells[0];
  const cols = puzzleData.dimensions.columns;
  const row = Math.floor(firstCellIdx / cols);
  const col = firstCellIdx % cols;

  selectCell(row, col);
}

function selectCell(row, col) {
  if (completed) return;
  const cell = puzzleData.grid[row][col];
  if (cell.type === "block") return;

  selectedRow = row;
  selectedCol = col;

  updateHighlighting();
  updateCurrentClue();
}

function updateHighlighting() {
  const cells = document.querySelectorAll(".grid-cell");
  cells.forEach((el) => {
    el.classList.remove("selected", "highlighted");
  });

  // Get the cells belonging to the current word
  const wordCells = getWordCells(selectedRow, selectedCol, direction);

  const cols = puzzleData.dimensions.columns;
  wordCells.forEach(([r, c]) => {
    const idx = r * cols + c;
    cells[idx].classList.add("highlighted");
  });

  // Mark the selected cell specifically
  const selectedIdx = selectedRow * cols + selectedCol;
  cells[selectedIdx].classList.remove("highlighted");
  cells[selectedIdx].classList.add("selected");
}

function getWordCells(row, col, dir) {
  /* EXERCISE: Return an array of [row, col] pairs for all cells in the
     current word. If dir is "across", walk left to find the start of the
     word (stop at grid edge or block), then walk right collecting cells
     until you hit a block or the edge. If dir is "down", do the same
     vertically.

     Hint: use puzzleData.grid[r][c].type === "block" to detect blocks.
     Return format: [[r1, c1], [r2, c2], ...]
  */
  const { rows, columns } = puzzleData.dimensions;
  const result = [];

  if (dir === "across") {
    // Find start of word (walk left)
    let startCol = col;
    while (startCol > 0 && puzzleData.grid[row][startCol - 1].type !== "block") {
      startCol--;
    }
    // Collect cells (walk right)
    let c = startCol;
    while (c < columns && puzzleData.grid[row][c].type !== "block") {
      result.push([row, c]);
      c++;
    }
  } else {
    // Find start of word (walk up)
    let startRow = row;
    while (startRow > 0 && puzzleData.grid[startRow - 1][col].type !== "block") {
      startRow--;
    }
    // Collect cells (walk down)
    let r = startRow;
    while (r < rows && puzzleData.grid[r][col].type !== "block") {
      result.push([r, col]);
      r++;
    }
  }

  return result;
}

function updateCurrentClue() {
  if (clueSequence.length === 0) return;

  const flatIdx = selectedRow * puzzleData.dimensions.columns + selectedCol;

  // Find the matching clue in the sequence
  const idx = clueSequence.findIndex(
    (c) => c.direction === direction && c.cells.includes(flatIdx)
  );

  if (idx !== -1) {
    currentClueIndex = idx;
  }

  const clue = clueSequence[currentClueIndex];
  const dirLabel = clue.direction === "across" ? "A" : "D";

  document.getElementById("clue-prefix").textContent = `${clue.label}${dirLabel}`;
  document.getElementById("clue-text").textContent = clue.text;
}

function findClueForCell(row, col, dir) {
  const flatIdx = row * puzzleData.dimensions.columns + col;
  const clueList = dir === "across" ? puzzleData.clues.across : puzzleData.clues.down;
  return clueList.find((clue) => clue.cells.includes(flatIdx)) || null;
}

function handleKeyDown(e) {
    if (completed) return;
    if (selectedRow < 0 || selectedCol < 0) return;

    if (e.key === "Backspace") {
        e.preventDefault();
        handleBackspace();
        return;
    }

    if (e.key === "Tab") {
        e.preventDefault();
        direction = direction === "across" ? "down" : "across";
        updateHighlighting();
        updateCurrentClue();
        return;
    }

    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // Only navigate clues if no modifier key is held.
        // Shift+Arrow or Ctrl+Arrow could be reserved for future use.
        if (!e.shiftKey && !e.ctrlKey) {
            e.preventDefault();
            navigateClue(e.key === "ArrowLeft" ? -1 : 1);
            return;
        }
    }

    // Only accept single letters
    if (e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        handleLetterInput(e.key.toUpperCase());
    }
}

export function injectKey(key) {
    if (completed) return;
    if (selectedRow < 0 || selectedCol < 0) return;

    if (key === "Backspace") {
        handleBackspace();
        return;
    }

    if (key.length === 1 && /^[a-zA-Z]$/.test(key)) {
        handleLetterInput(key.toUpperCase());
    }
}

function handleLetterInput(letter) {
  // Start the timer on first input
  if (!timerStarted) {
    // Timer is now started externally by main.js when the play button is clicked.
    // This fallback ensures the timer starts if startTimer() was not called.
    startTimer();
  } else if (timerStarted && !timerInterval) {
    // Resuming from a saved session -- restart the interval
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 100);
  }

  // Set the letter in the grid state
  gridState[selectedRow][selectedCol] = letter;
  renderCellLetter(selectedRow, selectedCol, letter);

  // Advance to the next cell in the current direction
  advanceCursor();

  // Check if the puzzle is complete
  checkCompletion();
  saveProgress();
}

function handleBackspace() {
  if (gridState[selectedRow][selectedCol] !== "") {
    // Clear current cell
    gridState[selectedRow][selectedCol] = "";
    renderCellLetter(selectedRow, selectedCol, "");
  } else {
    // Move backward and clear that cell
    retreatCursor();
    gridState[selectedRow][selectedCol] = "";
    renderCellLetter(selectedRow, selectedCol, "");
  }
  saveProgress();
}

function renderCellLetter(row, col, letter) {
  const cols = puzzleData.dimensions.columns;
  const idx = row * cols + col;
  const cellEl = document.querySelectorAll(".grid-cell")[idx];
  const letterSpan = cellEl.querySelector(".letter");
  if (letterSpan) {
    letterSpan.textContent = letter;
  }
}

function advanceCursor() {
  const { rows, columns } = puzzleData.dimensions;
  let r = selectedRow;
  let c = selectedCol;

  if (direction === "across") {
    c++;
    while (c < columns && puzzleData.grid[r][c].type === "block") c++;
    if (c < columns) selectCell(r, c);
  } else {
    r++;
    while (r < rows && puzzleData.grid[r][c].type === "block") r++;
    if (r < rows) selectCell(r, c);
  }
}

function retreatCursor() {
  /* EXERCISE: Implement cursor movement backward. This is the reverse
     of advanceCursor(). If direction is "across", decrement the column.
     If direction is "down", decrement the row. Skip over block cells.
     Call selectCell() with the new position if valid. */
  const { rows, columns } = puzzleData.dimensions;
  let r = selectedRow;
  let c = selectedCol;

  if (direction === "across") {
    c--;
    while (c >= 0 && puzzleData.grid[r][c].type === "block") c--;
    if (c >= 0) selectCell(r, c);
  } else {
    r--;
    while (r >= 0 && puzzleData.grid[r][c].type === "block") r--;
    if (r >= 0) selectCell(r, c);
  }
}

function updateTimer() {
  const sessionSeconds = (Date.now() - startTime) / 1000;
  const totalSeconds = Math.floor(accumulatedSeconds + sessionSeconds);
  updateTimerDisplay(totalSeconds);
}

function updateTimerDisplay(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  document.getElementById("timer").textContent =
    `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getElapsedSeconds() {
  if (!timerStarted) return accumulatedSeconds;
  const sessionSeconds = (Date.now() - startTime) / 1000;
  return accumulatedSeconds + sessionSeconds;
}

function findFirstInputCol(row) {
  for (let c = 0; c < puzzleData.dimensions.columns; c++) {
    if (puzzleData.grid[row][c].type !== "block") return c;
  }
  return 0;
}

function checkCompletion() {
  const { rows, columns } = puzzleData.dimensions;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const cell = puzzleData.grid[r][c];
      if (cell.type === "block") continue;

      // Check if the cell is filled AND matches the answer
      if (gridState[r][c] !== cell.answer) {
        return; // Not complete yet
      }
    }
  }

  // If we get here, every cell matches -- puzzle is solved
  completed = true;
  clearInterval(timerInterval);

  const elapsed = Math.floor(getElapsedSeconds());

  // Mark all cells as correct
  document.querySelectorAll(".grid-cell:not(.block)").forEach((el) => {
    el.classList.add("correct");
  });

  document.getElementById("completion-message").textContent =
    `Solved in ${formatTime(elapsed)}!`;

  document.removeEventListener("keydown", handleKeyDown);

  // Fire the completion callback
  if (onComplete) {
    onComplete(elapsed);
  }
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function renderOnScreenKeyboard() {
  const rows = [
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
    ["Z", "X", "C", "V", "B", "N", "M", "BACK"],
  ];

  const keyboard = document.createElement("div");
  keyboard.id = "onscreen-keyboard";

  rows.forEach((rowKeys) => {
    const rowDiv = document.createElement("div");
    rowDiv.classList.add("kb-row");

    rowKeys.forEach((key) => {
      const btn = document.createElement("button");
      btn.classList.add("kb-key");
      btn.setAttribute("type", "button");

      if (key === "BACK") {
        btn.classList.add("kb-key-wide");
        btn.textContent = "\u232B";  // Unicode backspace symbol
        btn.setAttribute("aria-label", "Backspace");
        btn.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          injectKey("Backspace");
        });
      } else {
        btn.textContent = key;
        btn.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          injectKey(key);
        });
      }

      rowDiv.appendChild(btn);
    });

    keyboard.appendChild(rowDiv);
  });

  // Append to the #app container, after everything else
  document.getElementById("app").appendChild(keyboard);
}

function saveProgress() {
  // Fire-and-forget: do not await, do not block input
  const payload = {
    discord_user_id: currentUserId,
    puzzle_date: currentPuzzleDate,
    grid_state: gridState,
    elapsed_seconds: getElapsedSeconds(),
    completed: false,
  };

  fetch("/api/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => console.error("Failed to save progress:", err));
}