# InfraLab — Аудит ошибок и стабильности (Bug Audit Report)

Дата аудита: 2026-09-30  
Режим: **SAFE DEBUG / QA** (`DIAGNOSE → REPRODUCE → IDENTIFY ROOT CAUSE → MINIMAL FIX → REGRESSION TEST → CHECK → SMOKE TEST`)

---

## BUG-001

- **Component:** Agent Lifecycle & Prometheus Service Discovery (`src/db/agents.ts`)
- **Severity:** HIGH
- **How to reproduce:**
  1. Привязать агента к серверу (`enrollAgentWithToken` или `provisionAgentDirectlyForServer`).
  2. Остановить агента через кнопку «Выключить агент» (`stopServerAgent(serverId)`), что устанавливает `version = 'stopped'` и `lastSeenAt = null`.
  3. Вызвать `GET /api/prometheus/targets` или отправить запоздавший запрос `recordAgentSystemInfo` без поля `version`.
- **Expected:**
  - Остановленный агент (`version === 'stopped'`) должен иметь статус `OFFLINE`, не должен возвращаться в списке активных целей `/api/prometheus/targets` для опроса Prometheus и должен игнорировать запоздавшие фоновые пакеты `heartbeat` / `system-info` до явного повторного запуска или перепривязки.
- **Actual:**
  - `listPrometheusAgentTargets()` включает остановленные агенты в список целей Prometheus SD.
  - ` computeAgentStatus()` не учитывает `version === 'stopped'`, а `recordAgentHeartbeat()` / `recordAgentSystemInfo()` перезаписывают `lastSeenAt` для остановленного агента, возвращая его в состояние `ONLINE` и возобновляя фоновый опрос.
- **Root cause:**
  - В `computeAgentStatus()`, `recordAgentHeartbeat()`, `recordAgentSystemInfo()` и `listPrometheusAgentTargets()` отсутствует проверка состояния `version === 'stopped'`.
- **Affected files:**
  - `src/db/agents.ts`
  - `tests/agent.test.ts`
- **Suggested minimal fix:**
  - Учитывать флаг `version === 'stopped'` в `computeAgentStatus`, исключать остановленные агенты из `listPrometheusAgentTargets` и блокировать обновление `lastSeenAt` в `recordAgentHeartbeat` / `recordAgentSystemInfo`, если агент помечен как `'stopped'` (пока не передана явная новая версия при переустановке/перезапуске).
- **Status:** FIXED (добавлен регрессионный тест в `tests/agent.test.ts`).

---

## BUG-002

- **Component:** Test Suite Configuration (`package.json`)
- **Severity:** MEDIUM
- **How to reproduce:**
  1. Запустить `npm test`.
  2. Проверить список выполняемых тестовых файлов в выводе TAP.
- **Expected:**
  - Все тестовые файлы проекта (`src/lib/validation.test.ts`, `tests/agent.test.ts`, `tests/localAuth.test.ts`) должны выполняться при запуске `npm test` и `make check`.
- **Actual:**
  - Выполняются только 2 файла (`src/lib/validation.test.ts` и `tests/agent.test.ts`), а тесты локальной авторизации, JWT и 2FA TOTP (`tests/localAuth.test.ts`) пропускаются.
- **Root cause:**
  - В `package.json` скрипт `"test"` содержал жёстко заданный неполный список файлов.
- **Affected files:**
  - `package.json`
- **Suggested minimal fix:**
  - Включить `tests/localAuth.test.ts` в скрипт `"test"` в `package.json`.
- **Status:** FIXED.

---

## BUG-003

- **Component:** Build & Migration Automation (`Makefile`)
- **Severity:** MEDIUM
- **How to reproduce:**
  1. Выполнить `make migrate` с настроенным `DATABASE_URL`.
- **Expected:**
  - Последовательное применение SQL-миграций из папки `migrations/*.up.sql`.
- **Actual:**
  - Ошибка `migrations/001_create_servers.up.sql: No such file or directory`.
- **Root cause:**
  - В `Makefile` было указано устаревшее имя файла `migrations/001_create_servers.up.sql` вместо фактических файлов `migrations/000001_create_servers_table.up.sql` .. `000004_local_auth_and_2fa.up.sql`.
- **Affected files:**
  - `Makefile`
