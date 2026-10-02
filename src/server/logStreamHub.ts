import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Response as ExpressResponse } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import ssh2 from 'ssh2';
import type { ConnectConfig, ClientChannel } from 'ssh2';
import {
  verifyAgentCredential,
  verifyAgentMtlsCertificate,
  recordAgentHeartbeat,
} from '../db/agents.ts';
import { servers } from '../db/schema.ts';
import { decryptSecret } from './sshConnector.ts';

type ServerRow = typeof servers.$inferSelect;

const { Client: SshClient } = ssh2;

const VALID_CONTAINER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const VALID_UNIT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,127}$/;
const VALID_SINCE_RE = /^[a-zA-Z0-9:._\-\s+]{1,64}$/;
const VALID_PRIORITIES = new Set([
  '0',
  'emerg',
  '1',
  'alert',
  '2',
  'crit',
  '3',
  'err',
  'error',
  '4',
  'warning',
  'warn',
  '5',
  'notice',
  '6',
  'info',
  '7',
  'debug',
  'all',
]);

const MAX_RING_BUFFER_EVENTS = 250;
const MAX_EVENTS_PER_SECOND = 250;
const MAX_LOG_MESSAGE_BYTES = 16384;

export function truncateLogMessage(msg: string): string {
  const str = String(msg || '');
  if (str.length <= MAX_LOG_MESSAGE_BYTES) {
    return str;
  }
  const excess = str.length - MAX_LOG_MESSAGE_BYTES;
  return `${str.slice(0, MAX_LOG_MESSAGE_BYTES)}... [truncated ${excess} bytes]`;
}

export interface RealTimeLogEvent {
  timestamp: string;
  server_id: number;
  agent_id?: string;
  source: 'journal' | 'docker';
  container_id?: string;
  container_name?: string;
  unit?: string;
  stream?: 'stdout' | 'stderr';
  level?: 'info' | 'warn' | 'error';
  message: string;
}

export interface AgentControlCommand {
  type: 'start_stream' | 'stop_stream' | 'change_source' | 'disconnect_stream' | 'ping';
  stream_id?: string;
  source?: string;
  unit?: string;
  priority?: string;
  since?: string;
  container_id?: string;
  container_name?: string;
  tail?: number;
}

interface SseSubscriber {
  id: string;
  res: ExpressResponse;
  heartbeatTimer: NodeJS.Timeout;
}

interface ActiveStreamSubscription {
  streamId: string;
  serverId: number;
  source: string;
  unit: string;
  priority: string;
  since: string;
  containerId: string;
  tail: number;
  subscribers: Map<string, SseSubscriber>;
  ringBuffer: RealTimeLogEvent[];
  transport: 'agent_mtls' | 'agent_http' | 'ssh_shared';
  sshCleanup?: () => void;
  windowStartMs: number;
  windowCount: number;
  droppedInWindow: number;
}

interface ConnectedAgentSession {
  agentId: string;
  serverId: number;
  authMode: 'mtls' | 'bearer';
  ws?: WebSocket;
  pendingCommands: AgentControlCommand[];
  connectedAt: Date;
  lastSeenAt: Date;
}

export function validateContainerIdentifier(containerId: string): boolean {
  const clean = (containerId || '').trim();
  if (!clean || clean.startsWith('-') || clean.includes('..')) return false;
  return VALID_CONTAINER_ID_RE.test(clean);
}

export function validateUnitIdentifier(unit: string): boolean {
  const clean = (unit || '').trim();
  if (!clean) return true;
  if (clean.startsWith('-') || clean.includes('..')) return false;
  return VALID_UNIT_NAME_RE.test(clean);
}

export function validatePriorityFilter(priority: string): boolean {
  const clean = (priority || '').trim().toLowerCase();
  if (!clean) return true;
  return VALID_PRIORITIES.has(clean);
}

export function validateSinceFilter(since: string): boolean {
  const clean = (since || '').trim();
  if (!clean) return true;
  if (clean.startsWith('-') || clean.includes('..')) return false;
  return VALID_SINCE_RE.test(clean);
}

