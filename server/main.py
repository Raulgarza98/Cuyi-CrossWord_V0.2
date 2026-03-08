from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
from server.nyt import fetch_todays_mini
from datetime import datetime, timezone
from bot.db import save_result as db_save_result, init_db as db_init
from bot.db import save_progress as db_save_progress, load_progress as db_load_progress

from server.config import DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage shared resources across the application lifetime."""
    # Create a shared HTTP client for outbound requests.
    # This is more efficient than creating a new client per request.
    app.state.http_client = httpx.AsyncClient()
    await db_init()
    yield
    await app.state.http_client.aclose()


app = FastAPI(lifespan=lifespan)

# CORS middleware. The Discord proxy handles origin security,
# so a permissive policy is acceptable here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    """Simple health check endpoint."""
    return {"status": "ok"}


@app.post("/api/token")
async def exchange_token(request: Request):
    """
    Exchange a Discord OAuth2 authorization code for an access token.
    The frontend sends a code obtained from the Embedded App SDK.
    This endpoint exchanges it server-side so the Client Secret stays private.
    """
    body = await request.json()
    code = body.get("code")

    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    response = await request.app.state.http_client.post(
        "https://discord.com/api/oauth2/token",
        data={
            "client_id": DISCORD_CLIENT_ID,
            "client_secret": DISCORD_CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail="Token exchange failed"
        )

    return {"access_token": response.json()["access_token"]}

@app.get("/api/puzzle/today")
async def get_todays_puzzle(request: Request):
    """Fetch and return today's Mini Crossword data."""
    try:
        puzzle = await fetch_todays_mini(request.app.state.http_client)
        return puzzle
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch puzzle: {e}")
    
@app.post("/api/results")
async def save_result(request: Request):
    body = await request.json()
    discord_user_id = body.get("discord_user_id")
    username = body.get("username")
    completion_time = body.get("completion_time")

    if not all([discord_user_id, username, completion_time is not None]):
        raise HTTPException(status_code=400, detail="Missing required fields")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    saved = await db_save_result(discord_user_id, username, today, completion_time)

    if not saved:
        return {"status": "already_exists", "message": "You already solved today's puzzle."}

    return {"status": "saved"}

@app.post("/api/progress")
async def save_progress_endpoint(request: Request):
    body = await request.json()
    discord_user_id = body.get("discord_user_id")
    puzzle_date = body.get("puzzle_date")
    grid_state = body.get("grid_state")
    elapsed_seconds = body.get("elapsed_seconds")
    completed = body.get("completed", False)

    if not all([discord_user_id, puzzle_date, grid_state is not None, elapsed_seconds is not None]):
        raise HTTPException(status_code=400, detail="Missing required fields")

    import json
    grid_json = json.dumps(grid_state)

    await db_save_progress(discord_user_id, puzzle_date, grid_json, elapsed_seconds, completed)
    return {"status": "saved"}

@app.get("/api/progress")
async def load_progress_endpoint(discord_user_id: str, puzzle_date: str):
    progress = await db_load_progress(discord_user_id, puzzle_date)
    if not progress:
        return {"found": False}

    import json
    return {
        "found": True,
        "grid_state": json.loads(progress["grid_state"]),
        "elapsed_seconds": progress["elapsed_seconds"],
        "completed": progress["completed"],
    }