# Beleth agent — resident runner image.
# Paper trading only, outbound-only: no ports are exposed and the agent runs no server.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Runtime dependencies only, pinned via requirements.txt generated from uv.lock with:
#   uv export --frozen --no-dev --no-emit-project -o requirements.txt
# Regenerate it whenever uv.lock changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Strategy code and the config/docs files the runtime reads (strategy.md is injected
# into the LLM system prompt; strategy.yaml and macro_events.yaml drive every cycle).
COPY app ./app
COPY scripts ./scripts
COPY config ./config
COPY docs ./docs

# Non-root user; secrets are NOT baked in — they arrive via environment at runtime
# (docker compose env_file / docker run --env-file).
RUN useradd --create-home --uid 1000 beleth && chown -R beleth:beleth /app
USER beleth

CMD ["/usr/local/bin/python", "scripts/run_agent.py"]