export function validateTailFilter(rawTail: unknown): { valid: boolean; value: number } {
  if (rawTail === undefined || rawTail === null || String(rawTail).trim() === '') {
    return { valid: true, value: 50 };
  }
  const str = String(rawTail).trim();
  if (!/^\d+$/.test(str)) {
    return { valid: false, value: 50 };
  }
  const num = Number(str);
  if (!Number.isInteger(num) || num <= 0 || num > 5000) {
    return { valid: false, value: 50 };
  }
  return { valid: true, value: Math.min(500, num) };
}

export function classifyLogLevel(
  message: string,
  stream: 'stdout' | 'stderr' = 'stdout'
): 'info' | 'warn' | 'error' {
  const lower = (message || '').toLowerCase();
  if (
    lower.includes('error') ||
    lower.includes('failed') ||
    lower.includes('fatal') ||
    lower.includes('panic') ||
    lower.includes('crit') ||
    lower.includes('denied') ||
    lower.includes('invalid user')
  ) {
    return 'error';
  }
  if (
    lower.includes('warn') ||
    lower.includes('timeout') ||
    lower.includes('retry') ||
    lower.includes('deprecated') ||
    lower.includes('disconnect')
  ) {
    return 'warn';
  }
  if (stream === 'stderr' && lower.includes('err')) {
    return 'error';
  }
  return 'info';
}

export function parseRawStreamLine(
  rawLine: string,
  params: {
    serverId: number;
    agentId?: string;
    source: string;
    unit?: string;
    containerId?: string;
    stream?: 'stdout' | 'stderr';
  }
): RealTimeLogEvent | null {
  const trimmed = (rawLine || '').replace(/\r?\n$/, '');
  if (!trimmed.trim()) return null;

  const stream = params.stream || 'stdout';
  const isDocker =
    params.source === 'docker' && Boolean(params.containerId && params.containerId.trim());

  if (isDocker) {
    const spaceIdx = trimmed.indexOf(' ');
    let timestamp = new Date().toISOString();
    let message = trimmed;
    if (spaceIdx > 0 && spaceIdx <= 35) {
      const candidate = trimmed.slice(0, spaceIdx);
      const parsed = Date.parse(candidate);
      if (!Number.isNaN(parsed)) {
        timestamp = new Date(parsed).toISOString();
        message = trimmed.slice(spaceIdx + 1).trim() || trimmed;
      }
    }
    return {
      timestamp,
      server_id: params.serverId,
      agent_id: params.agentId,
      source: 'docker',
      container_id: params.containerId,
      container_name: params.containerId,
      stream,
      level: classifyLogLevel(message, stream),
      message: truncateLogMessage(message),
    };
  }

  // Parse journalctl short-iso or syslog line
  const isoMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s+(\S+)\s+([^:]+):\s*(.*)$/
  );
  if (isoMatch) {
    const rawUnit = isoMatch[3].trim().replace(/\[\d+\]$/, '');
    const msg = isoMatch[4].trim() || trimmed;
    return {
      timestamp: isoMatch[1],
      server_id: params.serverId,
      agent_id: params.agentId,
      source: 'journal',
      unit: rawUnit || params.unit || params.source,
      stream,
      level: classifyLogLevel(msg, stream),
      message: truncateLogMessage(msg),
    };
  }

  return {
    timestamp: new Date().toISOString(),
    server_id: params.serverId,
    agent_id: params.agentId,
    source: params.source === 'docker' ? 'docker' : 'journal',
    unit: params.unit || (params.source !== 'docker' ? params.source : 'docker.service'),
    container_id: params.containerId || undefined,
    stream,
    level: classifyLogLevel(trimmed, stream),
    message: truncateLogMessage(trimmed),
  };
}

