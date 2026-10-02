# InfraLab — Платформа управления и мониторинга Linux-инфраструктуры

InfraLab — это централизованная self-hosted система класса Control Plane для администрирования Linux-серверов, сбора телеметрии во временные ряды (Prometheus TSDB), управления контейнерами Docker, инспекции сетевого стека и чтения системных журналов.

Платформа объединяет два режима работы с узлами:
1. Безагентный режим (Agentless over SSH) — прямое подключение к серверам по протоколу SSH v2 с хранением ключей и паролей в зашифрованном виде (AES-256-GCM).
2. Агентный режим (`infralab-agent` + mTLS PKI + Prometheus) — легковесный Go-демон, устанавливаемый на целевой Linux-сервер для взаимной TLS-аутентификации (mTLS) по индивидуальным клиентским сертификатам X.509v3 (`SPIFFE URI`), регулярной отправки сигнала доступности (heartbeat), системного профиля хоста и экспорта метрик в формате Prometheus (`/metrics`).

---

## Архитектура системы

Ниже представлена структурная схема взаимодействия компонентов платформы InfraLab, внутреннего удостоверяющего центра (InfraLab Root CA), хранилищ данных и управляемых Linux-узлов:

```text
+-----------------------------------------------------------------------------------+
|                            WEB UI (React 19 + TypeScript)                         |
|                                                                                   |
|  [Dashboard]   [Servers]   [Prometheus Monitoring]   [Geo Map]   [Networks]       |
|  [Containers]  [System Logs]   [Deployments]         [Alerts]    [Settings]       |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          | HTTPS / REST API (Session + 2FA TOTP)
                                          v
+-----------------------------------------------------------------------------------+
|                        INFRALAB CONTROL PLANE (Node.js / Express)                 |
|                                                                                   |
|  +-----------------------+  +------------------------+  +----------------------+  |
|  |   REST API & mTLS     |  |   SSH v2 Execution     |  |  Prometheus Client   |  |
|  |   Auth Verifier       |  |   Engine (ssh2)        |  |  & HTTP SD Provider  |  |
|  +-----------+-----------+  +-----------+------------+  +----------+-----------+  |
|              |                          |                          |              |
|  +-----------v-----------+  +-----------v------------+             |              |
|  |   InfraLab Root CA    |  |   AES-256-GCM Vault    |             |              |
|  |   & X.509v3 PKI       |  |   (SSH Secrets &       |             |              |
|  |   (SPIFFE CSR Signer) |  |    Enrollment Tokens)  |             |              |
|  +-----------+-----------+  +-----------+------------+             |              |
+--------------|--------------------------|--------------------------|--------------+
               |                          |                          |
               | SQL (Drizzle ORM)        |                          | PromQL Query Range
               v                          |                          | (/api/v1/query_range)
+------------------------------+          |                          v
|      PostgreSQL 16 DB        |          |           +-----------------------------+
|                              |          |           |       Prometheus TSDB       |
|  - users                     |          |           |                             |
|  - servers                   |          |           |  - Dynamic Target Discovery |
|  - agents (X.509 metadata:   |          |           |    GET /api/prometheus/     |
|    serial, sha256 fp, SAN,   |          |           |        targets (15s)        |
|    validity, revocation)     |          |           |  - Retention: 15d / 5GB     |
|  - server_metrics            |          |           |                             |
|  - ssh_command_logs          |          |           |                             |
+------------------------------+          |           +--------------+--------------+
                                          |                          |
                  SSH Protocol (Port 22)  |    mTLS (TLS 1.2/1.3)    | HTTP Scrape (15s)
                  (Telemetry, Docker,     |    Client X.509v3 Cert   | GET :9101/metrics
                   Logs, Network, Exec)   |    (/api/agents/*)       |
                                          |                          |
                                          v                          v
+-----------------------------------------------------------------------------------+
|                           MANAGED LINUX SERVER (Target Host)                      |
|                                                                                   |
|  +-----------------------------------+     +-----------------------------------+  |
|  |            OpenSSH Daemon         |     |     infralab-agent (Go Daemon)    |  |
|  |                                   |     |                                   |  |
|  |  - /proc, /sys, df, ip, ss        |     |  - Local ECDSA P-256 Key & CSR    |  |
|  |  - Docker CLI / Engine            |     |  - PKI Store (0700 / key 0600)    |  |
|  |  - systemd / journalctl           |     |  - mTLS Heartbeat + Auto-Renewal  |  |
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

### 2. Linux Agent (`infralab-agent`) и взаимная TLS-аутентификация (mTLS PKI)
* Отдельный демон на языке Go (`agent/cmd/infralab-agent`), работающий под управлением `systemd` (`infralab-agent.service`) и использующий только стандартную криптографическую библиотеку Go (`crypto/tls`, `crypto/x509`, `crypto/ecdsa`).
* Поддержка команд CLI: `enroll`, `run`, `version`.
* **Внутренний удостоверяющий центр (InfraLab Root CA):**
  * Выделенный внутренний корневой CA (`ECDSA P-256`), предназначенный исключительно для подписи и проверки клиентских сертификатов `infralab-agent`.
  * Приватный ключ CA (`ca.key`, права `0600`) хранится вне базы данных PostgreSQL и вне Git-репозитория (поддерживается передача через `AGENT_CA_CERT_PEM`/`AGENT_CA_KEY_PEM`, файлы секретов `AGENT_CA_CERT_PATH`/`AGENT_CA_KEY_PATH` или Docker volume `AGENT_PKI_DIR=/var/lib/infralab/pki`).
  * Настраиваемый срок действия выпускаемых сертификатов через переменную окружения `AGENT_CERT_TTL_HOURS` (по умолчанию `72` часа).
* **Безопасная первичная регистрация по CSR (`POST /api/agents/enroll`):**
  * Агент генерирует ключевую пару `ECDSA P-256` и запрос на подпись сертификата (**PKCS#10 CSR**) непосредственно на целевом сервере — приватный ключ никогда не покидает хост агента и не передаётся на Backend.
  * Одноразовый токен (`ila_enroll_...`) проверяется по SHA-256 хешу и немедленно аннулируется после использования.
  * Backend проверяет криптографическую подпись CSR и выпускает индивидуальный клиентский сертификат **X.509v3** (`CA:FALSE`, `KeyUsage: digitalSignature`, `ExtendedKeyUsage: clientAuth` `1.3.6.1.5.5.7.3.2`) с уникальным `SAN URI`:
    `spiffe://infralab/agent/<agent_id>` и `Subject: O=InfraLab Agent, CN=<agent_id>`.
