# ==============================================================================
# Stage 1: Build Go Linux Agent binary (infralab-agent)
# ==============================================================================
FROM golang:1.22-alpine AS agent-builder
WORKDIR /src/agent
COPY agent/go.mod ./
COPY agent/ ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/infralab-agent ./cmd/infralab-agent

# ==============================================================================
# Stage 2: Build React + Vite Frontend & TypeScript Full-Stack Application
# ==============================================================================
FROM node:22-alpine AS app-builder
WORKDIR /app

# Native build dependencies for ssh2 / cpu-features if needed
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install

COPY . .
ARG VITE_GOOGLE_MAPS_API_KEY=""
ENV VITE_GOOGLE_MAPS_API_KEY=${VITE_GOOGLE_MAPS_API_KEY}
RUN npm run build

# ==============================================================================
# Stage 3: Production Runtime Container (InfraLab Control Plane + Agent Binary)
# ==============================================================================
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache ansible openssh-client sshpass python3

ENV NODE_ENV=production
ENV PORT=3000
ENV ANSIBLE_BIN=/usr/bin/ansible
ENV ANSIBLE_PLAYBOOK_BIN=/usr/bin/ansible-playbook
ENV ANSIBLE_TIMEOUT=120
ENV ANSIBLE_WORK_DIR=/var/lib/infralab/ansible

COPY --from=app-builder /app /app
COPY --from=agent-builder /out/infralab-agent /app/bin/infralab-agent
RUN chmod 0755 /app/bin/infralab-agent

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["npx", "tsx", "server.ts"]
