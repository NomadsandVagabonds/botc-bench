"""FastAPI application entry point."""

from __future__ import annotations

import logging
import os
from pathlib import Path

# Load .env
_env = Path(__file__).parent.parent.parent / ".env"
if _env.exists():
    for _line in _env.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from botc.api.routes import router
from botc.wager.router import wager_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

app = FastAPI(
    title="BotC Bench",
    description="Blood on the Clocktower AI Agent Benchmark",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(wager_router)


@app.on_event("startup")
async def _start_background_tasks():
    import asyncio
    import subprocess
    from botc.wager.router import settlement_loop

    asyncio.create_task(settlement_loop())

    # Prevent macOS sleep while the server is running.
    # caffeinate -i keeps the system awake (idle sleep prevention).
    # The process dies automatically when the parent (uvicorn) exits.
    try:
        subprocess.Popen(
            ["caffeinate", "-i", "-w", str(os.getpid())],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        logging.getLogger(__name__).info("caffeinate started — system will not sleep while server is running")
    except FileNotFoundError:
        pass  # Not on macOS


@app.get("/")
async def root():
    return {"name": "botc-bench", "version": "0.1.0"}