* **Защита ключевого материала на файловой системе агента:**
  * Атомарная запись файлов через временный файл с проверкой прав доступа: директория `0700`, приватный ключ `agent.key` (`0600`), клиентский сертификат `agent.crt` (`0600`), корневой сертификат `ca.crt` (`0644`), файл метаданных `credentials.json` (`0600`).
  * При старте демона (`infralab-agent run`) проверяются права `0600` на `agent.key` и `credentials.json`; при более широких правах запуск блокируется.
* **Строгая валидация сертификата и привязка идентичности (Identity Binding):**
  * На каждом запросе (`POST /api/agents/heartbeat`, `POST /api/agents/system-info`, `POST /api/agents/renew`) проверяется цепочка доверия `InfraLab Root CA`, окно валидности `NotBefore..NotAfter`, расширение `ExtendedKeyUsage = clientAuth` и идентичность `spiffe://infralab/agent/<agent_id>`.
  * Защита от спуфинга: любые переданные идентификаторы (`X-Agent-ID`, `body.agent_id`, `query.agent_id`) сверяются с `agent_id` внутри X.509 сертификата; попытка использовать сертификат Agent A для отправки данных от имени Agent B отклоняется с кодом `401 Unauthorized`.
  * В таблице `agents` PostgreSQL хранятся только несекретные метаданные сертификата (`cert_serial`, `cert_fingerprint_sha256`, `cert_subject`, `cert_san_uri`, `cert_not_before`, `cert_not_after`, `cert_revoked_at`). При аутентификации выполняется constant-time сверка (`crypto.timingSafeEqual`) SHA-256 отпечатка и серийного номера активного сертификата.
