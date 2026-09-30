.PHONY: help dev build test up down logs migrate build-agent test-agent

help: ## Показать доступные команды
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-16s\033[0m %s\n", $$1, $$2}'

dev: ## Запустить dev-сервер (Express + Vite + PostgreSQL) на порту 3000
	npm run dev

build: ## Собрать production-бандл фронтенда
	npm run build

test: ## Запустить unit/integration-тесты валидации, шифрования и Linux Agent
	node --experimental-strip-types --test src/lib/validation.test.ts tests/agent.test.ts

build-agent: ## Собрать Go-демон Linux Agent (infralab-agent)
	cd agent && go build -o bin/infralab-agent ./cmd/infralab-agent

test-agent: ## Запустить Go unit/integration тесты для Linux Agent
	cd agent && go test -v ./...

up: ## Поднять стек через Docker Compose (PostgreSQL + Backend + Frontend)
	docker compose up -d --build


down: ## Остановить контейнеры Docker Compose
	docker compose down

logs: ## Просмотр логов контейнеров
	docker compose logs -f

migrate: ## Применить SQL-миграции к локальной БД PostgreSQL
	psql "$$DATABASE_URL" -f migrations/001_create_servers.up.sql
