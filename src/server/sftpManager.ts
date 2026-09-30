import path from 'node:path';
import { executeSshCommand } from './sshConnector.ts';
import type {
  SftpDirectoryListResponse,
  SftpEntryType,
  SftpFileEntry,
  SftpFileReadResponse,
} from '../types/server.ts';

export interface SshConnectionParams {
  serverId: number;
  ipAddress: string;
  sshPort: number;
  username: string;
  authType: 'password' | 'private_key';
  encryptedSecret: string;
}

function normalizeRemotePath(rawPath: string): string {
  const trimmed = (rawPath || '/').trim();
  if (!trimmed || trimmed === '~') return '/root';
  const normalized = path.posix.normalize(trimmed.startsWith('/') ? trimmed : `/${trimmed}`);
  return normalized || '/';
}

function getParentPosixPath(cleanPath: string): string | null {
  if (cleanPath === '/' || !cleanPath) return null;
  const parent = path.posix.dirname(cleanPath);
  return parent || '/';
}

function shellEscapeSingle(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function parseLsModeType(perms: string): SftpEntryType {
  if (perms.startsWith('d')) return 'directory';
  if (perms.startsWith('l')) return 'symlink';
  return 'file';
}

export async function listRemoteDirectoryOverSsh(
  conn: SshConnectionParams,
  targetPath: string
): Promise<SftpDirectoryListResponse> {
  const cleanPath = normalizeRemotePath(targetPath);
  const escapedPath = shellEscapeSingle(cleanPath);

  const cmd = [
    `TARGET=${escapedPath}`,
    'if [ ! -e "$TARGET" ]; then echo "___ERR_NOT_FOUND___"; exit 0; fi',
    'if [ ! -d "$TARGET" ]; then echo "___ERR_NOT_DIR___"; exit 0; fi',
    'cd "$TARGET" 2>/dev/null || { echo "___ERR_PERM___"; exit 0; }',
    'REAL_PWD=$(pwd -P 2>/dev/null || pwd)',
    'echo "___REAL_PATH___|$REAL_PWD"',
    'echo "___ENTRIES___"',
    'LC_ALL=C ls -la --time-style="+%Y-%m-%d %H:%M:%S" 2>/dev/null || LC_ALL=C ls -la 2>/dev/null',
  ].join('\n');

  const res = await executeSshCommand({
    ipAddress: conn.ipAddress,
    sshPort: conn.sshPort,
    username: conn.username,
    authType: conn.authType,
    encryptedSecret: conn.encryptedSecret,
    command: cmd,
  });

  const out = res.stdout || '';
  if (out.includes('___ERR_NOT_FOUND___')) {
    return {
      server_id: conn.serverId,
      path: cleanPath,
      parent_path: getParentPosixPath(cleanPath),
      entries: [],
      exists: false,
      listed_at: new Date().toISOString(),
    };
  }
  if (out.includes('___ERR_NOT_DIR___')) {
    throw new Error(`Указанный путь не является директорией: ${cleanPath}`);
  }
  if (out.includes('___ERR_PERM___')) {
    throw new Error(`Недостаточно прав для чтения директории: ${cleanPath}`);
  }

  let resolvedPath = cleanPath;
  const lines = out.split('\n');
  let inEntries = false;
  const entries: SftpFileEntry[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.startsWith('___REAL_PATH___|')) {
      const p = line.split('|')[1]?.trim();
      if (p && p.startsWith('/')) {
        resolvedPath = p;
      }
      continue;
    }
    if (line === '___ENTRIES___') {
      inEntries = true;
      continue;
    }
    if (!inEntries) continue;
    if (line.startsWith('total ')) continue;

    // Parse standard `ls -la --time-style="+%Y-%m-%d %H:%M:%S"` output:
    // drwxr-xr-x 2 root root 4096 2026-09-30 10:15:22 sites-available
    const matchWithIso = line.match(
      /^([bcdlsp-][rwxstST-]{9}[+@.]?)\s+\d+\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(.+)$/
    );

    let perms = '';
    let owner = 'root';
    let group = 'root';
    let size = 0;
    let modifiedAt = '';
    let rawName = '';

    if (matchWithIso) {
      perms = matchWithIso[1];
      owner = matchWithIso[2];
      group = matchWithIso[3];
      size = Number(matchWithIso[4]) || 0;
      modifiedAt = matchWithIso[5];
      rawName = matchWithIso[6];
    } else {
      // Fallback for BusyBox / BSD `ls -la`:
      // drwxr-xr-x 2 root root 4096 Sep 30 10:15 sites-available
      const matchFallback = line.match(
        /^([bcdlsp-][rwxstST-]{9}[+@.]?)\s+\d+\s+(\S+)\s+(\S+)\s+(\d+)\s+([A-Za-z]{3}\s+\d+\s+[\d:]+)\s+(.+)$/
      );
      if (!matchFallback) continue;
      perms = matchFallback[1];
      owner = matchFallback[2];
      group = matchFallback[3];
      size = Number(matchFallback[4]) || 0;
      modifiedAt = matchFallback[5];
      rawName = matchFallback[6];
    }

    let name = rawName;
    if (perms.startsWith('l') && rawName.includes(' -> ')) {
      name = rawName.split(' -> ')[0];
    }
    if (!name || name === '.' || name === '..') continue;

    const entryType = parseLsModeType(perms);
    const fullEntryPath =
      resolvedPath === '/' ? `/${name}` : `${resolvedPath}/${name}`;

    entries.push({
      name,
      path: fullEntryPath,
      type: entryType,
      size,
      permissions: perms,
      owner,
      group,
      modified_at: modifiedAt,
    });
  }

  // Sort directories first, then alphabetically by name
  entries.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    server_id: conn.serverId,
    path: resolvedPath,
    parent_path: getParentPosixPath(resolvedPath),
    entries,
    exists: true,
    listed_at: new Date().toISOString(),
  };
}

