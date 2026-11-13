.PHONY: install dev-frontend dev-backend lint test build check clean docker-dev docker-up docker-down docker-logs docker-check docker-prod docker-prod-plan docker-prod-rebuild-backend docker-prod-trim docker-prod-clean docker-prod-restart docker-prod-down docker-prod-logs docker-prod-status

DEV_COMPOSE = docker compose --env-file .env.development -f compose.yml
PROD_COMPOSE = docker compose --env-file .env.production -f compose.prod.yml -f compose.monitoring.yml
PROD_BUILD_CACHE_SIZE ?= 2GB

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

docker-up: docker-dev

docker-dev:
	$(DEV_COMPOSE) up -d --no-build

docker-down:
	$(DEV_COMPOSE) down

docker-logs:
	$(DEV_COMPOSE) logs --follow

docker-check:
	$(DEV_COMPOSE) exec -T frontend npm run lint
	$(DEV_COMPOSE) exec -T frontend npm run typecheck
	$(DEV_COMPOSE) exec -T frontend npm run test:run
	$(DEV_COMPOSE) exec -T backend uv run ruff check .
	$(DEV_COMPOSE) exec -T backend uv run ruff format --check .
	$(DEV_COMPOSE) exec -T backend uv run mypy src tests
	$(DEV_COMPOSE) exec -T backend uv run pytest

docker-prod:
	python3 scripts/deploy-production.py

# 只展示变更范围，不启动容器、不编译或构建镜像。
docker-prod-plan:
	python3 scripts/deploy-production.py --plan

docker-prod-rebuild-backend:
	python3 scripts/deploy-production.py --rebuild-backend

# 日常部署保留有限缓存，兼容新版 Buildx 和旧版 builder 参数。
docker-prod-trim:
	@prune_help=$$(docker builder prune --help) || exit $$?; \
	case "$$prune_help" in \
	  *--max-used-space*) docker builder prune --all --force --max-used-space "$(PROD_BUILD_CACHE_SIZE)" ;; \
	  *--keep-storage*) docker builder prune --all --force --keep-storage "$(PROD_BUILD_CACHE_SIZE)" ;; \
	  *) printf '%s\n' '当前 Docker 不支持按容量清理缓存，请升级 Docker；未执行全量清理。' >&2; exit 1 ;; \
	esac
	docker image prune --force --filter 'label=cn.genesis.production=true'

# 构建缓存属于当前构建器；镜像仅清理本项目带标记且未被容器使用的悬空镜像。
docker-prod-clean:
	docker builder prune --all --force
	docker image prune --force --filter 'label=cn.genesis.production=true'

docker-prod-restart:
	$(PROD_COMPOSE) restart backend frontend

docker-prod-down:
	$(PROD_COMPOSE) down

docker-prod-logs:
	$(PROD_COMPOSE) logs --follow

docker-prod-status:
	$(PROD_COMPOSE) ps

clean:
	find frontend backend -type d \( -name __pycache__ -o -name .pytest_cache -o -name .mypy_cache -o -name .ruff_cache -o -name dist \) -prune -exec rm -rf {} +