- **Suggested minimal fix:**
  - Обновить цель `migrate` в `Makefile` для итерации по `migrations/*.up.sql`, а также добавить цели `check` и `smoke`.
- **Status:** FIXED.

---

## BUG-004

- **Component:** Go Agent HTTP Client & Metrics Server (`agent/cmd/infralab-agent/main.go`, `agent/internal/client/client.go`)
- **Severity:** MEDIUM
- **How to reproduce:**
  1. Запустить Go-агент `infralab-agent` с экспозицией `/metrics` на `:9101`.
  2. Открыть медленное TCP-соединение без отправки заголовков или вернуть большой HTML-ответ от промежуточного прокси при ошибке Backend.
- **Expected:**
  - HTTP-сервер метрик агента должен иметь `ReadHeaderTimeout` и `ReadTimeout`, а HTTP-клиент агента должен ограничивать размер считываемого в память тела ответа (`io.LimitReader`).
- **Actual:**
  - Используется `http.ListenAndServe(*metricsAddr, mux)` без таймаутов и `io.ReadAll(resp.Body)` без ограничения размера буфера.
- **Root cause:**
  - Отсутствие конфигурации `http.Server` таймаутов и `io.LimitReader` при чтении тела ответа.
- **Affected files:**
  - `agent/cmd/infralab-agent/main.go`
  - `agent/internal/client/client.go`
- **Suggested minimal fix:**
  - Заменить `http.ListenAndServe` на `&http.Server{Addr: *metricsAddr, Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second}` и обернуть чтение ошибок в `io.LimitReader(resp.Body, 64*1024)`.
- **Status:** FIXED.

---

## BUG-005

- **Component:** Go Backend HTTP Server & Database Pool (`backend/cmd/api/main.go`, `backend/internal/database/postgres.go`)
- **Severity:** MEDIUM
- **How to reproduce:**
  1. Запустить Go-бэкенд `backend/cmd/api/main.go` под нагрузкой или при нестабильном соединении с PostgreSQL.
- **Expected:**
  - `http.Server` защищён `ReadHeaderTimeout`, а пул `sql.DB` имеет ограничение на открытые/idle соединения и таймаут `PingContext`.
- **Actual:**
  - `ReadHeaderTimeout` не задан; `sql.Open("postgres", dsn)` не настраивает лимиты пула соединений и вызывает `db.PingContext(ctx)` без собственного таймаута.
- **Root cause:**
  - Использование дефолтных неограниченных настроек `database/sql` в `backend/internal/database/postgres.go`.
- **Affected files:**
  - `backend/cmd/api/main.go`
  - `backend/internal/database/postgres.go`
- **Suggested minimal fix:**
  - Добавить `ReadHeaderTimeout: 5 * time.Second` в `backend/cmd/api/main.go` и настроить `SetMaxOpenConns(25)`, `SetMaxIdleConns(10)`, `SetConnMaxLifetime(5 * time.Minute)` и 5-секундный `context.WithTimeout` для `PingContext` в `backend/internal/database/postgres.go`.
- **Status:** FIXED.

---

## BUG-006

- **Component:** SSH Command Execution Buffer (`src/server/sshConnector.ts`)
- **Severity:** LOW
- **How to reproduce:**
  1. Выполнить через `executeSshCommand` команду, генерирующую очень большой поток вывода (десятки мегабайт в `stdout` или `stderr`).
- **Expected:**
  - Буферы `stdout` и `stderr` должны быть ограничены безопасным лимитом (например, 4 МБ), чтобы предотвратить исчерпание памяти процесса Node.js (OOM).
- **Actual:**
  - `stdout += data.toString('utf8')` и `stderr += data.toString('utf8')` конкатенируют строки без верхнего предела до срабатывания таймаута.
- **Root cause:**
  - Отсутствие проверки максимальной длины буфера в обработчиках `stream.on('data')` и `stream.stderr.on('data')`.
- **Affected files:**
  - `src/server/sshConnector.ts`
- **Suggested minimal fix:**
  - Ограничить накопление `stdout` и `stderr` в `executeRealSshCommand` безопасным порогом (`MAX_SSH_OUTPUT_BYTES = 4 * 1024 * 1024`).
- **Status:** FIXED.

---

## BUG-007

