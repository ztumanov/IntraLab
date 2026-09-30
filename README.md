# InfraLab — Платформа управления и мониторинга Linux-инфраструктуры

InfraLab — это централизованная self-hosted система класса Control Plane для администрирования Linux-серверов, сбора телеметрии во временные ряды (Prometheus TSDB), управления контейнерами Docker, инспекции сетевого стека и чтения системных журналов.

Платформа объединяет два режима работы с узлами:
1. Безагентный режим (Agentless over SSH) — прямое подключение к серверам по протоколу SSH v2 с хранением ключей и паролей в зашифрованном виде (AES-256-GCM).
2. Агентный режим (`infralab-agent` + Prometheus) — легковесный Go-демон, устанавливаемый на целевой Linux-сервер для регулярной отправки сигнала доступности (heartbeat), системного профиля хоста и экспорта метрик в формате Prometheus (`/metrics`).

---

## Архитектура системы

Ниже представлена структурная схема взаимодействия компонентов платформы InfraLab, хранилищ данных и управляемых Linux-узлов:

```text
+-----------------------------------------------------------------------------------+
|                            WEB UI (React 19 + TypeScript)                         |
|                                                                                   |
|  [Dashboard]   [Servers]   [Prometheus Monitoring]   [Geo Map]   [Networks]       |
|  [Containers]  [System Logs]   [Deployments]         [Alerts]    [Settings]       |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          | HTTPS / REST API (JSON, Bearer Auth)
                                          v
+-----------------------------------------------------------------------------------+
|                        INFRALAB CONTROL PLANE (Node.js / Express)                 |
|                                                                                   |
|  +-----------------------+  +------------------------+  +----------------------+  |
|  |   REST API & Auth     |  |   SSH v2 Execution     |  |  Prometheus Client   |  |
|  |   Middleware          |  |   Engine (ssh2)        |  |  & HTTP SD Provider  |  |
|  +-----------+-----------+  +-----------+------------+  +----------+-----------+  |
|              |                          |                          |              |
|  +-----------v-----------+              |                          |              |
|  |   AES-256-GCM Vault   |              |                          |              |
|  |   (SSH Secrets &      |              |                          |              |
|  |    Enrollment Tokens) |              |                          |              |
|  +-----------+-----------+              |                          |              |
+--------------|--------------------------|--------------------------|--------------+
               |                          |                          |
               | SQL (Drizzle ORM)        |                          | PromQL Query Range
               v                          |                          | (/api/v1/query_range)
+------------------------------+          |                          v
|      PostgreSQL 16 DB        |          |           +-----------------------------+
|                              |          |           |       Prometheus TSDB       |
|  - users                     |          |           |                             |
|  - servers                   |          |           |  - Dynamic Target Discovery |
|  - agents                    |          |           |    GET /api/prometheus/     |
|  - server_metrics            |          |           |        targets (15s)        |
|  - ssh_command_logs          |          |           |  - Retention: 15d / 5GB     |
+------------------------------+          |           +--------------+--------------+
                                          |                          |
                  SSH Protocol (Port 22)  |    HTTPS Heartbeat &     | HTTP Scrape (15s)
                  (Telemetry, Docker,     |    Enrollment            | GET :9101/metrics
                   Logs, Network, Exec)   |    (/api/agents/*)       |
                                          |                          |
                                          v                          v
+-----------------------------------------------------------------------------------+
|                           MANAGED LINUX SERVER (Target Host)                      |
|                                                                                   |
|  +-----------------------------------+     +-----------------------------------+  |
|  |            OpenSSH Daemon         |     |     infralab-agent (Go Daemon)    |  |
|  |                                   |     |                                   |  |
|  |  - /proc, /sys, df, ip, ss        |     |  - One-time Token Enrollment      |  |
|  |  - Docker CLI / Engine            |     |  - Credentials (/etc/... 0600)    |  |
|  |  - systemd / journalctl           |     |  - 15s Heartbeat + Backoff        |  |
|  |  - Remote Command Execution       |     |  - Prometheus Exporter (:9101)    |  |
|  +-----------------------------------+     +-----------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## Реализованная функциональность

### 1. Реестр серверов и криптографическое хранилище (Servers & Security Vault)
* Регистрация Linux-серверов с аутентификацией по паролю или приватному SSH-ключу (`PEM` / `OpenSSH Ed25519` / `RSA`).
* Шифрование всех секретов алгоритмом **AES-256-GCM** с уникальным вектором инициализации (IV) и тегом аутентификации перед записью в PostgreSQL.
* Секретные ключи и пароли никогда не возвращаются в ответах API и не выводятся в логи.
* Ручная и групповая проверка доступности узлов по SSH с измерением сетевой задержки (RTT latency в миллисекундах).

### 2. Linux Agent (`infralab-agent`)
* Отдельный демон на языке Go (`agent/cmd/infralab-agent`), работающий под управлением `systemd` (`infralab-agent.service`).
* Поддержка команд CLI: `enroll`, `run`, `version`.
* Безопасная первичная регистрация (`POST /api/agents/enroll`) по одноразовому токену из карточки сервера. После использования одноразовый токен немедленно аннулируется, а агент получает постоянный `agent_id` и секретный `credential`, сохраняемый в `/etc/infralab-agent/credentials.json` с правами доступа `0600`.
* Отправка сигналов доступности (`POST /api/agents/heartbeat`) каждые 15 секунд и передача сведений о системе (`POST /api/agents/system-info`: дистрибутив ОС, версия ядра, архитектура, количество ядер CPU, объём RAM, uptime).
* Механизм автоматического восстановления связи с расписанием **exponential backoff** (`1s -> 2s -> 4s -> 8s -> 16s -> 30s -> 60s`).
* Встроенный HTTP-экспортер метрик Prometheus на порту `:9101/metrics` (чтение `/proc/stat`, `/proc/meminfo`, `/proc/net/dev`, `/proc/uptime` и `syscall.Statfs("/")` напрямую без вызова внешних shell-процессов).

### 3. Интеграция с Prometheus и исторический мониторинг (`/servers/:id/monitoring`)
* Автоматическое обнаружение зарегистрированных агентов через механизм **Prometheus HTTP Service Discovery** (`GET /api/prometheus/targets`) без необходимости жестко прописывать IP-адреса серверов в `prometheus.yml`.
* Выполнение PromQL-запросов (`query_range`) на стороне бэкенда (`GET /api/servers/:id/metrics?range=1h|6h|24h|7d`).
* Интерактивные векторные графики (SVG) с поддержкой выбора временного интервала (`1h`, `6h`, `24h`, `7d`):
  * Загрузка процессора (`infralab_cpu_usage_percent`);
  * Использование оперативной памяти (`infralab_memory_usage_percent`);
  * Заполнение корневого дискового раздела (`infralab_disk_usage_percent`);
  * Входящий и исходящий сетевой трафик (`infralab_network_receive_bytes_total`, `infralab_network_transmit_bytes_total`).

### 4. Живая SSH-телеметрия и процессы (`/metrics`)
* Сбор детальной телеметрии по SSH в реальном времени: загрузка CPU, Load Average (`1m / 5m / 15m`), использование RAM и Swap, таблица смонтированных файловых систем (`df`), статистика сетевых интерфейсов и список наиболее ресурсоёмких процессов (`top processes`).
* Построение временных рядов в PostgreSQL (`server_metrics`) для серверов, работающих в безагентном режиме.

### 5. Управление контейнерами Docker (`/containers`)
* Инспекция состояния Docker Engine на удалённых хостах.
* Просмотр списка контейнеров (статус, потребляемые ресурсы CPU/RAM, проброшенные порты), локальных образов и сетей Docker.
* Управление жизненным циклом контейнеров: запуск (`start`), остановка (`stop`), перезапуск (`restart`), удаление (`remove`), чтение логов контейнера (`docker logs`) и развёртывание новых контейнеров из образов.

### 6. Сетевая диагностика и геолокационная карта (`/networks`, `/map`)
* Инспекция сетевых интерфейсов (`ip addr`), открытых сокетов и слушающих портов TCP/UDP (`ss -tulnp`), таблицы маршрутизации ядра (`ip route`), конфигурации DNS и статуса межсетевого экрана.
* Автоматическое определение географического положения серверов по их публичным IP-адресам (`GET /api/servers/geolocation`) и отображение узлов на интерактивной карте с цветовой индикацией статуса и задержки.

### 7. Интерактивный WebSocket PTY-терминал, системные журналы и оповещения (`/servers/:id`, `/logs`, `/deployments`, `/alerts`)
* Полноценный интерактивный потоковый псевдотерминал в браузере (**WebSocket PTY Terminal** на базе `@xterm/xterm` + `ssh2.shell` с поддержкой `xterm-256color`, автоматическим изменением размера окна `cols`/`rows`, управляющих последовательностей `Ctrl+C`, автодополнения `Tab` и быстрых команд).
* Пакетное выполнение произвольных команд в удалённой SSH-консоли с сохранением полного журнала аудита (`ssh_command_logs`: код возврата, длительность, `stdout`/`stderr`).
* Чтение системных журналов Linux (`systemd-journald`, логов авторизации `/var/log/auth.log`, сообщений ядра `dmesg` и демона Docker) с фильтрацией по уровню критичности (`ERROR`, `WARN`, `INFO`) и поиском по тексту.
* Модуль пакетного выполнения сценариев обслуживания (Deployments) и система пороговых правил оповещений (Alerts) по метрикам Disk, CPU, RAM, SSH Latency и доступности узла.

---

## План дальнейшего развития (Roadmap)

В следующих итерациях развития проекта запланирована реализация следующих подсистем:

1. **Взаимная TLS-аутентификация (mTLS) для `infralab-agent`:**
   * Переход от Bearer-аутентификации к автоматическому выпуску и ротации клиентских X.509-сертификатов для каждого зарегистрированного агента.
2. **Потоковая передача логов в реальном времени (Log Streaming):**
   * Непрерывная доставка логов (`journalctl -f` и логов контейнеров) через SSE/WebSocket без периодического опроса.
3. **Интеграция с внешними каналами уведомлений (Alertmanager / Webhooks):**
   * Отправка сработавших триггеров из модуля Alerts в Telegram, Slack, Email (SMTP) и PagerDuty.
4. **Автоматическое обновление агента (Agent Self-Update):**
   * Централизованное обновление бинарного файла `infralab-agent` на всех управляемых серверах с проверкой криптографической подписи релиза (`SHA-256` / `Ed25519`).
5. **Поддержка кластеров Kubernetes и systemd-сервисов:**
   * Инспекция подов, узлов и пространств имён Kubernetes (`kubectl` / Kube API), а также управление системными службами `systemd` через веб-интерфейс.
6. **Ролевая модель доступа (RBAC):**
   * Разграничение прав операторов (`Admin`, `Operator`, `Read-Only Auditor`) на уровне отдельных серверов и окружений.

---

## Структура репозитория

```text
.
├── agent/                          # Исходный код демона infralab-agent (Go)
│   ├── cmd/infralab-agent/         # Точка входа CLI (enroll, run, version)
│   ├── internal/
│   │   ├── client/                 # HTTPS-клиент к API InfraLab и логика backoff
│   │   ├── config/                 # Конфигурация агента (/etc/infralab-agent/config.json)
│   │   ├── identity/               # Хранение учетных данных агента с правами 0600
│   │   ├── metrics/                # Экспортер метрик Prometheus (GET /metrics)
│   │   └── system/                 # Сбор метрик Linux из /proc и /etc без shell-вызовов
│   ├── infralab-agent.service      # Unit-файл для systemd
│   └── go.mod
├── backend/                        # Модуль бэкенда на Go (альтернативный сервис API)
├── docs/                           # Техническая документация
│   ├── architecture.md             # Описание архитектуры
│   └── agent.md                    # Документация по установке и протоколу Linux Agent
├── migrations/                     # SQL-миграции схемы PostgreSQL
├── prometheus/
│   └── prometheus.yml              # Конфигурация Prometheus с HTTP Service Discovery
├── src/
│   ├── api/                        # Клиентские функции для работы с REST API
│   ├── components/                 # Переиспользуемые UI-компоненты, графики и карты
│   ├── context/                    # Провайдеры аутентификации и локализации (RU / EN)
│   ├── db/                         # Схема Drizzle ORM, запросы к PostgreSQL и авто-инициализация
│   ├── hooks/                      # Хуки состояния TanStack Query
│   ├── layouts/                    # Основной каркас приложения и навигация
│   ├── lib/                        # Валидация данных и инициализация Firebase
│   ├── middleware/                 # Проверка токенов авторизации
│   ├── pages/                      # Модули интерфейса (Dashboard, Servers, Monitoring и др.)
│   ├── server/                     # SSH-коннектор (ssh2), шифрование AES-256-GCM, клиент PromQL
│   └── types/                      # Контракты типов TypeScript
├── tests/                          # Интеграционные тесты жизненного цикла агента и Prometheus
├── Dockerfile                      # Многоступенчатая сборка (Go Agent + React UI + Node Server)
├── docker-compose.yml              # Оркестрация PostgreSQL, Prometheus и InfraLab
├── deploy.sh                       # Скрипт быстрого развёртывания на сервере
├── Makefile                        # Команды сборки, запуска и тестирования
└── server.ts                       # Основной сервер приложения (Express + API)
```

---

## Быстрое развёртывание в Docker

Для запуска всей платформы (PostgreSQL 16 + Prometheus + InfraLab Control Plane + скомпилированный бинарный файл `infralab-agent`) на собственном сервере требуется только установленный Docker и Docker Compose.

### Вариант 1. Автоматический запуск через скрипт

```bash
chmod +x deploy.sh
./deploy.sh
```

Скрипт автоматически сгенерирует файл `.env` со случайным паролем базы данных и мастер-ключом шифрования `ENCRYPTION_KEY`, соберёт образы и запустит контейнеры.

### Вариант 2. Запуск вручную через Docker Compose

```bash
docker compose up -d --build
```

После запуска сервисы доступны по следующим адресам:
* Веб-интерфейс и API InfraLab: `http://<IP_СЕРВЕРА>:3000`
* Веб-интерфейс Prometheus: `http://<IP_СЕРВЕРА>:9090`
* Скачивание скомпилированного агента: `http://<IP_СЕРВЕРА>:3000/downloads/infralab-agent`
* Скачивание unit-файла `systemd`: `http://<IP_СЕРВЕРА>:3000/downloads/infralab-agent.service`