export function extractClientCertificateFromIncomingMessage(
  req: IncomingMessage
): string | Buffer | null {
  const tlsSocket = req.socket as any;
  if (tlsSocket && tlsSocket.encrypted) {
    if (typeof tlsSocket.getPeerCertificate === 'function') {
      const peerCert = tlsSocket.getPeerCertificate(false);
      if (peerCert && peerCert.raw && Buffer.isBuffer(peerCert.raw) && peerCert.raw.length > 0) {
        return peerCert.raw;
      }
    }
    return null;
  }

  const remoteAddr = req.socket?.remoteAddress || '';
  const isLoopbackOrPrivateProxy =
    remoteAddr === '127.0.0.1' ||
    remoteAddr === '::1' ||
    remoteAddr === '::ffff:127.0.0.1' ||
    remoteAddr.startsWith('10.') ||
    remoteAddr.startsWith('172.') ||
    remoteAddr.startsWith('192.168.') ||
    remoteAddr.startsWith('::ffff:10.') ||
    remoteAddr.startsWith('::ffff:172.') ||
    remoteAddr.startsWith('::ffff:192.168.');

  if (
    process.env.TRUST_MTLS_PROXY_HEADERS === 'false' ||
    process.env.AGENT_TRUST_PROXY_CERT_HEADER === 'false' ||
    !isLoopbackOrPrivateProxy
  ) {
    return null;
  }

  const requiredProxySecret = (
    process.env.AGENT_PROXY_SECRET ||
    process.env.MTLS_PROXY_SHARED_SECRET ||
    ''
  ).trim();
  if (requiredProxySecret) {
    const providedProxySecret = String(req.headers['x-infralab-proxy-secret'] || '').trim();
    if (providedProxySecret !== requiredProxySecret) {
      return null;
    }
  }

  const forwardedCert =
    req.headers['x-forwarded-tls-client-cert'] ||
    req.headers['x-amzn-mtls-clientcert'] ||
    req.headers['ssl-client-cert'] ||
    req.headers['x-ssl-client-cert'] ||
    req.headers['x-client-cert'];

  if (typeof forwardedCert === 'string' && forwardedCert.trim().length > 0) {
    let raw = forwardedCert.trim();
    const certMatch = raw.match(/(?:^|[,;\s])Cert="?([^";,]+)"?/i);
    if (certMatch) {
      raw = certMatch[1];
    }
    if (raw.includes('%')) {
      try {
        raw = decodeURIComponent(raw);
      } catch {
        // Keep raw
      }
    }
    if (raw.includes('-----BEGIN CERTIFICATE-----')) {
      return raw;
    }
    try {
      const decoded = Buffer.from(raw.replace(/\s+/g, ''), 'base64');
      const asUtf8 = decoded.toString('utf8');
      if (asUtf8.includes('-----BEGIN CERTIFICATE-----')) {
        return asUtf8;
      }
      if (decoded.length > 64 && decoded[0] === 0x30) {
        return decoded;
      }
    } catch {
      // Fall through
    }
    return raw;
  }

  return null;
}

export async function authenticateAgentIncomingMessage(req: IncomingMessage): Promise<{
  agentId: string;
  serverId: number;
  authMode: 'mtls' | 'bearer';
} | null> {
  const headerAgentId =
    typeof req.headers['x-agent-id'] === 'string' ? req.headers['x-agent-id'].trim() : '';

  const tlsSocket = req.socket as any;
  const clientCert = extractClientCertificateFromIncomingMessage(req);

  if (clientCert) {
    const verified = await verifyAgentMtlsCertificate({
      clientCertPemOrDer: clientCert,
      headerAgentId: headerAgentId || undefined,
      claimedAgentIds: [headerAgentId],
    });
    if (!verified) {
      return null;
    }
    return {
      agentId: verified.agentId,
      serverId: verified.serverId,
      authMode: 'mtls',
    };
  }

  if (tlsSocket && tlsSocket.encrypted && tlsSocket.authorized === false) {
    return null;
  }

  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';

  if (!headerAgentId || !bearerToken) {
    return null;
  }

  const agent = await verifyAgentCredential(headerAgentId, bearerToken);
  if (!agent) {
    return null;
  }
  return {
    agentId: agent.agentId,
    serverId: agent.serverId,
    authMode: 'bearer',
  };
}

function buildStreamId(
  serverId: number,
  source: string,
  unit: string,
  containerId: string,
  priority = '',
  since = ''
): string {
  const normSource = (source || 'journald').trim().toLowerCase();
  const normUnit = (unit || '').trim() || 'all';
  const normContainer = (containerId || '').trim() || 'all';
  const normPriority = (priority || '').trim().toLowerCase() || 'all';
  const normSince = (since || '').trim() || 'live';
  return `stream_${serverId}_${normSource}_${normUnit}_${normContainer}_${normPriority}_${normSince}`;
}

function writeSseFrame(res: ExpressResponse, eventName: string, payload: unknown) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
  } catch {
    // Ignore write errors on closing sockets
  }
}

