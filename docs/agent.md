# InfraLab Linux Agent (`infralab-agent`)

`infralab-agent` — это легковесный Go-демон, который устанавливается на целевой Linux-сервер и подключается к платформе **InfraLab** по HTTPS.

На текущем этапе развития агент отвечает за:

1. Одноразовую регистрацию узла (`enroll`) по токену;
2. Получение и безопасное локальное хранение постоянного ключа (`credential` с правами `0600`);
3. Регулярную отправку `heartbeat` каждые **15 секунд**;
4. Сбор и отправку базовой системной информации о Linux-хосте без запуска внешних shell-команд;
5. Автоматическое переподключение по расписанию **exponential backoff** (`1s → 2s → 4s → 8s → 16s → 30s → 60s`) при потере связи с InfraLab.

---

## Архитектура модуля `agent/`

```text
agent/
├── cmd/infralab-agent/
│   ├── main.go              # CLI (enroll, run, version), основной цикл и обработка SIGTERM/SIGINT
│   └── main_test.go         # Интеграционный E2E-тест регистрации и работы демона
├── internal/
│   ├── client/              # HTTPS-клиент к API InfraLab + расписание exponential backoff
│   ├── config/              # Чтение и атомарное сохранение /etc/infralab-agent/config.json
│   ├── identity/            # Хранение agent_id и credential с проверкой прав 0600
│   └── system/              # Сбор сведений о Linux (/etc/os-release, /proc/meminfo, /proc/uptime)
├── infralab-agent.service   # Unit-файл systemd
├── go.mod
└── go.sum
```

---

## Сборка и тестирование

Сборка бинарного файла агента:

```bash
cd agent
go build -o bin/infralab-agent ./cmd/infralab-agent
```

Запуск unit- и интеграционных тестов Go-модуля:

```bash
cd agent
go test -v ./...
```

Проверка версии:

```bash
./bin/infralab-agent version
# infralab-agent v0.1.0
```

---

## Регистрация агента (`enroll`)

1. Откройте карточку нужного сервера в веб-интерфейсе **InfraLab** (`Server Details`).
2. В блоке **Agent** скопируйте команду одноразовой регистрации (кнопка **Copy**).
3. Выполните команду на целевом Linux-сервере с правами `root`:

```bash
sudo infralab-agent enroll \
  --server https://infralab.example \
  --token <ONE_TIME_TOKEN>
```

Что происходит при `enroll`:

- Агент отправляет `POST /api/agents/enroll` с одноразовым токеном, `hostname` и `version`.
- Backend проверяет SHA-256 хеш токена, инвалидирует одноразовый токен и выпускает постоянный `agent_id` + секретный `credential`.
- Агент сохраняет:
  - `/etc/infralab-agent/config.json` (`0644`) — URL сервера и интервал heartbeat (`15s`).
  - `/etc/infralab-agent/credentials.json` (`0600`) — `server_url`, `agent_id` и `credential`.
- Секретный `credential` никогда не выводится в stdout/stderr, не попадает в логи и не возвращается в обычных API-ответах.

---

## Запуск демона и жизненный цикл (`run`)

Запуск вручную:

```bash
sudo infralab-agent run
```

Порядок работы при запуске:

```text
load config (/etc/infralab-agent/config.json)
→ load identity (/etc/infralab-agent/credentials.json, проверка прав 0600)
→ authenticate (Bearer credential + X-Agent-ID)
→ send heartbeat (POST /api/agents/heartbeat)
→ send system info (POST /api/agents/system-info)
→ heartbeat every 15 seconds
```

### Сбор системной информации (`internal/system`)

Модуль `internal/system` читает данные напрямую из стандартных интерфейсов ядра Linux без вызова `/bin/sh`:

