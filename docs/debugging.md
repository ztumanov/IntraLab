# InfraLab — Руководство по отладке и диагностике (Debugging & QA Guide)

Этот документ описывает текущую архитектуру **InfraLab**, маршруты прохождения данных между компонентами, точки диагностики и стандартные команды проверки (`make check` и `make smoke`).

---

## 1. Архитектура и потоки данных

InfraLab поддерживает работу как в контейнерном production-окружении (`docker-compose.yml` с Traefik, PostgreSQL и Prometheus), так и в едином full-stack runtime (`server.ts` — Express + Vite + WebSocket SSH + встроенный скрейпер метрик).

### Поток 1: Браузер → Traefik → Backend → PostgreSQL

```text
Browser (React 19 + TanStack Query)
  │
  ▼  HTTP / HTTPS (:80 / :3000) + WebSocket (/api/ws/terminal)
Traefik Reverse Proxy (в Docker) / Express HTTP Server (server.ts)
  │
  ├──► GET /api/health          (проверка жизни процесса Backend, без внешних зависимостей)
  ├──► GET /api/ready           (проверка готовности: PostgreSQL + Prometheus)
  ├──► /api/auth/*              (локальная авторизация JWT + TOTP 2FA)
  ├──► /api/servers/*           (управление серверами, SSH, Docker, SFTP, логи)
  │
  ▼  TCP (:5432, pg Pool / Drizzle ORM)
PostgreSQL 16
  ├── users                     (учётные записи, хэши паролей scrypt, 2FA секреты)
  ├── servers                   (инвентарь серверов, зашифрованные AES-256-GCM SSH секреты)
  ├── agents                    (зарегистрированные агенты, токены привязки, last_seen_at)
  ├── server_metrics            (исторические срезы телеметрии CPU/RAM/Disk/Net)
  └── ssh_command_logs          (журнал выполненных SSH-команд и кодов возврата)
```

**Точки диагностики:**
- **Frontend → Backend**: вкладка Network в браузере или `curl -i http://localhost:3000/api/health`.
- **Готовность БД и зависимостей**: `curl -i http://localhost:3000/api/ready`.
- **Миграции и схема БД**: автоматическая идемпотентная инициализация в `src/db/bootstrap.ts` и SQL-миграции в каталоге `migrations/`.

---

### Поток 2: Agent → Backend → Prometheus → Frontend

```text
Linux Host (infralab-agent :9101/metrics)
  │
  ├──► 1. Enrollment:   POST /api/agents/enroll       (обмен одноразового токена на agent_id)
  ├──► 2. System Info:  POST /api/agents/system-info  (CPU cores, RAM, Disk, OS, Kernel, Docker)
  ├──► 3. Heartbeat:    POST /api/agents/heartbeat    (каждые 15с обновление last_seen_at)
  │
  ▼
Backend (server.ts / src/db/agents.ts)
  │
  ├──► GET /api/prometheus/targets  (HTTP Service Discovery список активных агентов :9101)
  │
  ▼
Prometheus (:9090) / Built-in Exporter Scraper (src/server/prometheusClient.ts)
  │
  ├──► Опрос PromQL range-запросов (/api/v1/query_range) или прямое чтение :9101/metrics
  │
  ▼
GET /api/servers/:id/metrics?range=1h|6h|24h|7d
  │
  ▼
Frontend (/metrics и /servers/:id/monitoring)
```

**Точки диагностики:**
- **Статус агента на хосте**: `systemctl status infralab-agent` или `curl -s http://127.0.0.1:9101/metrics | head -n 20`.
- **Список целей для Prometheus SD**: `curl -s http://localhost:3000/api/prometheus/targets`.
- **Статус агента в БД**: `GET /api/servers/:id/agent` (возвращает `NOT INSTALLED`, `ONLINE` или `OFFLINE`, а также `version: "stopped"`, если агент принудительно остановлен пользователем).

---

### Поток 3: SSH → Server (Телеметрия, Команды, Терминал, SFTP)

```text
Backend (src/server/sshConnector.ts, wsTerminal.ts, sftpManager.ts)
  │
  ├──► Расшифровка секрета (AES-256-GCM через ENCRYPTION_KEY в памяти)
  │
  ▼  SSHv2 TCP (:22 или кастомный порт)
Target Linux Server
  ├──► Проверка связи и сбор метрик (/proc/stat, /proc/meminfo, df, ip -j)
  ├──► Выполнение команд (POST /api/servers/:id/exec)
  ├──► Интерактивный PTY-терминал (WebSocket /api/ws/terminal)
  └──► Файловый менеджер SFTP/SSH (/api/servers/:id/sftp/*)
```