class RealTimeLogStreamHub {
  private agentSessionsByServer = new Map<number, ConnectedAgentSession>();
  private activeStreams = new Map<string, ActiveStreamSubscription>();
  private subscriberSeq = 0;

  public registerWebSocketAgent(params: {
    agentId: string;
    serverId: number;
    authMode: 'mtls' | 'bearer';
    ws: WebSocket;
  }) {
    const existing = this.agentSessionsByServer.get(params.serverId);
    if (existing?.ws && existing.ws !== params.ws && existing.ws.readyState === WebSocket.OPEN) {
      try {
        existing.ws.close();
      } catch {
        // Ignore
      }
    }

    const session: ConnectedAgentSession = {
      agentId: params.agentId,
      serverId: params.serverId,
      authMode: params.authMode,
      ws: params.ws,
      pendingCommands: [],
      connectedAt: new Date(),
      lastSeenAt: new Date(),
    };
    this.agentSessionsByServer.set(params.serverId, session);

    // Upgrade any active streams on this server to use the live Agent mTLS connection
    for (const sub of this.activeStreams.values()) {
      if (sub.serverId === params.serverId && sub.subscribers.size > 0) {
        if (sub.sshCleanup) {
          sub.sshCleanup();
          sub.sshCleanup = undefined;
        }
        sub.transport = 'agent_mtls';
        this.sendControlToAgent(params.serverId, {
          type: 'start_stream',
          stream_id: sub.streamId,
          source: sub.source,
          unit: sub.unit || undefined,
          priority: sub.priority || undefined,
          since: sub.since || undefined,
          container_id: sub.containerId || undefined,
          tail: sub.tail,
        });
        this.broadcastStatus(sub, {
          status: 'streaming',
          transport: 'agent_mtls',
          agent_id: params.agentId,
          source: sub.source,
          unit: sub.unit || undefined,
          container_id: sub.containerId || undefined,
        });
      }
    }

    params.ws.on('message', (raw) => {
      session.lastSeenAt = new Date();
      try {
        const frame = JSON.parse(String(raw));
        this.handleAgentFrame(params.serverId, params.agentId, frame);
      } catch {
        // Ignore malformed frame
      }
    });

    params.ws.on('close', () => {
      const current = this.agentSessionsByServer.get(params.serverId);
      if (current && current.ws === params.ws) {
        this.agentSessionsByServer.delete(params.serverId);
        // Notify active SSE subscribers for this server that agent disconnected
        for (const sub of this.activeStreams.values()) {
          if (sub.serverId === params.serverId && sub.subscribers.size > 0) {
            this.broadcastStatus(sub, {
              status: 'reconnecting',
              transport: 'agent_mtls',
              agent_id: params.agentId,
              message: 'Agent stream connection closed; waiting for reconnect',
            });
          }
        }
      }
    });
  }

  public isAgentConnected(serverId: number): boolean {
    const sess = this.agentSessionsByServer.get(serverId);
    if (!sess) return false;
    if (sess.ws && sess.ws.readyState === WebSocket.OPEN) {
      return true;
    }
    // Or HTTP polling agent seen within the last 20 seconds
    return Date.now() - sess.lastSeenAt.getTime() < 20_000;
  }

  public getAgentTransportStatus(serverId: number): {
    connected: boolean;
    agentId?: string;
    authMode?: 'mtls' | 'bearer';
    transport?: 'ws' | 'http_poll';
  } {
    const sess = this.agentSessionsByServer.get(serverId);
    if (!sess) return { connected: false };
    if (sess.ws && sess.ws.readyState === WebSocket.OPEN) {
      return {
        connected: true,
        agentId: sess.agentId,
        authMode: sess.authMode,
        transport: 'ws',
      };
    }
    if (Date.now() - sess.lastSeenAt.getTime() < 20_000) {
      return {
        connected: true,
        agentId: sess.agentId,
        authMode: sess.authMode,
        transport: 'http_poll',
      };
    }
    return { connected: false };
  }

