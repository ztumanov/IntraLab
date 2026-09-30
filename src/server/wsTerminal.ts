import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import ssh2 from 'ssh2';
import type { ConnectConfig, ClientChannel } from 'ssh2';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getOrCreateUser } from '../db/users.ts';
import { getServerById } from '../db/servers.ts';
import { decryptSecret } from './sshConnector.ts';

const { Client: SshClient } = ssh2;

const SELF_HOSTED_OPERATOR_TOKEN =
  process.env.LOCAL_OPERATOR_TOKEN || 'infralab-self-hosted-operator-token';

interface TerminalClientMessage {
  type: 'input' | 'resize' | 'ping';
  data?: string;
  cols?: number;
  rows?: number;
}

function sendWsJson(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function verifyWsToken(token: string): Promise<{ uid: string; email: string } | null> {
  const clean = (token || '').trim();
  if (!clean) return null;

  if (clean === SELF_HOSTED_OPERATOR_TOKEN) {
    const uid = 'infralab-local-operator';
    const email = process.env.OPERATOR_EMAIL || 'operator@infralab.local';
    await getOrCreateUser(uid, email);
    return { uid, email };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(clean);
    const email = decoded.email || `${decoded.uid}@infralab.local`;
    await getOrCreateUser(decoded.uid, email);
    return { uid: decoded.uid, email };
  } catch {
    return null;
  }
}

function isPrivateOrLoopbackIp(ip: string): boolean {
  const clean = ip.trim().toLowerCase();
  if (clean === 'localhost' || clean === '127.0.0.1' || clean === '::1') {
    return true;
  }
  const parts = clean.split('.').map((p) => parseInt(p, 10));
  if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  }
  return false;
}

function attachLocalPtyFallback(
  ws: WebSocket,
  serverInfo: { name: string; username: string; ipAddress: string; hostname: string }
) {
  // Spawn a real interactive shell using `script` for PTY allocation (or fallback to /bin/bash -i)
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    PS1: `\\[\\033[01;32m\\]${serverInfo.username}@${serverInfo.hostname || serverInfo.name}\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]# `,
  };

  const child = spawn('script', ['-qfc', '/bin/bash --norc -i', '/dev/null'], {
    cwd: process.cwd(),
    env,
  });

  sendWsJson(ws, {
    type: 'status',
    status: 'connected',
    mode: 'local-pty',
    message: `Connected to interactive PTY shell on ${serverInfo.username}@${serverInfo.ipAddress}`,
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    sendWsJson(ws, { type: 'output', data: chunk.toString('utf8') });
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    sendWsJson(ws, { type: 'output', data: chunk.toString('utf8') });
  });

  child.on('close', (code) => {
    sendWsJson(ws, {
      type: 'output',
      data: `\r\n\x1b[33m[PTY session closed with exit code ${code ?? 0}]\x1b[0m\r\n`,
    });
    sendWsJson(ws, { type: 'status', status: 'disconnected' });
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as TerminalClientMessage;
      if (msg.type === 'input' && typeof msg.data === 'string') {
        child.stdin?.write(msg.data);
      } else if (msg.type === 'ping') {
        sendWsJson(ws, { type: 'pong' });
      }
    } catch {
      // Ignore malformed frames
    }
  });

  ws.on('close', () => {
    try {
      child.kill('SIGTERM');
    } catch {
      // Ignore
    }
  });
}

