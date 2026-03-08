import os
import discord
from discord import app_commands
from dotenv import load_dotenv
from bot.db import get_user_stats, init_db

load_dotenv()


class CrosswordBot(discord.Client):
    """Custom Client subclass that holds a CommandTree."""

    def __init__(self):
        intents = discord.Intents.default()
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        await init_db()
        guild = discord.Object(id=int(os.getenv("GUILD_ID")))
        self.tree.copy_global_to(guild=guild)
        await self.tree.sync(guild=guild)
        print("Commands synced to test guild.")

class CrosswordLaunchView(discord.ui.View):
    @discord.ui.button(label="Play Crossword", style=discord.ButtonStyle.green)
    async def launch_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        """Launch the crossword Activity."""
        try:
            await interaction.response.launch_activity()
        except discord.HTTPException as e:
            # Fallback if launch_activity fails (e.g., Activities not enabled)
            if not interaction.response.is_done():
                await interaction.response.send_message(
                    "Could not launch the Activity. Make sure Activities are enabled "
                    "for this application in the Developer Portal.",
                    ephemeral=True,
                )
            else:
                await interaction.followup.send(
                    f"Activity launch failed: {e}", ephemeral=True
                )

bot = CrosswordBot()


@bot.event
async def on_ready():
    print(f"Bot is online as {bot.user} (ID: {bot.user.id})")


# --- Commands are defined below this line ---


@bot.tree.command(name="ping", description="Check if the bot is responsive.")
async def ping(interaction: discord.Interaction):
    """Responds with the bot's Gateway latency."""
    latency_ms = round(bot.latency * 1000)
    await interaction.response.send_message(
        f"Pong! Latency: {latency_ms}ms", ephemeral=True
    )

@bot.tree.command(name="stats", description="View your crossword statistics.")
async def stats(interaction: discord.Interaction):
    user_stats = await get_user_stats(str(interaction.user.id))

    embed = discord.Embed(
        title="Your Crossword Stats",
        color=discord.Color.blurple(),
    )
    embed.set_author(
        name=interaction.user.display_name,
        icon_url=interaction.user.display_avatar.url,
    )

    games = user_stats["games_played"]
    embed.add_field(name="Games Played", value=str(games), inline=True)

    if games > 0:
        best = user_stats["best_time"]
        avg = user_stats["average_time"]
        embed.add_field(
            name="Best Time",
            value=f"{best // 60}:{best % 60:02d}",
            inline=True,
        )
        embed.add_field(
            name="Average Time",
            value=f"{avg // 60}:{avg % 60:02d}",
            inline=True,
        )
    else:
        embed.description = "No data yet. Play your first crossword with /crossword!"
        embed.add_field(name="Best Time", value="--:--", inline=True)
        embed.add_field(name="Average Time", value="--:--", inline=True)

    await interaction.response.send_message(embed=embed, ephemeral=True)

@bot.tree.command(name="crossword", description="Play today's Mini Crossword!")
async def crossword(interaction: discord.Interaction):
    """Launch the crossword Activity."""
    try:
        await interaction.response.launch_activity()
    except discord.HTTPException as e:
        # Fallback if launch_activity fails (e.g., Activities not enabled)
        if not interaction.response.is_done():
            await interaction.response.send_message(
                "Could not launch the Activity. Make sure Activities are enabled "
                "for this application in the Developer Portal.",
                ephemeral=True,
            )
        else:
            await interaction.followup.send(
                f"Activity launch failed: {e}", ephemeral=True
            )

# Retrieve and validate token
token = os.getenv("DISCORD_BOT_TOKEN")
if not token:
    raise RuntimeError("DISCORD_BOT_TOKEN is not set in .env")

bot.run(token)