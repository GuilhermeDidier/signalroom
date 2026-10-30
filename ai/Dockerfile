# Signalroom ai service: FastAPI + fastembed (ONNX) + psycopg.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    FASTEMBED_CACHE_PATH=/opt/fastembed \
    PATH="/opt/venv/bin:$PATH"

COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project && rm -rf /root/.cache

# Bake the embedding model into the image so cold starts never download it.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5', cache_dir='/opt/fastembed')"

COPY signalroom_ai ./signalroom_ai

RUN useradd --system --uid 10001 app && chown -R app /opt/fastembed
USER app

# The model is local; never reach out to the Hugging Face Hub at runtime.
ENV HF_HUB_OFFLINE=1 EMBED_THREADS=1 PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn signalroom_ai.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --no-access-log --proxy-headers"]
