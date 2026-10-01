# InfraLab — Финальный отчёт SAFE DEBUG / QA и E2E-проверки

**Дата проверки:** 2026-09-30  
**Режим:** `SAFE DEBUG / QA` (`DIAGNOSE → REPRODUCE → ROOT CAUSE → MINIMAL FIX → REGRESSION TEST → make check → make smoke`)

---

## 1. Environment

* **Go:** `PASS` — установлен и настроен `go1.22.5 linux/amd64` (`/usr/local/go/bin/go`); модули `backend/` и `agent/` успешно проходят `go vet ./...`, `go test ./...` и `go build ./...`. На удалённый хост (`144.31.192.206`) устанавливать Go **не требуется**.
* **Docker:** `PASS` — манифест `docker-compose.yml` валиден; на подключённом Linux-хосте `server#2` (`144.31.192.206`) демон Docker `v29.1.3` активен (`ONLINE`) и обслуживает 2 рабочих контейнера (`amnezia-awg`, `amnezia-awg2`).
* **PostgreSQL:** `PASS` — база данных доступна (`SELECT 1` -> `ok`), проверены все таблицы (`users`, `servers`, `agents`, `server_metrics`, `ssh_command_logs`) и 7 SQL-миграций в `migrations/`.
* **Prometheus:** `PASS` — динамическое обнаружение целей HTTP Service Discovery (`GET /api/prometheus/targets`) возвращает активный таргет `144.31.192.206:9101`, а экспортер `http://144.31.192.206:9101/metrics` отвечает `200 OK` с валидными метриками CPU, Memory, Disk, Network и Uptime.

---

## 2. Checks

* **`make check`:** `19 PASS / 0 WARNING / 0 FAILED`
  * `[PASS] [Backend] TypeScript compilation (tsc --noEmit) — Zero type errors`
  * `[PASS] [Backend] Backend unit & integration tests (npm test) — All test suites passed`
  * `[PASS] [Backend] Go backend (go vet, go test, go build) — backend/... passed`
  * `[PASS] [Backend] Go agent (go vet, go test, go build) — agent/... passed`
  * `[PASS] [Frontend] Production Vite build (npm run build) — dist/index.html & assets built successfully`
  * `[PASS] [Database] PostgreSQL connectivity (SELECT 1) — Connected to PostgreSQL`
  * `[PASS] [Database] Database schema & tables — Verified tables: users, servers, agents, server_metrics, ssh_command_logs`
  * `[PASS] [Database] Migration SQL files (migrations/) — Found 7 SQL migration files`
  * `[PASS] [Docker] docker-compose.yml manifest — docker-compose.yml present with postgres, prometheus, infralab service definitions`
  * `[PASS] [Docker] Host Docker Engine (/api/servers/2/docker) — Docker v29.1.3 ONLINE (2 running container(s))`
  * `[PASS] [Prometheus] prometheus/prometheus.yml configuration — Configured with HTTP SD (/api/prometheus/targets)`
  * `[PASS] [Prometheus] HTTP Service Discovery (/api/prometheus/targets) — 200 OK — 1 active scrape target(s) registered`
  * `[PASS] [Prometheus] Active Target Health & Exporter (http://144.31.192.206:9101/metrics) — 200 OK — CPU, Memory, Disk, Network & Uptime metrics verified`
  * `[PASS] [API] GET /api/health — 200 OK (status=ok)`
  * `[PASS] [API] GET /api/ready — 200 OK (database=ok, prometheus=ok)`
  * `[PASS] [API] GET /api/servers — 200 OK (1 server(s) returned)`
  * `[PASS] [API] GET /api/servers/2/agent — 200 OK (status=ONLINE)`
  * `[PASS] [API] GET /api/servers/2/metrics — 200 OK (source=prometheus, series=30 pts)`
  * `[PASS] [Agent] Agent status & heartbeat — 1 agent(s) ONLINE — server#2 (agt_9ea75b8ad2f1cc014e4aed59): ONLINE`
* **`make smoke`:** `7/7 PASS`
  * `[SMOKE 1/7] PASS — Backend is reachable (GET /api/health -> 200 OK)`
  * `[SMOKE 2/7] PASS — Database is available and ready (GET /api/ready -> 200 OK)`
  * `[SMOKE 3/7] PASS — API & Servers endpoint operational (1 server(s))`
  * `[SMOKE 4/7] PASS — Server Detail API works (server #2)`
  * `[SMOKE 5/7] PASS — Agent API & Prometheus SD operational (1 target(s))`
  * `[SMOKE 6/7] PASS — Monitoring endpoint responds (source=prometheus, points=30)`
  * `[SMOKE 7/7] PASS — Frontend production build succeeded (dist/index.html)`