const MAX_READ_BYTES = 2 * 1024 * 1024; // 2 MB max in-browser preview/download

export async function readRemoteFileOverSsh(
  conn: SshConnectionParams,
  filePath: string,
  useSudo = false
): Promise<SftpFileReadResponse> {
  const cleanPath = normalizeRemotePath(filePath);
  const escapedPath = shellEscapeSingle(cleanPath);
  const sudoPrefix = useSudo ? 'sudo -n ' : '';

  const cmd = [
    `FILE=${escapedPath}`,
    `if ! ${sudoPrefix}test -e "$FILE"; then echo "___ERR_NOT_FOUND___"; exit 0; fi`,
    `if ${sudoPrefix}test -d "$FILE"; then echo "___ERR_IS_DIR___"; exit 0; fi`,
    `SIZE=$(${sudoPrefix}wc -c < "$FILE" 2>/dev/null | tr -d ' ' || echo 0)`,
    'echo "___META___|$SIZE"',
    'echo "___B64_START___"',
    `${sudoPrefix}head -c ${MAX_READ_BYTES} "$FILE" 2>/dev/null | base64 | tr -d '\\n\\r'`,
    'echo ""',
    'echo "___B64_END___"',
  ].join('\n');

  const res = await executeSshCommand({
    ipAddress: conn.ipAddress,
    sshPort: conn.sshPort,
    username: conn.username,
    authType: conn.authType,
    encryptedSecret: conn.encryptedSecret,
    command: cmd,
  });

  const out = res.stdout || '';
  if (out.includes('___ERR_NOT_FOUND___')) {
    throw new Error(`Файл не найден: ${cleanPath}`);
  }
  if (out.includes('___ERR_IS_DIR___')) {
    throw new Error(`Указанный путь является директорией, а не файлом: ${cleanPath}`);
  }

  const metaLine = out.split('\n').find((l) => l.startsWith('___META___|'));
  const totalSize = metaLine ? Number(metaLine.split('|')[1]) || 0 : 0;

  const startIdx = out.indexOf('___B64_START___');
  const endIdx = out.indexOf('___B64_END___');
  const b64Payload =
    startIdx !== -1 && endIdx !== -1 && endIdx > startIdx
      ? out
          .slice(startIdx + '___B64_START___'.length, endIdx)
          .replace(/\s+/g, '')
      : '';

  const buffer = Buffer.from(b64Payload, 'base64');
  // Detect if file is binary (contains null bytes in first 8000 bytes)
  const checkLen = Math.min(buffer.length, 8000);
  let isBinary = false;
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0) {
      isBinary = true;
      break;
    }
  }

  const fileName = path.posix.basename(cleanPath) || cleanPath;
  const truncated = totalSize > MAX_READ_BYTES;

  return {
    server_id: conn.serverId,
    path: cleanPath,
    name: fileName,
    size: totalSize || buffer.length,
    encoding: isBinary ? 'base64' : 'utf8',
    is_binary: isBinary,
    truncated,
    content: isBinary ? b64Payload : buffer.toString('utf8'),
    read_at: new Date().toISOString(),
  };
}

