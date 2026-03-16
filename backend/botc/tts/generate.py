"""Generate TTS audio for a saved game using ElevenLabs.

Produces one MP3 per speakable message, plus a manifest JSON mapping
message index → audio file. A stitcher then combines them with pauses.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import httpx

from botc.tts.voices import assign_voice, get_narrator_voice, infer_gender

logger = logging.getLogger(__name__)

ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech"
GAMES_DIR = Path(__file__).parent.parent.parent / "games"


def get_mp3_duration(path: Path) -> float:
    """Get duration of an MP3 file in seconds using ffprobe."""
    import subprocess
    try:
        result = subprocess.run(
            ["/opt/homebrew/bin/ffprobe", "-v", "quiet", "-show_entries",
             "format=duration", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, check=True,
        )
        return float(result.stdout.strip())
    except Exception:
        return 0.0


def _get_api_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not key:
        raise RuntimeError("ELEVENLABS_API_KEY not set in environment")
    return key


def _extract_players(events: list[dict]) -> dict[int, dict]:
    """Extract seat → player info from game events."""
    for e in events:
        if e["type"] == "game.state":
            return {p["seat"]: p for p in e["data"]["players"]}
    # Fallback: game.created
    for e in events:
        if e["type"] == "game.created":
            return {p["seat"]: p for p in e["data"]["players"]}
    return {}


def _extract_speakable_messages(events: list[dict]) -> list[dict]:
    """Extract messages that should be voiced, in order.

    Each returned dict includes an 'event_index' pointing back to the
    source event in the events list (for sync with the replay timeline).

    Includes: public, accusation, defense, narration, system (phase changes).
    Excludes: group (breakout), private_info, agent.tokens, etc.
    """
    messages = []
    for event_idx, e in enumerate(events):
        if e["type"] == "message.new":
            d = e["data"]
            msg_type = d.get("type", "")
            if msg_type in ("public", "accusation", "defense", "narration", "system"):
                messages.append({**d, "event_index": event_idx})
        elif e["type"] == "phase.change":
            phase = e["data"].get("phase", "")
            day = e["data"].get("day", 0)
            text = _phase_announcement(phase, day)
            if text:
                messages.append({
                    "type": "narrator",
                    "seat": None,
                    "content": text,
                    "event_index": event_idx,
                })
        elif e["type"] == "game.over":
            winner = e["data"].get("winner", "unknown")
            messages.append({
                "type": "narrator",
                "seat": None,
                "content": f"The game is over. The {winner} team is victorious.",
                "event_index": event_idx,
            })
        elif e["type"] == "debrief.message":
            messages.append({
                "type": "debrief",
                "seat": e["data"].get("seat"),
                "content": e["data"].get("content", ""),
                "character_name": e["data"].get("character_name", ""),
                "event_index": event_idx,
            })
    return messages


def _phase_announcement(phase: str, day: int) -> str | None:
    """Generate narrator text for phase transitions."""
    announcements = {
        "first_night": "Night falls upon the village. The first night begins.",
        "night": f"Darkness descends. Night {day} begins.",
        "day_discussion": f"Dawn breaks over the village. Day {day} begins. The townsfolk gather to discuss.",
        "nominations": "Nominations are now open.",
        "execution": "The votes have been counted.",
        "debrief": "The Grimoire is revealed. Let us hear from the players.",
    }
    return announcements.get(phase)


def generate_game_audio(
    game_id: str,
    *,
    model_id: str = "eleven_multilingual_v2",
    speed: float = 1.0,
) -> Path:
    """Generate TTS audio files for a saved game.

    Returns the path to the output directory containing MP3 clips + manifest.
    """
    api_key = _get_api_key()

    # Load game data
    game_path = GAMES_DIR / f"game_{game_id}.json"
    if not game_path.exists():
        raise FileNotFoundError(f"Game file not found: {game_path}")

    data = json.loads(game_path.read_text())
    events = data.get("events", [])
    if not events:
        raise ValueError(f"Game {game_id} has no events")

    # Extract player info and messages
    players = _extract_players(events)
    messages = _extract_speakable_messages(events)
    logger.info("Game %s: %d players, %d speakable messages", game_id, len(players), len(messages))

    # Assign voices to each player
    voice_map: dict[int, str] = {}
    used_voices: set[str] = set()
    import random
    rng = random.Random(hash(game_id))

    for seat, player in sorted(players.items()):
        voice_id = assign_voice(
            character_name=player.get("character_name", f"Player {seat}"),
            alignment=player.get("alignment", "good"),
            role_type=player.get("role_type", "townsfolk"),
            used_voices=used_voices,
            rng=rng,
        )
        voice_map[seat] = voice_id
        used_voices.add(voice_id)
        logger.info(
            "  Seat %d (%s, %s %s): voice %s",
            seat, player.get("character_name"), player.get("alignment"),
            infer_gender(player.get("character_name", "")),
            voice_id[:8],
        )

    narrator_voice = get_narrator_voice()

    # Create output directory
    out_dir = GAMES_DIR / f"audio_{game_id}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Generate intro narration if not already cached
    intro_path = out_dir / "intro.mp3"
    intro_text = (
        "A long time ago... in the sleepy town of Ravenswood Bluff... "
        "during a hellish thunderstorm... on the stroke of midnight... "
        "you hear a scream. AAAAAAGHHHHH! "
        "Rushing to the Town Square to investigate, you find your beloved "
        "Storyteller, myself, has been murdered... impaled on the hour hand "
        "of the clocktower... blood dripping onto the cobblestones below. "
        "You assume that this is the work of a Demon... and you are correct "
        "— a Demon that kills by night, and takes on human form by day."
    )

    manifest: list[dict[str, Any]] = []
    client = httpx.Client(timeout=30.0)

    if not intro_path.exists() or intro_path.stat().st_size == 0:
        logger.info("  [intro] Generating narrator intro...")
        try:
            resp = client.post(
                f"{ELEVENLABS_API_URL}/{narrator_voice}",
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json={
                    "text": intro_text,
                    "model_id": model_id,
                    "voice_settings": {"stability": 0.45, "similarity_boost": 0.85, "style": 0.6},
                },
            )
            resp.raise_for_status()
            intro_path.write_bytes(resp.content)
            time.sleep(0.3)
        except Exception as e:
            logger.error("  [intro] Failed: %s", e)

    if intro_path.exists() and intro_path.stat().st_size > 0:
        manifest.append({
            "index": -1,
            "file": "intro.mp3",
            "speaker": "Narrator",
            "seat": None,
            "type": "intro",
            "text": intro_text[:100],
            "event_index": -1,
            "duration_s": get_mp3_duration(intro_path),
        })

    # Generate audio for each message

    for idx, msg in enumerate(messages):
        seat = msg.get("seat")
        msg_type = msg.get("type", "")
        event_index = msg.get("event_index")
        content = msg.get("content", "").strip()

        if not content:
            continue

        # Skip very short system messages
        if msg_type == "system" and len(content) < 10:
            continue

        # Determine voice
        if msg_type in ("narrator", "system", "narration"):
            voice_id = narrator_voice
            speaker = "Narrator"
        elif seat is not None and seat in voice_map:
            voice_id = voice_map[seat]
            speaker = players.get(seat, {}).get("character_name", f"Seat {seat}")
        elif msg_type == "debrief":
            # Debrief messages have character_name
            char_name = msg.get("character_name", "")
            # Find seat by name
            found_seat = None
            for s, p in players.items():
                if p.get("character_name") == char_name:
                    found_seat = s
                    break
            voice_id = voice_map.get(found_seat, narrator_voice) if found_seat is not None else narrator_voice
            speaker = char_name or "Unknown"
        else:
            voice_id = narrator_voice
            speaker = "Narrator"

        # Truncate very long messages for TTS (save cost)
        if len(content) > 800:
            content = content[:800] + "..."

        out_path = out_dir / f"{idx:04d}.mp3"

        # Skip if already generated (resume support)
        if out_path.exists() and out_path.stat().st_size > 0:
            manifest.append({
                "index": idx,
                "file": out_path.name,
                "speaker": speaker,
                "seat": seat,
                "type": msg_type,
                "text": content[:100],
                "event_index": event_index,
                "duration_s": get_mp3_duration(out_path),
            })
            logger.info("  [%d/%d] %s — cached", idx + 1, len(messages), speaker)
            continue

        # Call ElevenLabs API
        logger.info("  [%d/%d] %s — generating...", idx + 1, len(messages), speaker)
        try:
            response = client.post(
                f"{ELEVENLABS_API_URL}/{voice_id}",
                headers={
                    "xi-api-key": api_key,
                    "Content-Type": "application/json",
                },
                json={
                    "text": content,
                    "model_id": model_id,
                    "voice_settings": {
                        "stability": 0.5,
                        "similarity_boost": 0.75,
                        "style": 0.4,
                    },
                },
            )
            response.raise_for_status()
            out_path.write_bytes(response.content)

            manifest.append({
                "index": idx,
                "file": out_path.name,
                "speaker": speaker,
                "seat": seat,
                "type": msg_type,
                "text": content[:100],
                "event_index": event_index,
                "duration_s": get_mp3_duration(out_path),
            })

            # Rate limit courtesy — ElevenLabs has per-second limits
            time.sleep(0.3)

        except Exception as e:
            logger.error("  [%d/%d] %s — FAILED: %s", idx + 1, len(messages), speaker, e)
            manifest.append({
                "index": idx,
                "file": None,
                "speaker": speaker,
                "seat": seat,
                "type": msg_type,
                "error": str(e),
            })

    client.close()

    # Write manifest
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    logger.info("Generated %d audio clips in %s", len([m for m in manifest if m.get("file")]), out_dir)

    return out_dir


def stitch_game_audio(game_id: str, pause_ms: int = 1200) -> Path:
    """Combine individual clips into a single MP3 with pauses between speakers.

    Uses ffmpeg to concatenate clips with silence gaps.
    Returns path to the final combined MP3.
    """
    audio_dir = GAMES_DIR / f"audio_{game_id}"
    manifest_path = audio_dir / "manifest.json"

    if not manifest_path.exists():
        raise FileNotFoundError(f"No manifest found — run generate_game_audio first")

    manifest = json.loads(manifest_path.read_text())
    clips = [m for m in manifest if m.get("file")]

    if not clips:
        raise ValueError("No audio clips to stitch")

    # Build ffmpeg concat file
    # Add silence between different speakers, shorter between same speaker
    concat_path = audio_dir / "concat.txt"
    silence_path = audio_dir / "silence.mp3"

    # Generate silence clip
    import subprocess
    subprocess.run([
        "/opt/homebrew/bin/ffmpeg", "-y", "-f", "lavfi",
        "-i", f"anullsrc=r=44100:cl=mono",
        "-t", str(pause_ms / 1000),
        "-q:a", "9",
        str(silence_path),
    ], capture_output=True, check=True)

    # Shorter pause for same speaker continuing
    short_silence_path = audio_dir / "silence_short.mp3"
    subprocess.run([
        "/opt/homebrew/bin/ffmpeg", "-y", "-f", "lavfi",
        "-i", f"anullsrc=r=44100:cl=mono",
        "-t", str(pause_ms / 3000),
        "-q:a", "9",
        str(short_silence_path),
    ], capture_output=True, check=True)

    lines = []
    prev_speaker = None
    for clip in clips:
        clip_path = audio_dir / clip["file"]
        if not clip_path.exists():
            continue

        # Add pause before this clip (except first)
        if prev_speaker is not None:
            if clip["speaker"] == prev_speaker:
                lines.append(f"file '{short_silence_path.name}'")
            else:
                lines.append(f"file '{silence_path.name}'")

        lines.append(f"file '{clip['file']}'")
        prev_speaker = clip["speaker"]

    concat_path.write_text("\n".join(lines))

    # Stitch with ffmpeg
    output_path = audio_dir / f"game_{game_id}_full.mp3"
    subprocess.run([
        "/opt/homebrew/bin/ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(concat_path),
        "-c:a", "libmp3lame", "-q:a", "4",
        str(output_path),
    ], capture_output=True, check=True)

    logger.info("Stitched %d clips → %s (%.1f MB)", len(clips), output_path.name, output_path.stat().st_size / 1e6)
    return output_path
