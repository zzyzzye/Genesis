FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/python:3.12-slim-bookworm AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app

RUN pip install --no-cache-dir \
    --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
    uv==0.9.22

COPY pyproject.toml uv.lock README.md ./

FROM base AS development

RUN uv sync --locked --no-install-project

COPY alembic.ini ./
COPY alembic ./alembic
COPY src ./src
COPY tests ./tests

RUN uv sync --locked

EXPOSE 8000

CMD ["fastapi", "dev", "src/genesis_api/main.py", "--host", "0.0.0.0", "--port", "8000"]

FROM base AS production-builder

RUN uv sync --locked --no-dev --no-install-project

COPY alembic.ini ./
COPY alembic ./alembic
COPY src ./src

RUN uv sync --locked --no-dev --no-editable

FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/python:3.12-slim-bookworm AS production

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /nonexistent --shell /usr/sbin/nologin app

WORKDIR /app

COPY --from=production-builder /opt/venv /opt/venv
COPY --from=production-builder /app/alembic.ini ./
COPY --from=production-builder /app/alembic ./alembic

USER app

EXPOSE 8000

CMD ["uvicorn", "genesis_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
