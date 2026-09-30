.PHONY: help dev build test check smoke up down logs migrate build-agent test-agent

help: ## Показать доступные команды
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-16s\033[0m %s\n", $$1, $$2}'

dev: ## Запустить dev-сервер (Express + Vite + PostgreSQL) на порту 3000
	npm run dev

build: ## Собрать production-бандл фронтенда
	npm run build

test: ## Запустить unit/integration-тесты валидации, шифрования, авторизации и Linux Agent
	npm test

check: ## Выполнить полную безопасную read-only диагностику проекта (Backend, Frontend, DB, Docker, Prometheus, Agent, API)
	npm run check

smoke: ## Выполнить сквозной smoke-тест работающего приложения без изменения данных
	npm run smoke

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
	for f in migrations/*.up.sql; do psql "$$DATABASE_URL" -f "$$f"; done