  public pollAgentControlCommands(params: {
    agentId: string;
    serverId: number;
    authMode: 'mtls' | 'bearer';
  }): AgentControlCommand[] {
    let sess = this.agentSessionsByServer.get(params.serverId);
    if (!sess) {
      sess = {
        agentId: params.agentId,
        serverId: params.serverId,
        authMode: params.authMode,
        pendingCommands: [],
        connectedAt: new Date(),
        lastSeenAt: new Date(),
      };
      this.agentSessionsByServer.set(params.serverId, sess);

      // Enqueue start_stream for any active subscriptions on this server
      for (const sub of this.activeStreams.values()) {
        if (sub.serverId === params.serverId && sub.subscribers.size > 0) {
          if (sub.sshCleanup) {
            sub.sshCleanup();
            sub.sshCleanup = undefined;
          }
          sub.transport = 'agent_http';
          sess.pendingCommands.push({
            type: 'start_stream',
            stream_id: sub.streamId,
            source: sub.source,
            unit: sub.unit || undefined,
            priority: sub.priority || undefined,
            since: sub.since || undefined,
            container_id: sub.containerId || undefined,
            tail: sub.tail,
          });
        }
      }
    } else {
      sess.lastSeenAt = new Date();
      sess.agentId = params.agentId;
      sess.authMode = params.authMode;
    }

    const commands = [...sess.pendingCommands];
    sess.pendingCommands.length = 0;
    return commands;
  }

  public ingestAgentEvents(
    serverId: number,
    agentId: string,
    streamId: string,
    events: Partial<RealTimeLogEvent>[]
  ) {
    const sess = this.agentSessionsByServer.get(serverId);
    if (sess) {
      sess.lastSeenAt = new Date();
    }
    for (const ev of events) {
      this.handleAgentFrame(serverId, agentId, {
        type: 'log_event',
        stream_id: streamId,
        event: ev,
      });
    }
  }

  public sendControlToAgent(serverId: number, cmd: AgentControlCommand): boolean {
    const sess = this.agentSessionsByServer.get(serverId);
    if (!sess) return false;
    if (sess.ws && sess.ws.readyState === WebSocket.OPEN) {
      try {
        sess.ws.send(JSON.stringify(cmd));
        return true;
      } catch {
        return false;
      }
    }
    sess.pendingCommands.push(cmd);
    return true;
  }

  public disconnectServerAgent(serverId: number, reason = 'agent_disconnected') {
    const sess = this.agentSessionsByServer.get(serverId);
    if (sess) {
      this.agentSessionsByServer.delete(serverId);
      if (sess.ws) {
        try {
          sess.ws.close(1008, reason);
        } catch {
          // Ignore close error
        }
      }
    }
    for (const sub of this.activeStreams.values()) {
      if (sub.serverId === serverId && sub.subscribers.size > 0) {
        this.broadcastStatus(sub, {
          status: 'error',
          transport: sub.transport,
          agent_id: sess?.agentId,
          message: `Agent session terminated: ${reason}`,
        });
      }
    }
  }

  private handleAgentFrame(serverId: number, agentId: string, frame: any) {
    if (!frame || typeof frame !== 'object') return;

    if (typeof frame.agent_id === 'string' && frame.agent_id.trim() && frame.agent_id.trim() !== agentId) {
      return;
    }

    if (frame.type === 'hello') {
      void recordAgentHeartbeat({
        agentId,
        version: '0.2.0',
      }).catch(() => {});
      return;
    }

    const streamId = typeof frame.stream_id === 'string' ? frame.stream_id : '';
    const sub = streamId
      ? this.activeStreams.get(streamId)
      : Array.from(this.activeStreams.values()).find((s) => s.serverId === serverId);

    if (!sub || sub.serverId !== serverId) {
      return;
    }

    if (frame.type === 'stream_status') {
      this.broadcastStatus(sub, {
        status: frame.status || 'streaming',
        transport: sub.transport,
        agent_id: agentId,
        message: frame.message,
      });
      return;
    }

    if (frame.type === 'log_event' && frame.event && typeof frame.event === 'object') {
      const rawEv = frame.event;
      if (
        typeof rawEv.agent_id === 'string' &&
        rawEv.agent_id.trim() &&
        rawEv.agent_id.trim() !== agentId
      ) {
        return;
      }
      if (
        rawEv.server_id !== undefined &&
        rawEv.server_id !== null &&
        Number(rawEv.server_id) !== 0 &&
        Number(rawEv.server_id) !== serverId
      ) {
        return;
      }

      const rawMessage = typeof rawEv.message === 'string' ? rawEv.message : '';
      if (!rawMessage.trim()) return;
      const message = truncateLogMessage(rawMessage);

      const streamType: 'stdout' | 'stderr' =
        rawEv.stream === 'stderr' ? 'stderr' : 'stdout';
      const sourceType: 'journal' | 'docker' =
        rawEv.source === 'docker' ||
        (sub.source === 'docker' && Boolean(sub.containerId || rawEv.container_id))
          ? 'docker'
          : 'journal';

      const normalized: RealTimeLogEvent = {
        timestamp:
          typeof rawEv.timestamp === 'string' && rawEv.timestamp.trim()
            ? rawEv.timestamp.trim()
            : new Date().toISOString(),
        server_id: serverId,
        agent_id: agentId,
        source: sourceType,
        container_id:
          typeof rawEv.container_id === 'string' && rawEv.container_id
            ? rawEv.container_id
            : sub.containerId || undefined,
        container_name:
          typeof rawEv.container_name === 'string' && rawEv.container_name
            ? rawEv.container_name
            : sub.containerId || undefined,
        unit:
          typeof rawEv.unit === 'string' && rawEv.unit
            ? rawEv.unit
            : sub.unit || (sourceType === 'journal' ? sub.source : undefined),
        stream: streamType,
        level:
          rawEv.level === 'error' || rawEv.level === 'warn' || rawEv.level === 'info'
            ? rawEv.level
            : classifyLogLevel(message, streamType),
        message,
      };

      this.publishEventToSubscription(sub, normalized);
    }
  }

