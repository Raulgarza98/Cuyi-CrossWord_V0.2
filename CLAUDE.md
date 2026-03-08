# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Python (bot + server)
```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Run the FastAPI server (from project root)
uvicorn server.main:app --reload --port 8000

# Run the Discord bot (from project root)
python -m bot.main
```

### Frontend (client/)
```bash
cd client
npm install
npm run dev      # dev server on :5173, proxies /api → localhost:8000
npm run build    # production build
npm run preview  # preview the production build
```

## Architecture

Three independent processes communicate at runtime:

```
Discord ──► bot/main.py          (discord.py — slash commands, Activity launch)
                │
                └── bot/db.py    (aiosqlite, shared DB at data/crossword.db)
                        ▲
Discord Activity ──► server/main.py   (FastAPI — REST API consumed by the frontend)
                         ├── server/nyt.py    (NYT Mini Crossword fetcher)
                         └── bot/db.py        (same DB module, imported directly)

Browser (inside Discord) ──► client/src/main.js   (Discord Embedded App SDK init,
                                                    OAuth2 token exchange, progress sync)
                              client/src/crossword.js  (game logic, grid rendering)
```

**Key design points:**

- The FastAPI server (`server/`) and the Discord bot (`bot/`) are separate processes but share the same `bot/db.py` module and `data/crossword.db` SQLite file. They must not run concurrently in a way that causes write contention — the server handles all DB writes from the frontend, while the bot only reads (for `/stats`).

- The Vite dev server proxies all `/api/*` requests to `localhost:8000`, so in development the frontend never needs to know the backend's address. In production, a reverse proxy (e.g. nginx) must do the same.

- `server/nyt.py` fetches the NYT Mini Crossword using a subscriber cookie (`NYT_S_COOKIE`). It calls two endpoints: the puzzle metadata endpoint (to get the puzzle ID for today's date) and the full puzzle endpoint (v6 format). The parsed response includes answers in `grid[r][c].answer`, which the frontend uses for client-side answer checking — no server-side validation is performed.

- Grid state is stored as a 2D array of letter strings (empty string = unfilled), serialized as JSON in the `progress.grid_state` column.

- Progress is saved on every keypress (fire-and-forget fetch). A completed puzzle is never overwritten — `save_progress` checks the `completed` flag before updating.

- The Discord bot (`bot/main.py`) registers slash commands to a specific guild (set via `GUILD_ID`) using `tree.copy_global_to` + `tree.sync`. Commands are only available in that guild during development.

## Database

Single SQLite file at `data/crossword.db`, managed by `bot/db.py` with `aiosqlite`.

Tables:
- `progress` — per-user per-date grid state, elapsed time, completed flag. UNIQUE on `(discord_user_id, puzzle_date)`.
- `results` — completed puzzle records with `completion_time` (seconds). UNIQUE on `(discord_user_id, puzzle_date)`.

`init_db()` is called on startup by both the server (via FastAPI lifespan) and the bot (via `setup_hook`). It only creates tables if they don't exist.

## Environment Variables

All loaded from `.env` at project root:

| Variable | Used by |
|---|---|
| `DISCORD_BOT_TOKEN` | bot |
| `DISCORD_CLIENT_ID` | server, client |
| `DISCORD_CLIENT_SECRET` | server |
| `GUILD_ID` | bot |
| `NYT_S_COOKIE` | server |
| `VITE_DISCORD_CLIENT_ID` | client (Vite build-time) |

The `client/vite.config.js` reads `.env` from `../` (project root) so the same `.env` serves all components.