* **Автоматическая ротация (`POST /api/agents/renew`) и мгновенный отзыв (`POST /api/servers/:id/agent/revoke`):**
  * При приближении срока истечения сертификата (порог `1/3` от TTL или `12` часов) агент автоматически генерирует новый приватный ключ и CSR, проходит перевыпуск по действующему mTLS-соединению и бесшовно обновляет TLS-транспорт.
  * Оператор может мгновенно отозвать сертификат агента из карточки сервера в веб-интерфейсе или через API (`POST /api/servers/:id/agent/revoke`), после чего старый сертификат немедленно блокируется.
* **Отказоустойчивость и метрики:**
  * Отправка сигналов доступности каждые 15 секунд с автоматическим восстановлением связи по расписанию **exponential backoff** (`1s -> 2s -> 4s -> 8s -> 16s -> 30s -> 60s`).
  * Встроенный HTTP-экспортер метрик Prometheus на порту `:9101/metrics` (чтение `/proc/stat`, `/proc/meminfo`, `/proc/net/dev`, `/proc/uptime` и `syscall.Statfs("/")` без вызова внешних shell-процессов).
  * Сохранена обратная совместимость с переходным режимом Bearer на период миграции существующих узлов.

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

### 7. Интерактивный WebSocket PTY-терминал, потоковая передача логов (Real-Time Log Streaming) и оповещения (`/servers/:id`, `/logs`, `/deployments`, `/alerts`)
* Полноценный интерактивный потоковый псевдотерминал в браузере (**WebSocket PTY Terminal** на базе `@xterm/xterm` + `ssh2.shell` с поддержкой `xterm-256color`, автоматическим изменением размера окна `cols`/`rows`, управляющих последовательностей `Ctrl+C`, автодополнения `Tab` и быстрых команд).
* **Потоковая передача логов в реальном времени (Real-Time Log Streaming без polling):**
  * Цепочка доставки: `Linux server (journalctl -f / docker logs --follow)` $\rightarrow$ `infralab-agent` (безопасный запуск через `exec.CommandContext` без shell-интерполяции и с валидацией имён юнитов/контейнеров) $\rightarrow$ постоянный двунаправленный канал **mTLS WebSocket** (`/api/agents/logs/ws`) $\rightarrow$ **InfraLab LogStreamHub** (дедупликация подписок, кольцевой буфер, защита от backpressure и автоматическая отправка `stop_stream` при закрытии последней вкладки) $\rightarrow$ **Server-Sent Events (SSE)** (`GET /api/servers/:id/logs/stream`) $\rightarrow$ **React Frontend** (`EventSource` с поддержкой паузы, очистки буфера, автоскролла, выбора systemd-юнита или Docker-контейнера).
  * Сохранена обратная совместимость со снимками истории логов по SSH (`GET /api/servers/:id/logs` и `GET /api/servers/:id/docker/containers/:containerId/logs`).
* Пакетное выполнение произвольных команд в удалённой SSH-консоли с сохранением полного журнала аудита (`ssh_command_logs`: код возврата, длительность, `stdout`/`stderr`).
* Модуль пакетного выполнения сценариев обслуживания (Deployments) и система пороговых правил оповещений (Alerts) по метрикам Disk, CPU, RAM, SSH Latency и доступности узла.

---

## План дальнейшего развития (Roadmap)

В следующих итерациях развития проекта запланирована реализация следующих подсистем:

1. **Интеграция с внешними каналами уведомлений (Alertmanager / Webhooks):**
   * Отправка сработавших триггеров из модуля Alerts в Telegram, Slack, Email (SMTP) и PagerDuty.