**Точки диагностики:**
- **Проверка SSH-соединения**: `POST /api/servers/:id/check` — выполняет тестовое подключение, обновляет `servers.status` (`online` / `offline`) и записывает причину ошибки в `last_check_error`.
- **Таймауты**: `readyTimeout: 10000ms` на установку SSH-сессии и таймаут выполнения команды в `executeSshCommand`.

---

### Поток 4: Docker → Server

```text
Backend (src/server/sshConnector.ts -> inspectServerDocker)
  │
  ▼  SSH exec (docker info / docker ps / docker network ls / docker logs / docker run)
Target Linux Server (Docker Engine / systemd docker.service)
```

**Точки диагностики:**
- **Инспекция контейнеров**: `GET /api/servers/:id/docker`. Если демон Docker не установлен или остановлен, API возвращает `docker_installed: false` или `daemon_running: false` без падения запроса.
- **Логи контейнеров**: `GET /api/servers/:id/docker/containers/:containerId/logs?tail=120`.

---

## 2. Быстрая проверка состояния системы

### Единая диагностика (`make check`)

Команда выполняет безопасную read-only диагностику всех слоёв проекта без создания или изменения пользовательских данных:

```bash
make check
# или напрямую через npm:
npm run check
```

Что проверяется:
1. **Backend**: компиляция TypeScript (`tsc --noEmit`), запуск unit/integration тестов (`npm test`), проверка Go-пакетов (`backend/`, `agent/`), проверка `/api/health` и `/api/ready`.
2. **Frontend**: чистая сборка production-бандла (`vite build`).
3. **Database**: подключение к PostgreSQL (`SELECT 1`), наличие всех таблиц (`users`, `servers`, `agents`, `server_metrics`, `ssh_command_logs`) и файлов миграций в `migrations/`.
4. **Docker**: валидация `docker-compose.yml` и состояния контейнеров (если Docker CLI доступен в окружении).
5. **Prometheus**: валидация `prometheus/prometheus.yml`, проверка endpoint'а `/api/prometheus/targets` и доступности внешнего Prometheus (с выводом `WARNING`, если используется встроенный агентский скрейпер без отдельного контейнера Prometheus).
6. **Agent**: проверка зарегистрированных агентов и времени последнего heartbeat (если агенты не запущены или остановлены — выводится `WARNING`, не блокирующий сборку).
7. **API**: read-only проверка основных маршрутов (`/api/health`, `/api/ready`, `/api/servers`, `/api/prometheus/targets`).

---

### Дымовое тестирование (`make smoke`)

Команда проверяет сквозную работоспособность запущенного приложения как единой системы:

```bash
make smoke
# или напрямую через npm:
npm run smoke
```

Минимальный сценарий `make smoke`:
1. Backend процесс отвечает (`GET /api/health` → `200 OK`).
2. База данных доступна и готова (`GET /api/ready` → `database: "ok"`).
3. Подсистема аутентификации отвечает (`GET /api/auth/me`).
4. Servers API возвращает список серверов (`GET /api/servers`).
5. Agent API и Prometheus Service Discovery отвечают (`GET /api/prometheus/targets`).
6. Monitoring API отвечает (`GET /api/servers/:id/metrics` или проверка структуры ответа).
7. Frontend production-сборка проходит без ошибок.

---

## 3. Health vs Readiness Endpoints

| Endpoint | Назначение | Успешный ответ | Ответ при сбое БД |
| :--- | :--- | :--- | :--- |
| `GET /api/health` | Проверка, что процесс Backend запущен и обрабатывает HTTP-запросы (Liveness) | `200 OK` `{"status":"ok","service":"infralab-api"}` | Не зависит от внешних сервисов |
| `GET /api/ready` | Проверка готовности зависимостей: PostgreSQL и Prometheus (Readiness) | `200 OK` `{"status":"ok","checks":{"database":"ok","prometheus":"ok"}}` | `503 Service Unavailable` `{"status":"error","checks":{"database":"error","prometheus":"..."}}` |

---

## 4. Правила логирования (Structured Logging)

Все ключевые операции логируются через `src/lib/logger.ts` в структурированном формате:
- Поля: `timestamp`, `level` (`INFO`, `WARN`, `ERROR`), `component`, `operation`, а также контекстные идентификаторы (`server_id`, `agent_id`, `status_code`, `duration_ms`, `error`).
- **Безопасность**: пароли, приватные SSH-ключи, `enrollment_token`, `encryptedSecret`, `Authorization` заголовки и сессионные токены автоматически маскируются (`[REDACTED]`) и никогда не выводятся в консоль или ответы ошибок.