Для входа в панель управления при развёртывании на собственном IP-адресе или домене используйте кнопку **«Локальный вход (Self-Hosted Docker)»** на странице авторизации.

---

## Установка `infralab-agent` на целевой Linux-сервер

1. Добавьте сервер в веб-интерфейсе InfraLab и откройте его карточку (`Server Details`).
2. В секции **Agent** скопируйте одноразовую команду регистрации (`enroll`).
3. На целевом Linux-сервере скачайте бинарный файл агента напрямую с вашего сервера InfraLab и выполните регистрацию:

```bash
sudo curl -fsSL http://<IP_INFRALAB>:3000/downloads/infralab-agent -o /usr/local/bin/infralab-agent
sudo chmod 0755 /usr/local/bin/infralab-agent

sudo curl -fsSL http://<IP_INFRALAB>:3000/downloads/infralab-agent.service -o /etc/systemd/system/infralab-agent.service

sudo infralab-agent enroll \
  --server http://<IP_INFRALAB>:3000 \
  --token <ОДНОРАЗОВЫЙ_ТОКЕН_ИЗ_КАРТОЧКИ>

sudo systemctl daemon-reload
sudo systemctl enable --now infralab-agent.service
```

После запуска сервис начнёт отправлять сигналы доступности каждые 15 секунд, а Prometheus автоматически обнаружит новый узел через `/api/prometheus/targets` и начнёт сбор метрик с порта `:9101/metrics`.

---

## Разработка и тестирование

Локальный запуск в режиме разработки:

```bash
npm install
npm run dev
```

Запуск модульных и интеграционных тестов (валидация, шифрование AES-256-GCM, регистрация агента, Prometheus HTTP Service Discovery и PromQL-запросы):

```bash
npm test
```

Сборка и запуск тестов Go-агента:

```bash
cd agent
go test -v ./...
go build -o bin/infralab-agent ./cmd/infralab-agent
```
