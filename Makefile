.PHONY: install dev-frontend dev-backend lint test build check clean docker-up docker-down docker-logs docker-check docker-prod docker-prod-down

install:
	cd frontend && npm ci
	cd backend && uv sync --all-groups

dev-frontend:
	cd frontend && npm run dev

dev-backend:
	cd backend && uv run fastapi dev src/genesis_api/main.py

lint:
	cd frontend && npm run lint && npm run typecheck
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy src

test:
	cd frontend && npm run test:run
	cd backend && uv run pytest

build:
	cd frontend && npm run build
	cd backend && uv build

check: lint test build

docker-up:
	docker compose up --build

docker-down:
	docker compose down

docker-logs:
	docker compose logs --follow

docker-check:
	docker compose run --rm frontend npm run lint
	docker compose run --rm frontend npm run typecheck
	docker compose run --rm frontend npm run test:run
	docker compose run --rm backend ruff check .
	docker compose run --rm backend ruff format --check .
	docker compose run --rm backend mypy src tests
	docker compose run --rm backend pytest

docker-prod:
	docker compose -f compose.prod.yml up --build

docker-prod-down:
	docker compose -f compose.prod.yml down

clean:
	find frontend backend -type d \( -name __pycache__ -o -name .pytest_cache -o -name .mypy_cache -o -name .ruff_cache -o -name dist \) -prune -exec rm -rf {} +
