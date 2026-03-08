import { DiscordSDK } from "@discord/embedded-app-sdk";
import { initCrossword, setOnComplete, getGridState, startTimer, cleanup, resetState } from "./crossword.js";

const DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;
const discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);
let currentUser = null;
// Module-level state that persists across phases
let user = null;
let gameStarting = false;
let puzzleDate = null;
let savedProgress = null;
let puzzleId = null;

function formatSpanishDate(dateString) {
  const months = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];

  const parts = dateString.split("-");
  const year = parts[0];
  const monthIndex = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  return `${day} de ${months[monthIndex]}, ${year}`;
}

function showWelcomeScreen() {
  const displayName = user.global_name || user.username;
  const isCompleted = savedProgress && savedProgress.completed;
  const buttonText = isCompleted ? "Ver Resultado" : "Jugar MIDI";
  const puzzleDateFormatted = formatSpanishDate(puzzleDate);
  const puzzleInfo = `${puzzleDateFormatted} -- Puzzle #${puzzleId}`;

  const app = document.getElementById("app");
  app.innerHTML = `
    <div id="welcome-screen">
      <img src="/logo.png" alt="Logo" id="welcome-logo" />
      <h1>Bienvenido Cuyo:</h1>
      <div class="welcome-name">${displayName}</div>
      <button id="play-button">${buttonText}</button>
      <div id="puzzle-info">${puzzleInfo}</div>
    </div>
  `;

  document.getElementById("play-button").addEventListener("click", () => {
    startGame();
  });
}

async function setupDiscordSdk() {
  await discordSdk.ready();

  const { code } = await discordSdk.commands.authorize({
    client_id: DISCORD_CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "guilds"],
  });

  const tokenResponse = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const { access_token } = await tokenResponse.json();

  const auth = await discordSdk.commands.authenticate({ access_token });
  currentUser = auth.user;

  return currentUser;
}

async function boot() {
  try {
    user = await setupDiscordSdk();

    const puzzleCheck = await fetch("/api/puzzle/today");
    const puzzleInfo = await puzzleCheck.json();
    puzzleDate = puzzleInfo.date;
    puzzleId = puzzleInfo.puzzle_id;

    const progressResp = await fetch(
      `/api/progress?discord_user_id=${user.id}&puzzle_date=${puzzleDate}`
    );
    const progressData = await progressResp.json();
    savedProgress = progressData.found ? progressData : null;

    showWelcomeScreen();

  } catch (err) {
    console.error("Boot failed:", err);
    const app = document.getElementById("app");
    app.innerHTML = `
      <div id="loading-screen">
        <h1>Mini Crossword</h1>
        <p style="color: #b9bbbe;">Failed to load. Please close and relaunch.</p>
      </div>
    `;
  }
}

async function startGame() {
  if (gameStarting) return;
  gameStarting = true;

  const app = document.getElementById("app");

  // Clear the welcome screen and set up the crossword container.
  // initCrossword will fill #app with the grid, carousel, etc.
  app.innerHTML = `<div id="loading">Loading grid...</div>`;

  try {
    // Set up the completion callback
    setOnComplete(async (elapsedSeconds) => {
      try {
        await fetch("/api/results", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            discord_user_id: user.id,
            username: user.global_name || user.username,
            completion_time: elapsedSeconds,
          }),
        });

        await fetch("/api/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            discord_user_id: user.id,
            puzzle_date: puzzleDate,
            grid_state: getGridState(),
            elapsed_seconds: elapsedSeconds,
            completed: true,
          }),
        });
      } catch (err) {
        console.error("Failed to save result:", err);
      }
    });

    // Initialize the crossword grid with saved progress if any
    await initCrossword("app", savedProgress, user.id, puzzleDate);

    // Start the timer immediately (unless puzzle is already completed).
    // This replaces the old behavior of starting on first letter input.
    if (!savedProgress || !savedProgress.completed) {
      startTimer();
    }
    document.getElementById("back-button").addEventListener("click", async () => {
      try {
        await handleBackToWelcome();
      } catch (err) {
        console.error("handleBackToWelcome failed:", err);
      }
    });
  } catch (err) {
    console.error("startGame failed:", err);
    app.innerHTML = `
      <div id="loading-screen">
        <h1>Mini Crossword</h1>
        <p style="color: #b9bbbe;">Failed to load puzzle.</p>
        <p style="color: #ed4245; font-size: 0.8em; word-break: break-all;">${err?.message || err}</p>
        <button id="retry-button" style="margin-top:16px;">Reintentar</button>
      </div>
    `;
    document.getElementById("retry-button")?.addEventListener("click", () => {
      resetState();
      showWelcomeScreen();
    });
  } finally {
    gameStarting = false;
  }
}

async function handleBackToWelcome() {
  // Clean up the crossword: stop timer, remove listeners, get current state
  const state = cleanup();

  // Save progress to the backend (fire-and-forget)
  if (!state.completed) {
    fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        discord_user_id: user.id,
        puzzle_date: puzzleDate,
        grid_state: state.gridState,
        elapsed_seconds: state.elapsedSeconds,
        completed: false,
      }),
    }).catch((err) => console.error("Failed to save progress on back:", err));
  }

  // Update savedProgress so the next startGame call restores correctly
  savedProgress = {
    found: true,
    grid_state: state.gridState,
    elapsed_seconds: state.elapsedSeconds,
    completed: state.completed,
  };

  // Reset the crossword module state for clean re-entry
  resetState();

  // Show the welcome screen
  showWelcomeScreen();
}

boot();