export async function writeRemoteFileOverSsh(
  conn: SshConnectionParams,
  params: {
    path: string;
    content: string;
    encoding?: 'utf8' | 'base64';
    useSudo?: boolean;
  }
): Promise<{ path: string; size: number; updated_at: string }> {
  const cleanPath = normalizeRemotePath(params.path);
  const parentDir = path.posix.dirname(cleanPath);
  const buffer =
    params.encoding === 'base64'
      ? Buffer.from(params.content || '', 'base64')
      : Buffer.from(params.content || '', 'utf8');

  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error('Размер файла превышает лимит 5 МБ для браузерной загрузки SFTP.');
  }

  const b64 = buffer.toString('base64');
  const escapedTarget = shellEscapeSingle(cleanPath);
  const escapedDir = shellEscapeSingle(parentDir);
  const sudoPrefix = params.useSudo ? 'sudo -n ' : '';

  const cmd = [
    'set -e',
    `${sudoPrefix}mkdir -p ${escapedDir}`,
    `echo '${b64}' | base64 -d | ${sudoPrefix}tee ${escapedTarget} >/dev/null`,
    'echo "___WRITE_OK___"',
  ].join('\n');

  const res = await executeSshCommand({
    ipAddress: conn.ipAddress,
    sshPort: conn.sshPort,
    username: conn.username,
    authType: conn.authType,
    encryptedSecret: conn.encryptedSecret,
    command: cmd,
  });

  if (res.exitCode !== 0 || !(res.stdout || '').includes('___WRITE_OK___')) {
    throw new Error(
      res.stderr?.trim() ||
        `Не удалось записать файл ${cleanPath} (код ${res.exitCode}). Попробуйте включить опцию sudo.`
    );
  }

  return {
    path: cleanPath,
    size: buffer.length,
    updated_at: new Date().toISOString(),
  };
}

export async function createRemoteDirectoryOverSsh(
  conn: SshConnectionParams,
  dirPath: string,
  useSudo = false
): Promise<{ path: string; created_at: string }> {
  const cleanPath = normalizeRemotePath(dirPath);
  const escapedTarget = shellEscapeSingle(cleanPath);
  const sudoPrefix = useSudo ? 'sudo -n ' : '';

  const cmd = [
    'set -e',
    `${sudoPrefix}mkdir -p ${escapedTarget}`,
    'echo "___MKDIR_OK___"',
  ].join('\n');

  const res = await executeSshCommand({
    ipAddress: conn.ipAddress,
    sshPort: conn.sshPort,
    username: conn.username,
    authType: conn.authType,
    encryptedSecret: conn.encryptedSecret,
    command: cmd,
  });

  if (res.exitCode !== 0 || !(res.stdout || '').includes('___MKDIR_OK___')) {
    throw new Error(
      res.stderr?.trim() || `Не удалось создать директорию ${cleanPath}`
    );
  }

  return {
    path: cleanPath,
    created_at: new Date().toISOString(),
  };
}

export async function deleteRemotePathOverSsh(
  conn: SshConnectionParams,
  targetPath: string,
  useSudo = false
): Promise<{ deleted_path: string }> {
  const cleanPath = normalizeRemotePath(targetPath);
  const forbiddenRoots = new Set([
    '/',
    '/bin',
    '/boot',
    '/dev',
    '/etc',
    '/home',
    '/lib',
    '/lib64',
    '/opt',
    '/proc',
    '/root',
    '/run',
    '/sbin',
    '/sys',
    '/tmp',
    '/usr',
    '/var',
  ]);

  if (forbiddenRoots.has(cleanPath)) {
    throw new Error(`Запрещено удалять системную корневую директорию: ${cleanPath}`);
  }

  const escapedTarget = shellEscapeSingle(cleanPath);
  const sudoPrefix = useSudo ? 'sudo -n ' : '';

  const cmd = [
    'set -e',
    `if ${sudoPrefix}test -d ${escapedTarget}; then`,
    `  ${sudoPrefix}rmdir ${escapedTarget} 2>/dev/null || ${sudoPrefix}rm -rf ${escapedTarget}`,
    'else',
    `  ${sudoPrefix}rm -f ${escapedTarget}`,
    'fi',
    'echo "___DELETE_OK___"',
  ].join('\n');

  const res = await executeSshCommand({
    ipAddress: conn.ipAddress,
    sshPort: conn.sshPort,
    username: conn.username,
    authType: conn.authType,
    encryptedSecret: conn.encryptedSecret,
    command: cmd,
  });

  if (res.exitCode !== 0 || !(res.stdout || '').includes('___DELETE_OK___')) {
    throw new Error(
      res.stderr?.trim() || `Не удалось удалить ${cleanPath}`
    );
  }

  return { deleted_path: cleanPath };
}