- **Component:** Prometheus Exporter Scraping & Agent Heartbeat Synchronization (`src/server/prometheusClient.ts`, `src/db/agents.ts`, `server.ts`)
- **Severity:** HIGH
- **How to reproduce:**
  1. На сервере (`server#2`, `144.31.192.206`) запущен `infralab-agent`, отдающий метрики по прямому HTTP `http://144.31.192.206:9101/metrics` (`200 OK`).
  2. Вызвать `GET /api/servers/2/metrics` или `GET /api/servers/2/agent?passive=true` или выполнить `make check`.
- **Expected:**
  - При успешном прямом HTTP-опросе `http://<ip>:9101/metrics` для активного (не остановленного) агента поле `last_seen_at` и `uptime_seconds` в таблице `agents` должны обновляться, поддерживая статус агента `ONLINE` и не перезаписывая `cpu_count` фиктивным значением.
  - При перезапуске остановленного агента по SSH (`provisionAgentDirectlyForServer`) его существующий `agent_id` (`agt_...`) должен сохраняться.
- **Actual:**
  - В `scrapeLiveHostPrometheusExporter()` ветка прямого HTTP-опроса `:9101/metrics` возвращала результат без вызова `recordAgentHeartbeat()`, тогда как обновление БД выполнялось только в резервной SSH-ветке (которая не вызывалась при доступном порте 9101 и при этом перезаписывала `cpuCount: 2`). В результате живой агент на `server#2` отображался в БД и `make check` как `OFFLINE`.
- **Root cause:**
  - Отсутствие вызова `recordAgentHeartbeat()` при успешном прямом HTTP-скрапинге `:9101/metrics` в `src/server/prometheusClient.ts` и `GET /api/servers/:id/agent` в `server.ts`.
- **Affected files:**
  - `src/server/prometheusClient.ts`
  - `src/db/agents.ts`
  - `server.ts`
  - `tests/agent.test.ts`
- **Suggested minimal fix:**
  - Вызывать `recordAgentHeartbeat` при успешном скрапинге `:9101/metrics` (как по прямому HTTP, так и через SSH fallback), проверять `:9101/metrics` в `GET /api/servers/:id/agent` и сохранять существующий `agent_id` при перезапуске агента в `provisionAgentDirectlyForServer`.
- **Status:** FIXED (добавлен регрессионный тест в `tests/agent.test.ts`).

---

## BUG-008

- **Component:** Monitoring / Prometheus Page — Кнопка «Обновить PromQL» и каскадная инвалидация TanStack Query (`src/hooks/useServers.ts`, `src/pages/MetricsPage.tsx`, `src/pages/ServerMonitoringPage.tsx`)
- **Severity:** HIGH
- **How to reproduce:**
  1. Открыть страницу `Metrics & Prometheus Telemetry` (`/metrics`) или `/servers/:id/monitoring`.
  2. Не нажимать никаких кнопок и наблюдать за кнопкой «Обновить PromQL» и вкладкой Network.
- **Expected:**
  - После начальной загрузки запросы завершаются, кнопка «Обновить PromQL» находится в состоянии покоя (`idle`) и переходит в состояние вращения/загрузки только при ручном клике пользователя (1 клик → 1 запрос → `idle`).
- **Actual:**
  - Кнопка «Обновить PromQL» постоянно мигала и вращалась каждые ~750 мс, а в Network непрерывно отправлялись запросы `/api/servers/2/telemetry`, `/api/servers/2/metrics`, `/api/servers` и `/api/servers/2/agent`.
- **Root cause:**
  - В `useServerTelemetry` (`src/hooks/useServers.ts:133`) внутри `queryFn` вызывался `queryClient.invalidateQueries({ queryKey: ['servers'] })` без `exact: true`. В TanStack Query v5 префиксное совпадение по ключу `['servers']` инвалидировало все активные запросы с префиксом `'servers'`, включая сам `['servers', id, 'telemetry']` и `['servers', id, 'monitoring', range]`. Кроме того, кнопка «Обновить PromQL» была привязана к общему флагу `isFetchingMonitoring` вместо выделенного состояния ручного обновления.
- **Affected files:**
  - `src/hooks/useServers.ts`
  - `src/pages/MetricsPage.tsx`
  - `src/pages/ServerMonitoringPage.tsx`