  private publishEventToSubscription(
    sub: ActiveStreamSubscription,
    event: RealTimeLogEvent
  ) {
    const now = Date.now();
    if (now - sub.windowStartMs >= 1000) {
      if (sub.droppedInWindow > 0) {
        const dropNotice: RealTimeLogEvent = {
          timestamp: new Date().toISOString(),
          server_id: sub.serverId,
          agent_id: event.agent_id,
          source: event.source,
          unit: 'infralab-rate-limiter',
          stream: 'stderr',
          level: 'warn',
          message: `[Backpressure] Suppressed ${sub.droppedInWindow} high-frequency log events in the last second`,
        };
        this.fanOutLogEvent(sub, dropNotice);
      }
      sub.windowStartMs = now;
      sub.windowCount = 0;
      sub.droppedInWindow = 0;
    }

    sub.windowCount += 1;
    if (sub.windowCount > MAX_EVENTS_PER_SECOND) {
      sub.droppedInWindow += 1;
      return;
    }

    this.fanOutLogEvent(sub, event);
  }

  private fanOutLogEvent(sub: ActiveStreamSubscription, event: RealTimeLogEvent) {
    sub.ringBuffer.push(event);
    if (sub.ringBuffer.length > MAX_RING_BUFFER_EVENTS) {
      sub.ringBuffer.shift();
    }

    for (const [subId, client] of sub.subscribers.entries()) {
      if (client.res.writableEnded || client.res.destroyed) {
        clearInterval(client.heartbeatTimer);
        sub.subscribers.delete(subId);
        continue;
      }
      writeSseFrame(client.res, 'log', event);
    }
  }

  private broadcastStatus(
    sub: ActiveStreamSubscription,
    statusPayload: Record<string, unknown>
  ) {
    for (const [subId, client] of sub.subscribers.entries()) {
      if (client.res.writableEnded || client.res.destroyed) {
        clearInterval(client.heartbeatTimer);
        sub.subscribers.delete(subId);
        continue;
      }
      writeSseFrame(client.res, 'status', {
        stream_id: sub.streamId,
        server_id: sub.serverId,
        timestamp: new Date().toISOString(),
        ...statusPayload,
      });
    }
  }