* **Go tests:** `PASS` — все тесты в `backend/...` (`internal/http`, `internal/servers`) и `agent/...` (`cmd/infralab-agent`, `internal/client`, `internal/config`, `internal/identity`, `internal/metrics`, `internal/system`) прошли успешно.
* **Go vet & build:** `PASS` — `go vet ./...` и `go build ./...` в `backend/` и `agent/` завершились с кодом `0`.
* **Docker:** `PASS` — статическая проверка `docker-compose.yml` (`PASS`) и живая проверка Docker Engine `v29.1.3` на `server#2` через `GET /api/servers/2/docker` (`PASS`, 2 контейнера `running`).

---

## 3. Agent E2E Lifecycle

Проверен полный жизненный цикл (`Server → enrollment → Agent start → heartbeat → system info → Prometheus target → metrics → Agent stop → OFFLINE → Agent restart → reconnect → ONLINE`):

* **Enrollment:** `PASS` — генерация и ротация одноразового токена `ila_enroll_...`, привязка через `POST /api/agents/enroll`, выдача постоянного `agent_id` (`agt_...`) и секрета `credential` (`ila_cred_...`), немедленная инвалидация одноразового токена при повторном использовании.
* **Heartbeat:** `PASS` — `POST /api/agents/heartbeat` и прямой опрос экспортера `:9101/metrics` обновляют `last_seen_at` и поддерживают статус `ONLINE`.
* **System info:** `PASS` — сохранение и обновление `hostname`, `os_distribution` (`Ubuntu 24.04.4 LTS`), `kernel` (`6.8.0-124-generic`), `architecture` (`x86_64`), `cpu_count` (`1`), `ram_total_bytes` (`1008193536`), `uptime_seconds`.
* **Prometheus:** `PASS` — зарегистрированный агент автоматически появляется в `GET /api/prometheus/targets` (`144.31.192.206:9101`) и отдаёт метрики в формате Prometheus exposition format на `:9101/metrics`.
* **Stop:** `PASS` — `POST /api/servers/2/agent/stop` останавливает службу на сервере по SSH, очищает кэш метрик и устанавливает `version = 'stopped'`, `last_seen_at = null`.
* **Offline (BUG-001):** `PASS` — после остановки статус агента переходит в `OFFLINE`, сервер исключается из `/api/prometheus/targets`, а запоздавшие вызовы `recordAgentHeartbeat` и `recordAgentSystemInfo` не возвращают остановленный агент в `ONLINE`.
* **Restart:** `PASS` — повторный запуск через `POST /api/servers/2/agent/install-ssh` (`provisionAgentDirectlyForServer`) перезапускает демон на сервере и сохраняет прежний `agent_id` (`agt_9ea75b8ad2f1cc014e4aed59`).
* **Reconnect:** `PASS` — после перезапуска агент возвращается в статус `ONLINE`, таргет `144.31.192.206:9101` снова появляется в `/api/prometheus/targets`, а `GET /api/servers/2/metrics` возвращает живые метрики.

---

## 4. Prometheus, API & Frontend Verification

* **Prometheus Metrics (`http://144.31.192.206:9101/metrics` & `GET /api/servers/2/metrics`):**
  * `infralab_cpu_usage_ratio` / `current_cpu_percent` — `PASS`
  * `infralab_memory_total_bytes` & `infralab_memory_available_bytes` / `current_memory_percent` — `PASS`
  * `infralab_filesystem_size_bytes` & `infralab_filesystem_avail_bytes` / `current_disk_percent` — `PASS`
  * `infralab_network_receive_bytes_total` & `infralab_network_transmit_bytes_total` / `current_rx_kbps`, `current_tx_kbps` — `PASS`
  * `infralab_uptime_seconds` & `infralab_load1/load5/load15` — `PASS`
* **API Endpoints & Error Codes:**
  * `GET /api/health` -> `200 OK`
  * `GET /api/ready` -> `200 OK` (`database: "ok"`, `prometheus: "ok"`)
  * `GET /api/servers` -> `200 OK` (с авторизацией) / `401 Unauthorized` (без токена)
  * `GET /api/servers/2` -> `200 OK` / `GET /api/servers/abc` -> `400 Bad Request` / `GET /api/servers/999999` -> `404 Not Found`
  * `GET /api/servers/2/agent` -> `200 OK` (`status: "ONLINE"`)
  * `GET /api/servers/2/metrics?range=1h` -> `200 OK` (`source: "prometheus"`, `30` точек)
  * `GET /api/prometheus/targets` -> `200 OK`
