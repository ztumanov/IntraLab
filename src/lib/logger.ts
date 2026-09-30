export type LogLevel = 'info' | 'warn' | 'error';

export interface StructuredLogFields {
  component: string;
  operation: string;
  server_id?: number | string;
  agent_id?: string;
  user_id?: string;
  status_code?: number;
  duration_ms?: number;
  error?: unknown;
  [key: string]: unknown;
}

const SENSITIVE_KEY_PATTERN =
  /password|secret|private_?key|token|authorization|cookie|credential|totp/i;

export function redactSensitiveString(input: string): string {
  if (!input) return input;
  return input
    .replace(/ila_enroll_[a-zA-Z0-9_-]+/g, 'ila_enroll_[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
      '[REDACTED_PRIVATE_KEY]'
    );
}

export function sanitizeLogFields(
  fields: StructuredLogFields
): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};

  for (const [key, rawValue] of Object.entries(fields)) {
    if (rawValue === undefined || rawValue === null) continue;

    if (SENSITIVE_KEY_PATTERN.test(key)) {
      safe[key] = '[REDACTED]';
      continue;
    }

    if (key === 'error') {
      const errMsg =
        rawValue instanceof Error
          ? rawValue.message
          : typeof rawValue === 'string'
            ? rawValue
            : JSON.stringify(rawValue);
      safe.error = redactSensitiveString(errMsg);
      continue;
    }

    if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      safe[key] = rawValue;
    } else if (typeof rawValue === 'string') {
      safe[key] = redactSensitiveString(rawValue);
    } else {
      try {
        safe[key] = redactSensitiveString(JSON.stringify(rawValue));
      } catch {
        safe[key] = '[Object]';
      }
    }
  }

  return safe;
}

export function formatStructuredLog(
  level: LogLevel,
  fields: StructuredLogFields
): string {
  const timestamp = new Date().toISOString();
  const safe = sanitizeLogFields(fields);

  const orderedParts: string[] = [
    `timestamp=${timestamp}`,
    `level=${level}`,
    `component=${safe.component || 'app'}`,
    `operation=${safe.operation || 'unknown'}`,
  ];

  for (const [key, val] of Object.entries(safe)) {
    if (key === 'component' || key === 'operation') continue;
    const strVal = String(val);
    const needsQuotes = /\s|"|=/.test(strVal);
    orderedParts.push(
      needsQuotes ? `${key}="${strVal.replace(/"/g, '\\"')}"` : `${key}=${strVal}`
    );
  }

  return orderedParts.join(' ');
}

export const logger = {
  info(fields: StructuredLogFields): void {
    console.log(formatStructuredLog('info', fields));
  },
  warn(fields: StructuredLogFields): void {
    console.warn(formatStructuredLog('warn', fields));
  },
  error(fields: StructuredLogFields): void {
    console.error(formatStructuredLog('error', fields));
  },
};