2. **Автоматическое обновление агента (Agent Self-Update):**
   * Централизованное обновление бинарного файла `infralab-agent` на всех управляемых серверах с проверкой криптографической подписи релиза (`SHA-256` / `Ed25519`).
3. **Поддержка кластеров Kubernetes и systemd-сервисов:**
   * Инспекция подов, узлов и пространств имён Kubernetes (`kubectl` / Kube API), а также управление системными службами `systemd` через веб-интерфейс.
4. **Ролевая модель доступа (RBAC):**
   * Разграничение прав операторов (`Admin`, `Operator`, `Read-Only Auditor`) на уровне отдельных серверов и окружений.

---

## Структура репозитория

```text
.
├── agent/                          # Исходный код демона infralab-agent (Go)
│   ├── cmd/infralab-agent/         # Точка входа CLI (enroll, run, version) и авто-ротация mTLS
│   ├── internal/
│   │   ├── client/                 # mTLS HTTPS-клиент к API InfraLab, CSR enrollment, renew и backoff
│   │   ├── config/                 # Конфигурация агента (/etc/infralab-agent/config.json)
│   │   ├── identity/               # Генерация ECDSA P-256 + CSR, атомарное хранение PKI (0700 / 0600)
│   │   ├── logstream/              # Потоковая передача логов (journalctl -f / docker logs --follow) по mTLS WS
│   │   ├── metrics/                # Экспортер метрик Prometheus (GET /metrics)
│   │   └── system/                 # Сбор метрик Linux из /proc и /etc без shell-вызовов
│   ├── infralab-agent.service      # Unit-файл для systemd
│   └── go.mod
├── backend/                        # Модуль бэкенда на Go (альтернативный сервис API)
├── docs/                           # Техническая документация
│   ├── architecture.md             # Описание архитектуры и PKI/mTLS
│   └── agent.md                    # Документация по установке и протоколу mTLS Linux Agent
├── migrations/                     # SQL-миграции схемы PostgreSQL (включая 000005_agent_mtls_pki)
├── prometheus/
│   └── prometheus.yml              # Конфигурация Prometheus с HTTP Service Discovery
├── src/
│   ├── api/                        # Клиентские функции для работы с REST API
│   ├── components/                 # Переиспользуемые UI-компоненты, графики и карты
│   ├── context/                    # Провайдеры аутентификации и локализации (RU / EN)
│   ├── db/                         # Схема Drizzle ORM, таблица agents (mTLS метаданные) и запросы
│   ├── hooks/                      # Хуки состояния TanStack Query
│   ├── layouts/                    # Основной каркас приложения и навигация
│   ├── lib/                        # Валидация данных, логгер с редактированием секретов и ключей
│   ├── middleware/                 # Проверка токенов авторизации
│   ├── pages/                      # Модули интерфейса (Dashboard, Servers, Monitoring и др.)
│   ├── server/                     # InfraLab Root CA & X.509v3 PKI (agentPki.ts), SSH (ssh2), PromQL
│   └── types/                      # Контракты типов TypeScript
├── tests/                          # Интеграционные и E2E-тесты mTLS PKI, жизненного цикла агента и Prometheus
├── Dockerfile                      # Многоступенчатая сборка (Go Agent + React UI + Node Server)
├── docker-compose.yml              # Оркестрация PostgreSQL, Prometheus и InfraLab (с volume infralab_pki)
├── deploy.sh                       # Скрипт быстрого развёртывания на сервере
├── Makefile                        # Команды сборки, запуска и тестирования
└── server.ts                       # Основной сервер приложения (Express + API + mTLS endpoints)
```

---

## Быстрое развёртывание в Docker

Для запуска всей платформы (PostgreSQL 16 + Prometheus + InfraLab Control Plane + внутренний InfraLab Root CA + скомпилированный бинарный файл `infralab-agent`) на собственном сервере требуется только установленный Docker и Docker Compose.

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
* Публичный корневой сертификат InfraLab Agent CA: `http://<IP_СЕРВЕРА>:3000/api/agents/ca.crt`
* Скачивание скомпилированного агента: `http://<IP_СЕРВЕРА>:3000/downloads/infralab-agent`
* Скачивание unit-файла `systemd`: `http://<IP_СЕРВЕРА>:3000/downloads/infralab-agent.service`

