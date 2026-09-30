import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  Maximize2,
  Minimize2,
  RefreshCw,
  Terminal as TerminalIcon,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useI18n } from '../context/I18nContext.tsx';
import { Server } from '../types/server.ts';

interface WebSocketTerminalProps {
  server: Server;
}

type PtyConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

const QUICK_PTY_SNIPPETS = [
  { label: 'uname -a && uptime', cmd: 'uname -a && uptime\r' },
  { label: 'df -h', cmd: 'df -h\r' },
  { label: 'free -m', cmd: 'free -m\r' },
  { label: 'docker ps', cmd: 'docker ps\r' },
  { label: 'ss -tulnp', cmd: 'ss -tulnp\r' },
  { label: 'top -b -n 1 | head -n 20', cmd: 'top -b -n 1 | head -n 20\r' },
];

export const WebSocketTerminal: React.FC<WebSocketTerminalProps> = ({ server }) => {
  const { t } = useI18n();
  const { getFreshToken } = useAuth();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [status, setStatus] = useState<PtyConnectionStatus>('connecting');
  const [ptyMode, setPtyMode] = useState<string>('ssh2-pty');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [sessionSeq, setSessionSeq] = useState<number>(0);

  const sendOverWs = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const handleSendSnippet = (cmd: string) => {
    sendOverWs({ type: 'input', data: cmd });
    termRef.current?.focus();
  };

  const handleClearTerminal = () => {
    termRef.current?.clear();
    termRef.current?.focus();
  };

  const handleReconnect = () => {
    setSessionSeq((prev) => prev + 1);
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 5000,
      convertEol: true,
      theme: {
        background: '#0B1120',
        foreground: '#E2E8F0',
        cursor: '#10B981',
        cursorAccent: '#0B1120',
        selectionBackground: 'rgba(16, 185, 129, 0.28)',
        black: '#0F172A',
        red: '#F43F5E',
        green: '#10B981',
        yellow: '#F59E0B',
        blue: '#38BDF8',
        magenta: '#A855F7',
        cyan: '#06B6D4',
        white: '#F1F5F9',
        brightBlack: '#475569',
        brightRed: '#FB7185',
        brightGreen: '#34D399',
        brightYellow: '#FBBF24',
        brightBlue: '#7DD3FC',
        brightMagenta: '#C084FC',
        brightCyan: '#22D3EE',
        brightWhite: '#FFFFFF',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    try {
      fitAddon.fit();
    } catch {
      // Ignore initial layout fit timing errors
    }

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    let isDisposed = false;
    let activeWs: WebSocket | null = null;

    const inputDisposable = term.onData((data) => {
      if (activeWs && activeWs.readyState === WebSocket.OPEN) {
        activeWs.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (activeWs && activeWs.readyState === WebSocket.OPEN) {
        activeWs.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    const observer = new ResizeObserver(() => {
      if (isDisposed) return;
      try {
        fitAddon.fit();
      } catch {
        // Ignore
      }
    });
    observer.observe(containerRef.current);

    // Connect WebSocket
    (async () => {
      setStatus('connecting');
      const token = (await getFreshToken()) || '';
      if (isDisposed) return;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const cols = term.cols || 100;
      const rows = term.rows || 28;
      const wsUrl = `${proto}//${window.location.host}/ws/terminal?serverId=${encodeURIComponent(
        String(server.id)
      )}&token=${encodeURIComponent(token)}&cols=${cols}&rows=${rows}`;

      const ws = new WebSocket(wsUrl);
      activeWs = ws;
      wsRef.current = ws;

      ws.onopen = () => {
        if (isDisposed) return;
        try {
          fitAddon.fit();
          ws.send(
            JSON.stringify({
              type: 'resize',
              cols: term.cols || 100,
              rows: term.rows || 28,
            })
          );
        } catch {
          // Ignore
        }
      };

      ws.onmessage = (event) => {
        if (isDisposed) return;
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.type === 'output' && typeof msg.data === 'string') {
            term.write(msg.data);
          } else if (msg.type === 'status') {
            if (msg.status === 'connected') {
              setStatus('connected');
              if (msg.mode) setPtyMode(String(msg.mode));
              term.focus();
            } else if (msg.status === 'disconnected') {
              setStatus('disconnected');
            }
          } else if (msg.type === 'error') {
            setStatus('error');
            if (msg.message) {
              term.writeln(`\r\n\x1b[31m[Error] ${msg.message}\x1b[0m`);
            }
          }
        } catch {
          // If raw string fallback
          term.write(String(event.data));
        }
      };

      ws.onerror = () => {
        if (isDisposed) return;
        setStatus('error');
      };

      ws.onclose = () => {
        if (isDisposed) return;
        setStatus((prev) => (prev === 'error' ? 'error' : 'disconnected'));
      };
    })();

    return () => {
      isDisposed = true;
      observer.disconnect();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      if (activeWs) {
        try {
          activeWs.close();
        } catch {
          // Ignore
        }
      }
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [server.id, sessionSeq, getFreshToken]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Ignore
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [isExpanded]);

  return (
    <div className="space-y-3">
      {/* Terminal Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-[#0F172A] px-3.5 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 font-mono text-xs">
            {status === 'connected' ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
                <Wifi className="h-3.5 w-3.5" />
                <span>PTY CONNECTED</span>
              </span>
            ) : status === 'connecting' ? (
              <span className="inline-flex items-center gap-1.5 text-amber-400 font-semibold">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>CONNECTING...</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-rose-400 font-semibold">
                <WifiOff className="h-3.5 w-3.5" />
                <span>DISCONNECTED</span>
              </span>
            )}
          </div>

          <span className="text-slate-700">|</span>

          <span className="font-mono text-xs text-slate-300">
            {server.username}@{server.ip_address}:{server.ssh_port}
          </span>

          <span className="rounded border border-slate-800 bg-[#1E293B] px-2 py-0.5 font-mono text-[11px] text-slate-400">
            xterm-256color · {ptyMode}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleClearTerminal}
            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#1E293B] px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            title={t('Очистить экран терминала', 'Clear terminal screen')}
          >
            <Trash2 className="h-3.5 w-3.5 text-slate-400" />
            <span>{t('Очистить', 'Clear')}</span>
          </button>

          <button
            type="button"
            onClick={handleReconnect}
            className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20"
          >
            <RefreshCw className="h-3.5 w-3.5 text-emerald-400" />
            <span>{t('Переподключить PTY', 'Reconnect PTY')}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#1E293B] px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            {isExpanded ? (
              <>
                <Minimize2 className="h-3.5 w-3.5 text-slate-400" />
                <span>{t('Свернуть', 'Compact')}</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5 text-slate-400" />
                <span>{t('Развернуть', 'Expand')}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Quick Command Bar for Interactive PTY */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium text-slate-400 mr-1 inline-flex items-center gap-1">
          <TerminalIcon className="h-3 w-3 text-emerald-400" />
          {t('Отправить в активный PTY:', 'Send to live PTY:')}
        </span>
        {QUICK_PTY_SNIPPETS.map((snippet) => (
          <button
            key={snippet.label}
            type="button"
            disabled={status !== 'connected'}
            onClick={() => handleSendSnippet(snippet.cmd)}
            className="rounded border border-slate-800 bg-[#0F172A] px-2.5 py-1 font-mono text-[11px] text-slate-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-40"
          >
            {snippet.label}
          </button>
        ))}
      </div>

      {/* Xterm.js Viewport */}
      <div
        className={`w-full overflow-hidden rounded-lg border border-slate-800 bg-[#0B1120] p-2.5 shadow-inner ${
          isExpanded ? 'h-[580px]' : 'h-[380px]'
        }`}
        onClick={() => termRef.current?.focus()}
      >
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
};