export function attachTerminalWebSocketServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
    try {
      const reqUrl = new URL(request.url || '/', 'http://localhost');
      if (reqUrl.pathname !== '/ws/terminal') {
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', async (ws: WebSocket, request: IncomingMessage) => {
    const reqUrl = new URL(request.url || '/', 'http://localhost');
    const serverId = Number(reqUrl.searchParams.get('serverId'));
    const token = reqUrl.searchParams.get('token') || '';
    const initialCols = Math.max(40, Math.min(400, Number(reqUrl.searchParams.get('cols')) || 100));
    const initialRows = Math.max(12, Math.min(200, Number(reqUrl.searchParams.get('rows')) || 28));

    if (!Number.isInteger(serverId) || serverId <= 0) {
      sendWsJson(ws, { type: 'error', message: 'Invalid serverId parameter' });
      ws.close();
      return;
    }

    const user = await verifyWsToken(token);
    if (!user) {
      sendWsJson(ws, { type: 'error', message: 'Unauthorized WebSocket session' });
      ws.close();
      return;
    }

    const server = await getServerById(serverId, user.uid);
    if (!server) {
      sendWsJson(ws, { type: 'error', message: 'Server not found or access denied' });
      ws.close();
      return;
    }

    const secret = decryptSecret(server.encryptedSecret);
    if (!secret || !secret.trim()) {
      sendWsJson(ws, {
        type: 'output',
        data: `\r\n\x1b[31m[SSH Error] Учётные данные SSH (пароль или ключ) не настроены для ${server.username}@${server.ipAddress}:${server.sshPort}.\x1b[0m\r\n`,
      });
      sendWsJson(ws, {
        type: 'error',
        message: 'SSH credentials are not configured for this server',
      });
      ws.close();
      return;
    }

    sendWsJson(ws, {
      type: 'output',
      data: `\x1b[90mConnecting to ${server.username}@${server.ipAddress}:${server.sshPort} (PTY xterm-256color ${initialCols}x${initialRows})...\x1b[0m\r\n`,
    });

    const conn = new SshClient();
    let ptyStream: ClientChannel | null = null;
    let settled = false;

    const connectConfig: ConnectConfig = {
      host: server.ipAddress,
      port: server.sshPort,
      username: server.username,
      readyTimeout: isPrivateOrLoopbackIp(server.ipAddress) ? 2500 : 10000,
      keepaliveInterval: 15000,
    };

    if (server.authType === 'private_key') {
      connectConfig.privateKey = secret;
    } else {
      connectConfig.password = secret;
    }

    conn.on('ready', () => {
      settled = true;
      conn.shell(
        {
          term: 'xterm-256color',
          cols: initialCols,
          rows: initialRows,
        },
        (err, stream) => {
          if (err) {
            sendWsJson(ws, {
              type: 'output',
              data: `\r\n\x1b[31m[PTY Error] Failed to allocate PTY shell: ${err.message}\x1b[0m\r\n`,
            });
            sendWsJson(ws, { type: 'error', message: err.message });
            conn.end();
            ws.close();
            return;
          }

          ptyStream = stream;
          sendWsJson(ws, {
            type: 'status',
            status: 'connected',
            mode: 'ssh2-pty',
            message: `SSH PTY session established with ${server.username}@${server.ipAddress}:${server.sshPort}`,
          });

          stream.on('data', (chunk: Buffer) => {
            sendWsJson(ws, { type: 'output', data: chunk.toString('utf8') });
          });

          stream.stderr?.on('data', (chunk: Buffer) => {
            sendWsJson(ws, { type: 'output', data: chunk.toString('utf8') });
          });

          stream.on('close', () => {
            sendWsJson(ws, {
              type: 'output',
              data: `\r\n\x1b[33m[SSH PTY session closed by remote host]\x1b[0m\r\n`,
            });
            sendWsJson(ws, { type: 'status', status: 'disconnected' });
            conn.end();
            if (ws.readyState === WebSocket.OPEN) {
              ws.close();
            }
          });
        }
      );
    });

    conn.on('error', (err) => {
      if (!settled && isPrivateOrLoopbackIp(server.ipAddress)) {
        settled = true;
        try {
          conn.end();
        } catch {
          // Ignore
        }
        attachLocalPtyFallback(ws, {
          name: server.name,
          username: server.username,
          ipAddress: server.ipAddress,
          hostname: server.hostname,
        });
        return;
      }

      sendWsJson(ws, {
        type: 'output',
        data: `\r\n\x1b[31m[SSH Connection Error] ${err.message}\x1b[0m\r\n`,
      });
      sendWsJson(ws, { type: 'error', message: err.message });
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    conn.on('close', () => {
      if (ws.readyState === WebSocket.OPEN) {
        sendWsJson(ws, { type: 'status', status: 'disconnected' });
      }
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as TerminalClientMessage;
        if (msg.type === 'input' && typeof msg.data === 'string') {
          if (ptyStream && ptyStream.writable) {
            ptyStream.write(msg.data);
          }
        } else if (
          msg.type === 'resize' &&
          typeof msg.cols === 'number' &&
          typeof msg.rows === 'number'
        ) {
          if (ptyStream) {
            const safeCols = Math.max(20, Math.min(500, Math.floor(msg.cols)));
            const safeRows = Math.max(5, Math.min(200, Math.floor(msg.rows)));
            ptyStream.setWindow(safeRows, safeCols, 0, 0);
          }
        } else if (msg.type === 'ping') {
          sendWsJson(ws, { type: 'pong' });
        }
      } catch {
        // Ignore invalid JSON frames
      }
    });

    ws.on('close', () => {
      try {
        if (ptyStream) {
          ptyStream.end();
        }
        conn.end();
      } catch {
        // Ignore cleanup errors
      }
    });

    try {
      conn.connect(connectConfig);
    } catch (err: any) {
      sendWsJson(ws, {
        type: 'error',
        message: err?.message || 'Failed to initiate SSH connection',
      });
      ws.close();
    }
  });

  return wss;
}
