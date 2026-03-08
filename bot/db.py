import os
import aiosqlite

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "crossword.db")


async def init_db():
    """Create the database and tables if they don't exist."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                discord_user_id TEXT NOT NULL,
                puzzle_date TEXT NOT NULL,
                grid_state TEXT NOT NULL,
                elapsed_seconds REAL NOT NULL DEFAULT 0,
                completed INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(discord_user_id, puzzle_date)
            );
        """)
        await db.commit()

async def save_progress(
    discord_user_id: str,
    puzzle_date: str,
    grid_state: str,
    elapsed_seconds: float,
    completed: bool = False,
) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        # Check if already completed -- never overwrite a finished puzzle
        cursor = await db.execute(
            "SELECT completed FROM progress WHERE discord_user_id = ? AND puzzle_date = ?",
            (discord_user_id, puzzle_date),
        )
        row = await cursor.fetchone()
        if row and row[0] == 1:
            return False

        await db.execute(
            """INSERT INTO progress (discord_user_id, puzzle_date, grid_state, elapsed_seconds, completed)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(discord_user_id, puzzle_date)
               DO UPDATE SET grid_state = excluded.grid_state,
                             elapsed_seconds = excluded.elapsed_seconds,
                             completed = excluded.completed,
                             updated_at = CURRENT_TIMESTAMP""",
            (discord_user_id, puzzle_date, grid_state, elapsed_seconds, 1 if completed else 0),
        )
        await db.commit()
        return True
    
async def load_progress(discord_user_id: str, puzzle_date: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "SELECT grid_state, elapsed_seconds, completed FROM progress WHERE discord_user_id = ? AND puzzle_date = ?",
            (discord_user_id, puzzle_date),
        )
        row = await cursor.fetchone()
        if not row:
            return None
        return {
            "grid_state": row[0],
            "elapsed_seconds": row[1],
            "completed": bool(row[2]),
        }

async def save_result(discord_user_id: str, username: str, puzzle_date: str, completion_time: int) -> bool:
    """
    Save a puzzle result. Returns True if saved, False if a result
    already exists for this user and date.
    """
    async with aiosqlite.connect(DB_PATH) as db:
        try:
            await db.execute(
                """INSERT INTO results (discord_user_id, username, puzzle_date, completion_time)
                   VALUES (?, ?, ?, ?)""",
                (discord_user_id, username, puzzle_date, completion_time),
            )
            await db.commit()
            return True
        except aiosqlite.IntegrityError:
            # UNIQUE constraint violation -- already solved today
            return False


async def get_user_stats(discord_user_id: str) -> dict:
    """Fetch statistics for a specific user."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Total games played
        cursor = await db.execute(
            "SELECT COUNT(*) as count FROM results WHERE discord_user_id = ?",
            (discord_user_id,),
        )
        row = await cursor.fetchone()
        games_played = row[0]

        if games_played == 0:
            return {"games_played": 0, "best_time": None, "average_time": None}

        # Best time
        cursor = await db.execute(
            "SELECT MIN(completion_time) FROM results WHERE discord_user_id = ?",
            (discord_user_id,),
        )
        best_time = (await cursor.fetchone())[0]

        # Average time
        cursor = await db.execute(
            "SELECT AVG(completion_time) FROM results WHERE discord_user_id = ?",
            (discord_user_id,),
        )
        average_time = round((await cursor.fetchone())[0])

        return {
            "games_played": games_played,
            "best_time": best_time,
            "average_time": average_time,
        }