- **Hostname**: `os.Hostname()`
- **OS / Distribution**: `/etc/os-release` (`PRETTY_NAME`)
- **Kernel**: `/proc/sys/kernel/osrelease`
- **Architecture**: `runtime.GOARCH`
- **CPU Count**: `runtime.NumCPU()`
- **RAM Total**: `/proc/meminfo` (`MemTotal`)
- **Uptime**: `/proc/uptime`

### Exponential Backoff при недоступности InfraLab

Если сервер InfraLab временно недоступен или возвращает сетевую ошибку, агент переходит в режим повторных попыток с задержками:

```text
1s → 2s → 4s → 8s → 16s → 30s → 60s
```

Как только связь восстанавливается, агент автоматически отправляет актуальный `heartbeat` и `system-info`, сбрасывает счётчик ошибок и возвращается к штатному интервалу **15 секунд**.

---

## Установка в `systemd`

1. Скопируйте бинарный файл и unit-файл:

```bash
sudo install -m 0755 bin/infralab-agent /usr/local/bin/infralab-agent
sudo install -m 0644 agent/infralab-agent.service /etc/systemd/system/infralab-agent.service
```

2. Выполните `enroll` (если ещё не выполнен):

```bash
sudo /usr/local/bin/infralab-agent enroll \
  --server https://infralab.example \
  --token <TOKEN>
```

3. Активируйте и запустите сервис:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now infralab-agent.service
```

4. Проверка статуса и логов:

```bash
sudo systemctl status infralab-agent.service
sudo journalctl -u infralab-agent.service -f
```

Unit-файл настроен на запуск после `network-online.target`, автоматический перезапуск (`Restart=always`, `RestartSec=5s`) и корректное завершение по `SIGTERM`/`SIGINT`.

---

## Спецификация Backend API

| Метод | Endpoint | Назначение |
| :--- | :--- | :--- |
| `POST` | `/api/agents/enroll` | Обмен одноразового токена на постоянный `agent_id` и `credential` |
| `POST` | `/api/agents/heartbeat` | Обновление `last_seen_at` и статуса сервера (требует `Authorization: Bearer <credential>` и `X-Agent-ID`) |
| `POST` | `/api/agents/system-info` | Сохранение информации о хосте (`hostname`, `os_distribution`, `kernel`, `architecture`, `cpu_count`, `ram_total_bytes`, `uptime_seconds`) |
| `GET` | `/api/servers/:id/agent` | Получение статуса агента (`ONLINE` / `OFFLINE` / `NOT INSTALLED`), метаданных и одноразового токена (если агент ещё не установлен) |
| `POST` | `/api/servers/:id/agent/token` | Перевыпуск одноразового токена регистрации для сервера |
| `GET` | `/api/prometheus/targets` | Динамическое обнаружение зарегистрированных агентов для Prometheus (`http_sd_configs`) |
| `GET` | `/api/servers/:id/metrics?range=1h\|6h\|24h\|7d` | Выполнение PromQL-запросов к Prometheus для страницы `/servers/:id/monitoring` |

---

## Экспорт метрик Prometheus (`GET /metrics`)

По умолчанию `infralab-agent run` поднимает HTTP-эндпоинт на `:9101/metrics` (настраивается через `--listen-addr` или `metrics_listen_addr` в `/etc/infralab-agent/config.json`) и экспортирует метрики в формате Prometheus `0.0.4`:

- `infralab_cpu_usage_percent` — загрузка CPU (`%`)
- `infralab_memory_usage_percent`, `infralab_memory_total_bytes`, `infralab_memory_used_bytes` — использование памяти RAM
- `infralab_disk_usage_percent`, `infralab_disk_total_bytes`, `infralab_disk_used_bytes` — заполнение корневой файловой системы `/`
- `infralab_network_receive_bytes_total`, `infralab_network_transmit_bytes_total`, `infralab_network_rx_bytes_per_sec`, `infralab_network_tx_bytes_per_sec` — сетевой трафик RX/TX
- `infralab_uptime_seconds` — время непрерывной работы Linux-сервера