- **Suggested minimal fix:**
  - Заменить `queryClient.invalidateQueries({ queryKey: ['servers'] })` внутри `useServerTelemetry` на точечное обновление кэша `queryClient.setQueryData<Server[]>(['servers'], ...)` и привязать индикатор вращения кнопки «Обновить PromQL» к явному действию пользователя (`handleRefreshPromQL`).
- **Status:** FIXED (добавлен регрессионный тест в `tests/monitoring.test.ts`).

---

## BUG-009

- **Component:** Monitoring / Prometheus Time Range Switching `1h / 6h / 24h / 7d` (`src/server/prometheusClient.ts`, `src/db/servers.ts`, `src/hooks/useServers.ts`, `src/api/servers.ts`, `src/pages/ServerMonitoringPage.tsx`)
- **Severity:** HIGH
- **How to reproduce:**
  1. На странице Monitoring переключать диапазоны `1h → 6h → 24h → 7d` (в том числе быстро подряд).
  2. Сравнить точки графиков (`series`), временные метки первой/последней точки и подписи оси X.
- **Expected:**
  - Каждый диапазон (`1h`, `6h`, `24h`, `7d`) формирует временной ряд строго для своего окна `[now - duration, now]` и шага (`120s`, `600s`, `1800s`, `10800s`), точки `ringPoints` и `server_metrics` сопоставляются по принадлежности к временному бакету `[tsSec - step/2, tsSec + step/2]`, а при быстром переключении устаревшие HTTP-запросы отменяются через `AbortSignal`.
- **Actual:**
  - В `fetchServerMonitoringMetrics` (`src/server/prometheusClient.ts`) массивы `ringPoints` (точки за последние 1–2 минуты) и `dbRows` (`LIMIT N` последних записей БД) сопоставлялись с шагами графика по индексу массива `i` (`ringPoints[ringPoints.length - 1 - i]`), игнорируя реальные `timestamp` точек. В результате последние 30+ точек из окна `1h` без изменений подставлялись в графики `6h`, `24h` и `7d`. На оси X для `24h` обрезалась дата (`slice(11, 16)`), из-за чего `now - 24h` и `now` выглядели одинаково.
- **Root cause:**
  - Индексное сопоставление `ringPoints`/`dbRows` вместо сопоставления по `timestamp` бакета в `src/server/prometheusClient.ts`, отсутствие выборки по временному окну `listServerMetricsInRange` в `src/db/servers.ts` и отсутствие проброса `AbortSignal` из `useServerMonitoring` в `fetchServerMonitoring`.
- **Affected files:**
  - `src/server/prometheusClient.ts`
  - `src/db/servers.ts`
  - `src/hooks/useServers.ts`
  - `src/api/servers.ts`
  - `src/pages/ServerMonitoringPage.tsx`
  - `src/pages/MetricsPage.tsx`
- **Suggested minimal fix:**
  - Сопоставлять `ringPoints` и `dbRows` строго по попаданию их `timestamp` в интервал `[tsSec - stepSeconds/2, tsSec + stepSeconds/2]`, пробрасывать `AbortSignal` из TanStack Query в `fetchServerMonitoring`, не размонтировать панель диапазонов во время подгрузки и отображать дату+время на оси X для `24h` и `7d`.
- **Status:** FIXED (добавлен регрессионный тест в `tests/monitoring.test.ts`).

---

## Проблемы, требующие отдельной архитектурной задачи (Не изменялись на этапе SAFE DEBUG / QA)

1. **Прямой HTTP Push от агента в закрытом окружении AI Studio Preview**:
   - В preview-среде внешние запросы без авторизационной куки Google перехватываются прокси-сервером среды, поэтому агент на внешнем VPS не может напрямую достучаться до `POST /api/agents/heartbeat` без SSH-туннеля или публичного деплоя контейнера. Сейчас это компенсируется безопасным опросом `:9101/metrics` через SSH. Для полноценного push-режима требуется деплой на внешний домен (`docker compose up -d`) или автоматический reverse SSH tunnel (`ssh -R`).
2. **Хранение долгосрочных метрик (Long-term TSDB Retention)**:
   - Встроенное хранилище в памяти и таблица `server_metrics` в PostgreSQL рассчитаны на оперативную диагностику. При подключении десятков серверов рекомендуется использовать выделенный инстанс Prometheus / VictoriaMetrics из `docker-compose.yml`.
