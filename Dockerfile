# Beleth agent — resident runner image.
# Paper trading only, outbound-only: no ports are exposed and the agent runs no server.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Short commit the image was built from (compose passes it in). Read by
# app/hostinfo.collect_host_metrics for the backoffice Host panel; empty in a bare build.
ARG GIT_SHA=""
ENV BELETH_GIT_SHA=${GIT_SHA}

WORKDIR /app

# Runtime dependencies only, pinned via requirements.txt generated from uv.lock with:
#   uv export --frozen --no-dev --no-emit-project -o requirements.txt
# Regenerate it whenever uv.lock changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Strategy code and the config/docs files the runtime reads (docs/strategy.md is injected
# into the LLM system prompt; strategy.yaml and macro_events.yaml drive every cycle).
COPY app ./app
COPY scripts ./scripts
COPY config ./config
COPY docs ./docs

# Writable directory for the mirrored diagnostic log. compose.yaml mounts a named
# volume here so the stream survives a container recreation; a bare `docker run` still
# gets a working (ephemeral) log dir.
RUN mkdir -p /app/logs

# Non-root user; secrets are NOT baked in — they arrive via environment at runtime
# (docker compose env_file / docker run --env-file).
RUN useradd --create-home --uid 1000 beleth && chown -R beleth:beleth /app
USER beleth

CMD ["/usr/local/bin/python", "scripts/run_agent.py"]