  public subscribeSseClient(params: {
    server: ServerRow;
    source: string;
    unit?: string;
    priority?: string;
    since?: string;
    containerId?: string;
    tail?: number;
    res: ExpressResponse;
  }): () => void {
    const serverId = params.server.id;
    const source = (params.source || 'journald').trim().toLowerCase();
    const unit = (params.unit || '').trim();
    const priority = (params.priority || '').trim().toLowerCase();
    const since = (params.since || '').trim();
    const containerId = (params.containerId || '').trim();
    const tail = Math.min(500, Math.max(1, Number(params.tail) || 50));

    const streamId = buildStreamId(serverId, source, unit, containerId, priority, since);
    let sub = this.activeStreams.get(streamId);
    const isFirstSubscriber = !sub || sub.subscribers.size === 0;

    if (!sub) {
      const agentConnected = this.isAgentConnected(serverId);
      sub = {
        streamId,
        serverId,
        source,
        unit,
        priority,
        since,
        containerId,
        tail,
        subscribers: new Map(),
        ringBuffer: [],
        transport: agentConnected ? 'agent_mtls' : 'ssh_shared',
        windowStartMs: Date.now(),
        windowCount: 0,
        droppedInWindow: 0,
      };
      this.activeStreams.set(streamId, sub);
    }

    this.subscriberSeq += 1;
    const subscriberId = `sse_${serverId}_${this.subscriberSeq}`;

    const heartbeatTimer = setInterval(() => {
      if (!params.res.writableEnded && !params.res.destroyed) {
        try {
          params.res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
        } catch {
          // Ignore
        }
      }
    }, 15_000);
    if (typeof heartbeatTimer.unref === 'function') {
      heartbeatTimer.unref();
    }

    sub.subscribers.set(subscriberId, {
      id: subscriberId,
      res: params.res,
      heartbeatTimer,
    });

    const agentStatus = this.getAgentTransportStatus(serverId);
    writeSseFrame(params.res, 'status', {
      status: agentStatus.connected ? 'streaming' : 'connecting',
      stream_id: streamId,
      server_id: serverId,
      source,
      unit: unit || undefined,
      container_id: containerId || undefined,
      transport: agentStatus.connected ? 'agent_mtls' : 'ssh_shared',
      agent_id: agentStatus.agentId,
      timestamp: new Date().toISOString(),
    });

    // Replay recent buffered events to the newly connected browser client
    if (sub.ringBuffer.length > 0) {
      const replaySlice = sub.ringBuffer.slice(-Math.min(tail, sub.ringBuffer.length));
      for (const bufferedEvent of replaySlice) {
        writeSseFrame(params.res, 'log', bufferedEvent);
      }
    }

    if (isFirstSubscriber) {
      if (agentStatus.connected) {
        sub.transport = agentStatus.transport === 'ws' ? 'agent_mtls' : 'agent_http';
        this.sendControlToAgent(serverId, {
          type: 'start_stream',
          stream_id: streamId,
          source,
          unit: unit || undefined,
          priority: priority || undefined,
          since: since || undefined,
          container_id: containerId || undefined,
          tail,
        });
      } else {
        sub.transport = 'ssh_shared';
        this.startSharedSshStream(params.server, sub);
      }
    }

    let cleanedUp = false;
    return () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(heartbeatTimer);

      const currentSub = this.activeStreams.get(streamId);
      if (!currentSub) return;

      currentSub.subscribers.delete(subscriberId);
      if (currentSub.subscribers.size === 0) {
        if (currentSub.sshCleanup) {
          currentSub.sshCleanup();
          currentSub.sshCleanup = undefined;
        }
        this.sendControlToAgent(serverId, {
          type: 'stop_stream',
          stream_id: streamId,
        });
        this.activeStreams.delete(streamId);
      }
    };
  }

  private startSharedSshStream(server: ServerRow, sub: ActiveStreamSubscription) {
    const secret = decryptSecret(server.encryptedSecret || '');
    if (!secret || !secret.trim()) {
      this.broadcastStatus(sub, {
        status: 'waiting_for_agent',
        transport: 'agent_mtls',
        message: 'Waiting for infralab-agent mTLS stream connection',
      });
      return;
    }

    let remoteCmd = '';
    if (sub.source === 'docker' && sub.containerId) {
      if (!validateContainerIdentifier(sub.containerId)) {
        this.broadcastStatus(sub, {
          status: 'error',
          message: 'Invalid container identifier',
        });
        return;
      }
      remoteCmd = `if docker info >/dev/null 2>&1; then exec docker logs --follow --timestamps --tail ${sub.tail} ${sub.containerId}; else exec sudo -n docker logs --follow --timestamps --tail ${sub.tail} ${sub.containerId}; fi`;
    } else if (sub.source === 'auth') {
      remoteCmd = `exec journalctl -u ssh -u sshd -n ${sub.tail} -f --no-pager -o short-iso 2>/dev/null || exec tail -n ${sub.tail} -F /var/log/auth.log /var/log/secure 2>/dev/null`;
    } else if (sub.source === 'kernel') {
      remoteCmd = `exec journalctl -k -n ${sub.tail} -f --no-pager -o short-iso 2>/dev/null || dmesg -T -w 2>/dev/null`;
    } else if (sub.source === 'docker') {
      remoteCmd = `exec journalctl -u docker -n ${sub.tail} -f --no-pager -o short-iso 2>/dev/null`;
    } else if (sub.unit && validateUnitIdentifier(sub.unit)) {
      remoteCmd = `exec journalctl -u ${sub.unit} -n ${sub.tail} -f --no-pager -o short-iso 2>/dev/null`;
    } else {
      remoteCmd = `exec journalctl -n ${sub.tail} -f --no-pager -o short-iso 2>/dev/null || exec tail -n ${sub.tail} -F /var/log/syslog /var/log/messages 2>/dev/null`;
    }

    const conn = new SshClient();
    let sshChannel: ClientChannel | null = null;
    let closed = false;

    sub.sshCleanup = () => {
      if (closed) return;
      closed = true;
      try {
        if (sshChannel) {
          sshChannel.signal('TERM');
          sshChannel.close();
        }
      } catch {
        // Ignore
      }
      try {
        conn.end();
      } catch {
        // Ignore
      }
    };

    const connectConfig: ConnectConfig = {
      host: server.ipAddress,
      port: server.sshPort,
      username: server.username,
      readyTimeout: 6000,
      keepaliveInterval: 15000,
    };
    if (server.authType === 'private_key') {
      connectConfig.privateKey = secret;
    } else {
      connectConfig.password = secret;
    }

    conn.on('ready', () => {
      if (closed || sub.subscribers.size === 0) {
        conn.end();
        return;
      }
      conn.exec(remoteCmd, (err, stream) => {
        if (err || closed) {
          conn.end();
          return;
        }
        sshChannel = stream;
        this.broadcastStatus(sub, {
          status: 'streaming',
          transport: 'ssh_shared',
          source: sub.source,
          unit: sub.unit || undefined,
          container_id: sub.containerId || undefined,
        });

        let stdoutCarry = '';
        let stderrCarry = '';

        const processChunk = (chunk: Buffer, streamType: 'stdout' | 'stderr') => {
          const text =
            (streamType === 'stdout' ? stdoutCarry : stderrCarry) + chunk.toString('utf8');
          const lines = text.split('\n');
          const remainder = lines.pop() || '';
          if (streamType === 'stdout') {
            stdoutCarry = remainder;
          } else {
            stderrCarry = remainder;
          }

          for (const line of lines) {
            const ev = parseRawStreamLine(line, {
              serverId: server.id,
              source: sub.source,
              unit: sub.unit,
              containerId: sub.containerId,
              stream: streamType,
            });
            if (ev) {
              this.publishEventToSubscription(sub, ev);
            }
          }
        };

        stream.on('data', (chunk: Buffer) => processChunk(chunk, 'stdout'));
        stream.stderr?.on('data', (chunk: Buffer) => processChunk(chunk, 'stderr'));

        stream.on('close', () => {
          conn.end();
        });
      });
    });

    conn.on('error', () => {
      // If SSH is unavailable (e.g. test server or agent-only host), stay open waiting for Agent events
      this.broadcastStatus(sub, {
        status: 'waiting_for_agent',
        transport: 'agent_mtls',
        message: 'Listening for real-time events from infralab-agent',
      });
    });

    try {
      conn.connect(connectConfig);
    } catch {
      // Ignore immediate connect error
    }
  }
}

export const logStreamHub = new RealTimeLogStreamHub();

export function attachAgentLogStreamWebSocketServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
    try {
      const reqUrl = new URL(request.url || '/', 'http://localhost');
      if (reqUrl.pathname !== '/api/agents/logs/ws') {
        return;
      }

      authenticateAgentIncomingMessage(request)
        .then((auth) => {
          if (!auth) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }

          wss.handleUpgrade(request, socket, head, (ws) => {
            logStreamHub.registerWebSocketAgent({
              agentId: auth.agentId,
              serverId: auth.serverId,
              authMode: auth.authMode,
              ws,
            });
          });
        })
        .catch(() => {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
        });
    } catch {
      socket.destroy();
    }
  });

  return wss;
}
