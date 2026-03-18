FROM python:3.13-slim

WORKDIR /app

# Install dependencies
COPY pyproject.toml ./
COPY botc/ botc/
RUN pip install --no-cache-dir -e .

# Create games directory for SQLite + game data
RUN mkdir -p games

# Expose port
EXPOSE 8000

# Run with uvicorn
CMD ["uvicorn", "botc.main:app", "--host", "0.0.0.0", "--port", "8000"]