Для входа в панель управления при развёртывании на собственном IP-адресе или домене используйте кнопку **«Локальный вход (Self-Hosted Docker)»** на странице авторизации.

---

## Установка `infralab-agent` на целевой Linux-сервер (mTLS)

### Способ 1. Автоматическая установка в 1 клик по SSH
1. Добавьте сервер с паролем или приватным SSH-ключом в веб-интерфейсе InfraLab и откройте его карточку (`Server Details`).
2. В секции **Linux Agent** нажмите **«Установить агент в 1 клик по SSH»**.
3. На удалённом Linux-сервере в защищённой директории `/var/lib/infralab-agent` (`0700`) локально генерируется приватный ключ `agent.key` (`0600`) и запрос `CSR`. Backend подписывает `CSR` через `InfraLab Root CA`, записывает `agent.crt` (`0600`), `ca.crt` (`0644`), `credentials.json` (`0600`) и запускает службу `infralab-agent`.

### Способ 2. Ручная установка и CSR-регистрация через CLI
1. Откройте карточку сервера (`Server Details`) и скопируйте одноразовый токен регистрации (`ila_enroll_...`).
2. На целевом Linux-сервере выполните команды установки и первичной mTLS-регистрации:

```bash
sudo mkdir -p /etc/infralab-agent
sudo chmod 0700 /etc/infralab-agent

sudo curl -fsSL http://<IP_INFRALAB>:3000/downloads/infralab-agent -o /usr/local/bin/infralab-agent
sudo chmod 0755 /usr/local/bin/infralab-agent

sudo curl -fsSL http://<IP_INFRALAB>:3000/api/agents/ca.crt -o /etc/infralab-agent/ca.crt
sudo chmod 0644 /etc/infralab-agent/ca.crt

sudo curl -fsSL http://<IP_INFRALAB>:3000/downloads/infralab-agent.service -o /etc/systemd/system/infralab-agent.service

sudo infralab-agent enroll \
  --server http://<IP_INFRALAB>:3000 \
  --token <ОДНОРАЗОВЫЙ_ТОКЕН_ИЗ_КАРТОЧКИ> \
  --ca-cert /etc/infralab-agent/ca.crt

sudo systemctl daemon-reload
sudo systemctl enable --now infralab-agent.service
```

Во время выполнения `infralab-agent enroll` агент локально сгенерирует приватный ключ `ECDSA P-256` (`/etc/infralab-agent/agent.key` с правами `0600`), отправит `CSR` на `/api/agents/enroll`, сохранит подписанный клиентский сертификат `agent.crt` (`0600`), корневой сертификат `ca.crt` (`0644`) и метаданные `credentials.json` (`0600`).

После запуска демон начнёт отправлять mTLS-аутентифицированные сигналы доступности каждые 15 секунд, автоматически продлевать сертификат до истечения срока действия через `/api/agents/renew`, а Prometheus автоматически обнаружит узел через `/api/prometheus/targets` и начнёт сбор метрик с порта `:9101/metrics`.

---

## Разработка и тестирование

Локальный запуск в режиме разработки:

```bash
npm install
npm run dev
```

Запуск модульных, интеграционных и E2E-тестов (валидация, шифрование AES-256-GCM, mTLS PKI / выпуск X.509v3 сертификатов по CSR / проверка SPIFFE SAN / ротация / отзыв, реальный TLS handshake, Prometheus HTTP Service Discovery и PromQL-запросы):

```bash
npm test
```

Сборка и запуск тестов Go-агента (включая E2E-тест `enroll -> auto-renew -> mTLS heartbeat & system-info` и аудит прав доступа `0700`/`0600`):

```bash
cd agent
go test -v ./...
go build -o bin/infralab-agent ./cmd/infralab-agent
```
