import html
from datetime import datetime, timezone
import httpx
from server.config import NYT_S_COOKIE

BASE_URL = "https://www.nytimes.com/svc/crosswords"


async def fetch_todays_mini(client: httpx.AsyncClient) -> dict:
    """
    Fetch and parse today's NYT Mini Crossword.
    Returns a cleaned dict ready for the frontend.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cookies = {"NYT-S": NYT_S_COOKIE}

    # Step 1: Get puzzle ID from metadata endpoint
    meta_response = await client.get(
        f"{BASE_URL}/v3/puzzles.json",
        params={
            "publish_type": "mini",
            "date_start": today,
            "date_end": today,
        },
        cookies=cookies,
    )
    meta_response.raise_for_status()
    results = meta_response.json().get("results", [])

    if not results:
        raise ValueError(f"No Mini Crossword found for {today}")

    puzzle_id = results[0]["puzzle_id"]

    # Step 2: Get full puzzle data
    puzzle_response = await client.get(
        f"{BASE_URL}/v6/puzzle/{puzzle_id}.json",
        cookies=cookies,
    )
    puzzle_response.raise_for_status()
    raw = puzzle_response.json()

    # Parse into a clean format for the frontend
    return _parse_puzzle(raw, today, puzzle_id)


def _parse_puzzle(raw: dict, date: str, puzzle_id: int = 0) -> dict:
    """
    Transform the raw NYT API response into a frontend-friendly structure.

    The raw response has a 'body' list containing puzzle board objects.
    Each board has a flat 'cells' array in row-major order and a 'clues' list.
    """
    # The puzzle data may be under 'body' (v6 format)
    board = raw.get("body", [raw])[0] if "body" in raw else raw

    dimensions = board["dimensions"]
    rows = dimensions.get("rowCount", dimensions.get("height"))
    cols = dimensions.get("columnCount", dimensions.get("width"))
    raw_cells = board["cells"]
    raw_clues = board["clues"]

    # Build the grid: a 2D array of cell objects
    grid = []
    for r in range(rows):
        row = []
        for c in range(cols):
            cell_data = raw_cells[r * cols + c]
            cell_type = cell_data.get("type", 0)

            if cell_type == 0:
                # Black/block cell
                row.append({"type": "block"})
            else:
                row.append({
                    "type": "cell",
                    "answer": cell_data.get("answer", ""),
                    "label": cell_data.get("label", ""),
                })
        grid.append(row)

    # Parse clues into across and down lists
    across_clues = []
    down_clues = []
    for clue in raw_clues:
        direction = clue["direction"]
        # Clue text may be a list of objects with 'plain' key, or a string.
        if isinstance(clue["text"], list):
            text = clue["text"][0].get("plain", "")
        else:
            text = str(clue["text"])

        # Decode any HTML entities in the clue text
        text = html.unescape(text)

        clue_obj = {
            "label": clue["label"],
            "text": text,
            "cells": clue["cells"],  # flat indices into the cell array
        }

        if direction == "Across":
            across_clues.append(clue_obj)
        else:
            down_clues.append(clue_obj)

    return {
        "date": date,
        "puzzle_id": puzzle_id,
        "dimensions": {"rows": rows, "columns": cols},
        "grid": grid,
        "clues": {"across": across_clues, "down": down_clues},
    }