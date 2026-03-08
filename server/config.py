import os
from dotenv import load_dotenv

load_dotenv()

DISCORD_CLIENT_ID = os.getenv("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.getenv("DISCORD_CLIENT_SECRET", "")
NYT_S_COOKIE = os.getenv("NYT_S_COOKIE", "")