* **Frontend Pages (`loading` / `success` / `empty` / `error`):**
  * Проверены страницы `Dashboard`, `Servers`, `Server Details`, `Agent`, `Monitoring`, `Logs`, `Docker` (`Containers`).

---

## 5. Реестр найденных и исправленных багов

### BUG-001 (HIGH) — Остановленный агент оставался в Prometheus SD и оживал от запоздавших пакетов
* **Файлы:** `src/db/agents.ts`, `tests/agent.test.ts`
* **Причина:** В `computeAgentStatus()`, `recordAgentHeartbeat()`, `recordAgentSystemInfo()` и `listPrometheusAgentTargets()` не проверялся флаг `version === 'stopped'`.
* **Исправление:** Добавлена проверка `version === 'stopped'`, исключение остановленных агентов из `/api/prometheus/targets` и игнорирование запоздавших `heartbeat` / `system-info` до явного перезапуска.

### BUG-002 (MEDIUM) — Пропуск тестов локальной авторизации и 2FA в `npm test`
* **Файлы:** `package.json`
* **Причина:** В скрипте `"test"` отсутствовал файл `tests/localAuth.test.ts`.
* **Исправление:** `tests/localAuth.test.ts` добавлен в тестовый раннер `npm test`.

### BUG-003 (MEDIUM) — Некорректный путь миграций в `Makefile`
* **Файлы:** `Makefile`
* **Причина:** Цель `migrate` ссылалась на несуществующий файл `migrations/001_create_servers.up.sql`.
* **Исправление:** Обновлена итерация по `migrations/*.up.sql`, добавлены цели `make check` и `make smoke`.

### BUG-004 (MEDIUM) — Отсутствие таймаутов HTTP-сервера и `io.LimitReader` в Go-агенте
* **Файлы:** `agent/cmd/infralab-agent/main.go`, `agent/internal/client/client.go`
* **Причина:** Использование `http.ListenAndServe` без `ReadHeaderTimeout`/`ReadTimeout` и `io.ReadAll` без ограничения размера ответа.
* **Исправление:** Настроен `http.Server` с таймаутами и `io.LimitReader(resp.Body, 64*1024)`.

### BUG-005 (MEDIUM) — Отсутствие `ReadHeaderTimeout` и лимитов пула БД в Go-бэкенде
* **Файлы:** `backend/cmd/api/main.go`, `backend/internal/database/postgres.go`
* **Причина:** Использование дефолтных настроек `sql.DB` и `http.Server` без `ReadHeaderTimeout`.
* **Исправление:** Заданы `ReadHeaderTimeout: 5 * time.Second`, `SetMaxOpenConns(25)`, `SetMaxIdleConns(10)`, `SetConnMaxLifetime(5 * time.Minute)` и таймаут `PingContext`.

### BUG-006 (LOW) — Неограниченная буферизация `stdout`/`stderr` в SSH-клиенте
* **Файлы:** `src/server/sshConnector.ts`
* **Причина:** Отсутствие верхнего предела размера буфера при чтении потока SSH-команды.
* **Исправление:** Добавлено ограничение `MAX_SSH_OUTPUT_BYTES = 4 * 1024 * 1024`.

### BUG-007 (HIGH) — Прямой HTTP-скрапинг `:9101/metrics` не обновлял `last_seen_at` агента в PostgreSQL
* **Файлы:** `src/server/prometheusClient.ts`, `src/db/agents.ts`, `server.ts`, `tests/agent.test.ts`
* **Причина:** При успешном прямом HTTP-опросе `http://<ip>:9101/metrics` функция `scrapeLiveHostPrometheusExporter` возвращала метрики без вызова `recordAgentHeartbeat()` (обновление выполнялось только в резервной SSH-ветке, где также перезаписывался `cpuCount: 2`), из-за чего работающий агент на `server#2` числился в БД как `OFFLINE`. Кроме того, `provisionAgentDirectlyForServer` при перезапуске генерировал новый `agent_id`.
* **Исправление:** Добавлен вызов `recordAgentHeartbeat` при успешном скрапинге `:9101/metrics` (как по прямому HTTP, так и по SSH), добавлена быстрая проверка `:9101/metrics` в `GET /api/servers/:id/agent` и сохранение существующего `agent_id` при перезапуске агента.
