import React, { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowUp,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Download,
  FileCode,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  KeyRound,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server as ServerIcon,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  readSftpFile,
  useCreateSftpDirectory,
  useDeleteSftpPath,
  useServers,
  useSftpDirectory,
  useWriteSftpFile,
} from '../hooks/useServers.ts';
import { SftpFileEntry, SftpFileReadResponse } from '../types/server.ts';
import { useI18n } from '../context/I18nContext.tsx';

interface LayoutOutletContext {
  openAddServerModal: () => void;
}

const QUICK_BOOKMARKS: {
  labelRu: string;
  labelEn: string;
  path: string;
  hint: string;
}[] = [
  {
    labelRu: '/etc/nginx (Nginx)',
    labelEn: '/etc/nginx (Nginx)',
    path: '/etc/nginx',
    hint: 'nginx.conf, sites-available',
  },
  {
    labelRu: '/root (Docker / Compose)',
    labelEn: '/root (Docker / Compose)',
    path: '/root',
    hint: 'docker-compose.yml, .env',
  },
  {
    labelRu: '/opt (Сервисы / Стеки)',
    labelEn: '/opt (Services / Stacks)',
    path: '/opt',
    hint: 'App stacks & compose',
  },
  {
    labelRu: '/var/log (Логи ОС)',
    labelEn: '/var/log (System Logs)',
    path: '/var/log',
    hint: 'syslog, nginx, auth.log',
  },
  {
    labelRu: '/etc/systemd/system',
    labelEn: '/etc/systemd/system',
    path: '/etc/systemd/system',
    hint: '*.service units',
  },
  {
    labelRu: '/etc/docker',
    labelEn: '/etc/docker',
    path: '/etc/docker',
    hint: 'daemon.json',
  },
  {
    labelRu: '/etc',
    labelEn: '/etc',
    path: '/etc',
    hint: 'System configs',
  },
];

const CONFIG_TEMPLATES: {
  id: string;
  name: string;
  labelRu: string;
  labelEn: string;
  content: string;
}[] = [
  {
    id: 'docker-compose',
    name: 'docker-compose.yml',
    labelRu: 'Шаблон docker-compose.yml',
    labelEn: 'docker-compose.yml template',
    content: `services:
  app:
    image: nginx:alpine
    container_name: web-proxy
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
`,
  },
  {
    id: 'nginx-vhost',
    name: 'default.conf',
    labelRu: 'Шаблон Nginx Reverse Proxy',
    labelEn: 'Nginx Reverse Proxy vhost',
    content: `server {
    listen 80;
    server_name example.com;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`,
  },
  {
    id: 'dotenv',
    name: '.env',
    labelRu: 'Шаблон .env файла',
    labelEn: '.env configuration file',
    content: `NODE_ENV=production
PORT=3000
TZ=UTC
`,
  },
];

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export const SftpFileManagerPage: React.FC = () => {
  const { t } = useI18n();
  const { openAddServerModal } = useOutletContext<LayoutOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: servers = [], isLoading: isLoadingServers } = useServers();

  const paramServerId = Number(searchParams.get('serverId'));
  const paramPath = searchParams.get('path') || '/etc';

  const [selectedServerId, setSelectedServerId] = useState<number>(0);
  const [currentPath, setCurrentPath] = useState<string>(paramPath);
  const [pathInput, setPathInput] = useState<string>(paramPath);
  const [filterQuery, setFilterQuery] = useState<string>('');
  const [useSudo, setUseSudo] = useState<boolean>(true);

  // Active file editor state
  const [openedFile, setOpenedFile] = useState<SftpFileReadResponse | null>(null);
  const [editorContent, setEditorContent] = useState<string>('');
  const [isReadingFile, setIsReadingFile] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Modals / inline creation bars
  const [showNewFileBar, setShowNewFileBar] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>('docker-compose.yml');
  const [showNewFolderBar, setShowNewFolderBar] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (servers.length === 0) return;
    if (paramServerId && servers.some((s) => s.id === paramServerId)) {
      setSelectedServerId(paramServerId);
      return;
    }
    if (!selectedServerId || !servers.some((s) => s.id === selectedServerId)) {
      const firstOnline = servers.find((s) => s.status === 'online');
      const fallbackId = (firstOnline || servers[0]).id;
      setSelectedServerId(fallbackId);
    }
  }, [servers, paramServerId, selectedServerId]);

  const activeServer =
    servers.find((s) => s.id === selectedServerId) || servers[0] || null;

  const {
    data: dirData,
    isLoading: isDirLoading,
    isFetching: isDirFetching,
    error: dirError,
    refetch: refetchDir,
  } = useSftpDirectory(activeServer?.id || 0, currentPath);

  const writeMutation = useWriteSftpFile();
  const mkdirMutation = useCreateSftpDirectory();
  const deleteMutation = useDeleteSftpPath();

  useEffect(() => {
    if (dirData?.path) {
      setPathInput(dirData.path);
    }
  }, [dirData?.path]);

  const navigateToPath = (nextPath: string) => {
    const clean = (nextPath || '/').trim() || '/';
    setCurrentPath(clean);
    setPathInput(clean);
    setFilterQuery('');
    if (activeServer) {
      setSearchParams(
        { serverId: String(activeServer.id), path: clean },
        { replace: true }
      );
    }
  };

  const handleSelectServer = (id: number) => {
    setSelectedServerId(id);
    setOpenedFile(null);
    setStatusMessage(null);
    setSearchParams({ serverId: String(id), path: currentPath }, { replace: true });
  };

  const handleOpenFile = async (entry: SftpFileEntry) => {
    if (!activeServer) return;
    if (entry.type === 'directory') {
      navigateToPath(entry.path);
      return;
    }

    setStatusMessage(null);
    setIsReadingFile(true);
    try {
      const fileData = await readSftpFile(activeServer.id, entry.path, useSudo);
      setOpenedFile(fileData);
      setEditorContent(fileData.is_binary ? '' : fileData.content);
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || t('Не удалось открыть файл', 'Failed to open file'),
      });
    } finally {
      setIsReadingFile(false);
    }
  };

  const handleDownloadFile = async (filePath: string, fileName: string) => {
    if (!activeServer) return;
    setStatusMessage(null);
    try {
      const fileData = await readSftpFile(activeServer.id, filePath, useSudo);
      let blob: Blob;
      if (fileData.encoding === 'base64') {
        const byteCharacters = atob(fileData.content);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        blob = new Blob([byteArray], { type: 'application/octet-stream' });
      } else {
        blob = new Blob([fileData.content], { type: 'text/plain;charset=utf-8' });
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || fileData.name || 'config.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatusMessage({
        type: 'success',
        text: t(
          `Файл «${fileName}» успешно скачан (${formatBytes(fileData.size)})`,
          `Downloaded "${fileName}" (${formatBytes(fileData.size)})`
        ),
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text:
          err?.message ||
          t('Не удалось скачать файл с сервера', 'Failed to download file from server'),
      });
    }
  };

  const handleSaveOpenedFile = async () => {
    if (!activeServer || !openedFile || openedFile.is_binary) return;
    setStatusMessage(null);
    try {
      const saved = await writeMutation.mutateAsync({
        serverId: activeServer.id,
        path: openedFile.path,
        content: editorContent,
        encoding: 'utf8',
        useSudo,
      });
      setOpenedFile({
        ...openedFile,
        size: saved.size,
        content: editorContent,
        read_at: saved.updated_at,
      });
      setStatusMessage({
        type: 'success',
        text: t(
          `Изменения сохранены на сервер: ${saved.path} (${formatBytes(saved.size)})`,
          `Saved changes to server: ${saved.path} (${formatBytes(saved.size)})`
        ),
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text:
          err?.message ||
          t('Ошибка сохранения файла на сервер', 'Failed to save file to server'),
      });
    }
  };

  const handleUploadBrowserFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeServer) return;
    e.target.value = '';

    if (file.size > 5 * 1024 * 1024) {
      setStatusMessage({
        type: 'error',
        text: t(
          'Максимальный размер загружаемого через браузер файла — 5 МБ',
          'Maximum browser upload file size is 5 MB'
        ),
      });
      return;
    }

    setStatusMessage(null);
    try {
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const b64Content = btoa(binary);
      const baseDir = dirData?.path || currentPath;
      const targetPath =
        baseDir === '/' ? `/${file.name}` : `${baseDir.replace(/\/+$/, '')}/${file.name}`;

      const res = await writeMutation.mutateAsync({
        serverId: activeServer.id,
        path: targetPath,
        content: b64Content,
        encoding: 'base64',
        useSudo,
      });

      setStatusMessage({
        type: 'success',
        text: t(
          `Файл «${file.name}» (${formatBytes(res.size)}) успешно загружен в ${res.path}`,
          `Uploaded "${file.name}" (${formatBytes(res.size)}) to ${res.path}`
        ),
      });
      await refetchDir();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text:
          err?.message ||
          t('Не удалось загрузить файл на сервер', 'Failed to upload file to server'),
      });
    }
  };

  const handleCreateNewFile = async (templateContent = '') => {
    if (!activeServer || !newFileName.trim()) return;
    const cleanName = newFileName.trim().replace(/^\/+/, '');
    const baseDir = dirData?.path || currentPath;
    const fullPath =
      baseDir === '/' ? `/${cleanName}` : `${baseDir.replace(/\/+$/, '')}/${cleanName}`;

    setStatusMessage(null);
    try {
      await writeMutation.mutateAsync({
        serverId: activeServer.id,
        path: fullPath,
        content: templateContent,
        encoding: 'utf8',
        useSudo,
      });
      setShowNewFileBar(false);
      await refetchDir();
      const fileData = await readSftpFile(activeServer.id, fullPath, useSudo);
      setOpenedFile(fileData);
      setEditorContent(fileData.content);
      setStatusMessage({
        type: 'success',
        text: t(`Создан файл ${fullPath}`, `Created file ${fullPath}`),
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || t('Не удалось создать файл', 'Failed to create file'),
      });
    }
  };

  const handleCreateNewFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeServer || !newFolderName.trim()) return;
    const cleanName = newFolderName.trim().replace(/^\/+/, '');
    const baseDir = dirData?.path || currentPath;
    const fullPath =
      baseDir === '/' ? `/${cleanName}` : `${baseDir.replace(/\/+$/, '')}/${cleanName}`;

    setStatusMessage(null);
    try {
      await mkdirMutation.mutateAsync({
        serverId: activeServer.id,
        path: fullPath,
        useSudo,
      });
      setNewFolderName('');
      setShowNewFolderBar(false);
      await refetchDir();
      setStatusMessage({
        type: 'success',
        text: t(`Создана папка ${fullPath}`, `Created folder ${fullPath}`),
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text:
          err?.message ||
          t('Не удалось создать папку на сервере', 'Failed to create directory'),
      });
    }
  };

  const handleConfirmDelete = async (pathToDelete: string) => {
    if (!activeServer) return;
    setStatusMessage(null);
    try {
      await deleteMutation.mutateAsync({
        serverId: activeServer.id,
        path: pathToDelete,
        useSudo,
      });
      if (openedFile?.path === pathToDelete) {
        setOpenedFile(null);
      }
      setConfirmDeletePath(null);
      await refetchDir();
      setStatusMessage({
        type: 'success',
        text: t(`Удалено: ${pathToDelete}`, `Deleted: ${pathToDelete}`),
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || t('Ошибка при удалении', 'Failed to delete item'),
      });
    }
  };

  if (isLoadingServers) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 animate-pulse rounded bg-slate-800" />
        <div className="h-96 w-full animate-pulse rounded-lg border border-slate-800 bg-[#1E293B]" />
      </div>
    );
  }

  if (servers.length === 0 || !activeServer) {
    return (
      <div className="space-y-6">
        <div className="border-b border-slate-800 pb-5">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t('Файловый менеджер SFTP', 'SFTP File Manager')}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {t(
              'Загрузка, скачивание и редактирование конфигурационных файлов (/etc/nginx, docker-compose.yml, логов) через браузер.',
              'Upload, download, and edit server configuration files (/etc/nginx, docker-compose.yml, logs) directly in the browser.'
            )}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-10 text-center">
          <ServerIcon className="mx-auto h-8 w-8 text-slate-500" />
          <h2 className="mt-3 text-base font-semibold text-slate-100">
            {t('Нет подключённых серверов для SFTP', 'No servers registered for SFTP')}
          </h2>
          <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
            {t(
              'Добавьте Linux-сервер с паролем или приватным SSH-ключом, чтобы управлять файлами конфигурации через браузер.',
              'Add a Linux server with SSH credentials to browse, upload, download, and edit configuration files.'
            )}
          </p>
          <button
            type="button"
            onClick={openAddServerModal}
            className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t('+ Добавить сервер', '+ Add Server')}</span>
          </button>
        </div>
      </div>
    );
  }

  const resolvedPath = dirData?.path || currentPath;
  const pathSegments = resolvedPath
    .split('/')
    .filter(Boolean)
    .map((seg, idx, arr) => ({
      name: seg,
      fullPath: '/' + arr.slice(0, idx + 1).join('/'),
    }));

  const entries = (dirData?.entries || []).filter((e) =>
    filterQuery.trim()
      ? e.name.toLowerCase().includes(filterQuery.trim().toLowerCase())
      : true
  );

  return (
    <div className="space-y-6">
      {/* Hidden Browser File Input */}
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleUploadBrowserFile}
        className="hidden"
      />

      {/* Page Header */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-emerald-400" />
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
              {t('Файловый менеджер SFTP', 'SFTP File Manager & Config Editor')}
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {t(
              'Просмотр директорий, скачивание логов, загрузка и онлайн-редактирование /etc/nginx, docker-compose.yml и .env без входа в консоль.',
              'Browse directories, download logs, upload files, and edit /etc/nginx, docker-compose.yml, and .env directly in your browser.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setUseSudo((prev) => !prev)}
            title={t(
              'Использовать sudo при чтении и записи системных файлов (/etc/nginx и др.)',
              'Use sudo for reading and writing protected /etc files'
            )}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-medium transition-colors ${
              useSudo
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                : 'border-slate-700 bg-[#1E293B] text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>sudo: {useSudo ? 'ON' : 'OFF'}</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!activeServer.has_secret || writeMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>
              {writeMutation.isPending
                ? t('Загрузка...', 'Uploading...')
                : t('Загрузить файл на сервер', 'Upload File')}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setShowNewFileBar((prev) => !prev);
              setShowNewFolderBar(false);
            }}
            disabled={!activeServer.has_secret}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#1E293B] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            <FilePlus className="h-3.5 w-3.5 text-sky-400" />
            <span>{t('+ Новый файл / шаблон', '+ New File / Template')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setShowNewFolderBar((prev) => !prev);
              setShowNewFileBar(false);
            }}
            disabled={!activeServer.has_secret}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#1E293B] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            <FolderPlus className="h-3.5 w-3.5 text-amber-400" />
            <span>{t('+ Папка', '+ Folder')}</span>
          </button>
        </div>
      </div>

      {/* Server Selector & Quick Bookmarks Bar */}
      <section className="rounded-lg border border-slate-800 bg-[#1E293B] p-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-400 mr-1">
              {t('Сервер SFTP:', 'SFTP Host:')}
            </span>
            {servers.map((srv) => {
              const isSelected = srv.id === activeServer.id;
              const dotColor =
                srv.status === 'online'
                  ? 'bg-emerald-400'
                  : srv.status === 'offline'
                    ? 'bg-rose-400'
                    : 'bg-amber-400';

              return (
                <button
                  key={srv.id}
                  type="button"
                  onClick={() => handleSelectServer(srv.id)}
                  className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    isSelected
                      ? 'border-emerald-500/60 bg-emerald-500/15 text-white'
                      : 'border-slate-700/80 bg-[#0F172A] text-slate-300 hover:border-slate-600 hover:text-white'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                  <span>{srv.name}</span>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    ({srv.ip_address})
                  </span>
                </button>
              );
            })}
          </div>

          <Link
            to={`/servers/${activeServer.id}`}
            className="inline-flex items-center gap-1 font-mono text-xs text-emerald-400 hover:underline whitespace-nowrap"
          >
            <span>{t('Карточка и терминал сервера', 'Server Card & Terminal')}</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* Quick Bookmarks for /etc/nginx, docker-compose, /var/log, etc. */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-800/80 pt-3">
          <span className="text-[11px] font-medium text-slate-400 mr-1">
            {t('Быстрый переход:', 'Quick Jump:')}
          </span>
          {QUICK_BOOKMARKS.map((bm) => {
            const isActive = resolvedPath === bm.path || resolvedPath.startsWith(`${bm.path}/`);
            return (
              <button
                key={bm.path}
                type="button"
                onClick={() => navigateToPath(bm.path)}
                title={bm.hint}
                className={`rounded border px-2.5 py-1 font-mono text-xs transition-colors ${
                  isActive
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300 font-semibold'
                    : 'border-slate-800 bg-[#0F172A] text-slate-300 hover:border-slate-700 hover:text-white'
                }`}
              >
                {t(bm.labelRu, bm.labelEn)}
              </button>
            );
          })}
        </div>

        {!activeServer.has_secret && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-950/20 px-3.5 py-2.5 text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                {t(
                  `Для сервера «${activeServer.name}» не настроен пароль или приватный SSH-ключ.`,
                  `SSH credentials are not configured for "${activeServer.name}".`
                )}
              </span>
            </div>
            <Link
              to={`/servers/${activeServer.id}`}
              className="inline-flex items-center gap-1.5 font-semibold text-amber-300 hover:underline whitespace-nowrap"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>{t('Настроить SSH-доступ →', 'Configure SSH Credentials →')}</span>
            </Link>
          </div>
        )}
      </section>

      {/* Status Notification Banner */}
      {statusMessage && (
        <div
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-xs ${
            statusMessage.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
              : 'border-rose-500/40 bg-rose-950/30 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            )}
            <span className="font-mono">{statusMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Inline New File / Config Template Creator */}
      {showNewFileBar && (
        <section className="rounded-lg border border-sky-500/40 bg-[#131C2E] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-100">
              {t(
                `Создание нового файла в ${resolvedPath}`,
                `Create new file in ${resolvedPath}`
              )}
            </h3>
            <button
              type="button"
              onClick={() => setShowNewFileBar(false)}
              className="text-slate-400 hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="docker-compose.yml, nginx.conf, .env..."
              className="h-9 flex-1 rounded border border-slate-700 bg-[#0F172A] px-3 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => handleCreateNewFile('')}
              disabled={writeMutation.isPending}
              className="rounded-md bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              {t('Создать пустой файл', 'Create Empty File')}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] text-slate-400">
              {t('Или создать по готовому шаблону:', 'Or create from template:')}
            </span>
            {CONFIG_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => {
                  setNewFileName(tpl.name);
                  handleCreateNewFile(tpl.content);
                }}
                className="rounded border border-slate-700 bg-[#0F172A] px-2.5 py-1 font-mono text-xs text-sky-300 hover:border-sky-500/50 hover:text-white"
              >
                {t(tpl.labelRu, tpl.labelEn)} ({tpl.name})
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Inline New Folder Creator */}
      {showNewFolderBar && (
        <form
          onSubmit={handleCreateNewFolder}
          className="flex flex-col gap-2.5 rounded-lg border border-amber-500/40 bg-[#131C2E] p-4 sm:flex-row sm:items-center"
        >
          <span className="font-mono text-xs text-slate-300 whitespace-nowrap">
            {t(`Новая папка в ${resolvedPath}:`, `New folder in ${resolvedPath}:`)}
          </span>
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="sites-enabled, compose-stack..."
            className="h-9 flex-1 rounded border border-slate-700 bg-[#0F172A] px-3 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={mkdirMutation.isPending}
            className="rounded-md bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            {t('Создать папку', 'Create Folder')}
          </button>
          <button
            type="button"
            onClick={() => setShowNewFolderBar(false)}
            className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
          >
            {t('Отмена', 'Cancel')}
          </button>
        </form>
      )}

      {/* Main Split-Pane SFTP Workspace */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left/Main Pane: Directory Browser */}
        <section
          className={`rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-4 ${
            openedFile ? 'lg:col-span-6' : 'lg:col-span-12'
          }`}
        >
          {/* Path Breadcrumbs & Direct Input */}
          <div className="flex flex-col gap-3 border-b border-slate-800 pb-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1 font-mono text-xs">
                <button
                  type="button"
                  onClick={() => navigateToPath('/')}
                  className="rounded bg-[#0F172A] px-2 py-1 text-emerald-400 hover:bg-slate-800 font-semibold"
                >
                  /
                </button>
                {pathSegments.map((seg) => (
                  <React.Fragment key={seg.fullPath}>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
                    <button
                      type="button"
                      onClick={() => navigateToPath(seg.fullPath)}
                      className="rounded px-1.5 py-0.5 text-slate-200 hover:bg-slate-800 hover:text-emerald-300"
                    >
                      {seg.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                {dirData?.parent_path && (
                  <button
                    type="button"
                    onClick={() => navigateToPath(dirData.parent_path!)}
                    className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#0F172A] px-2.5 py-1 font-mono text-xs text-slate-300 hover:bg-slate-800"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                    <span>..</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => refetchDir()}
                  disabled={isDirFetching}
                  className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#0F172A] px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 text-emerald-400 ${
                      isDirFetching ? 'animate-spin' : ''
                    }`}
                  />
                  <span>{t('Обновить', 'Refresh')}</span>
                </button>
              </div>
            </div>

            {/* Direct Path Input & Filter */}
            <div className="flex flex-col gap-2 sm:flex-row">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  navigateToPath(pathInput);
                }}
                className="flex flex-1 gap-1.5"
              >
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  placeholder="/etc/nginx"
                  className="h-8 flex-1 rounded border border-slate-700 bg-[#0F172A] px-3 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded border border-slate-700 bg-[#0F172A] px-3 text-xs font-medium text-emerald-400 hover:bg-slate-800"
                >
                  {t('Перейти', 'Go')}
                </button>
              </form>

              <div className="relative sm:w-48">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder={t('Фильтр по имени...', 'Filter files...')}
                  className="h-8 w-full rounded border border-slate-700 bg-[#0F172A] pl-8 pr-2.5 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Directory Listing Table */}
          {isDirLoading ? (
            <div className="space-y-2 py-4">
              <div className="h-8 w-full animate-pulse rounded bg-slate-800" />
              <div className="h-8 w-full animate-pulse rounded bg-slate-800" />
              <div className="h-8 w-full animate-pulse rounded bg-slate-800" />
            </div>
          ) : dirError ? (
            <div className="rounded border border-rose-500/40 bg-rose-950/30 p-4 text-xs text-rose-200 space-y-2">
              <p className="font-semibold">
                {(dirError as any)?.message ||
                  t('Ошибка чтения директории по SFTP', 'Failed to list remote directory')}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => navigateToPath('/etc')}
                  className="rounded bg-slate-800 px-2.5 py-1 font-mono text-xs text-slate-200 hover:bg-slate-700"
                >
                  /etc
                </button>
                <button
                  type="button"
                  onClick={() => navigateToPath('/root')}
                  className="rounded bg-slate-800 px-2.5 py-1 font-mono text-xs text-slate-200 hover:bg-slate-700"
                >
                  /root
                </button>
                <button
                  type="button"
                  onClick={() => navigateToPath('/var/log')}
                  className="rounded bg-slate-800 px-2.5 py-1 font-mono text-xs text-slate-200 hover:bg-slate-700"
                >
                  /var/log
                </button>
              </div>
            </div>
          ) : dirData?.exists === false ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-5 text-xs text-amber-200 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-amber-100">
                    {t(
                      `Директория ${resolvedPath} не найдена на сервере`,
                      `Directory ${resolvedPath} does not exist on the server`
                    )}
                  </p>
                  <p className="text-amber-300/90">
                    {t(
                      'Возможно, соответствующий сервис (например, Nginx или Docker) ещё не установлен, либо папка ещё не создана. Вы можете создать её в 1 клик или перейти в существующий каталог.',
                      'The corresponding service (e.g. Nginx or Docker) may not be installed yet, or the folder has not been created. You can create it in 1 click or switch to an existing directory.'
                    )}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={mkdirMutation.isPending}
                  onClick={async () => {
                    if (!activeServer) return;
                    try {
                      await mkdirMutation.mutateAsync({
                        serverId: activeServer.id,
                        path: resolvedPath,
                        sudo: useSudo,
                      });
                      setStatusMessage({
                        type: 'success',
                        text: t(
                          `Директория создана: ${resolvedPath}`,
                          `Directory created: ${resolvedPath}`
                        ),
                      });
                      refetchDir();
                    } catch (err: any) {
                      setStatusMessage({
                        type: 'error',
                        text:
                          err?.message ||
                          t('Не удалось создать директорию', 'Failed to create directory'),
                      });
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  <span>
                    {mkdirMutation.isPending
                      ? t('Создание...', 'Creating...')
                      : t(`Создать ${resolvedPath}`, `Create ${resolvedPath}`)}
                  </span>
                </button>
                {dirData.parent_path && (
                  <button
                    type="button"
                    onClick={() => navigateToPath(dirData.parent_path!)}
                    className="rounded border border-slate-700 bg-[#0F172A] px-3 py-1.5 font-mono text-xs text-slate-200 hover:bg-slate-800"
                  >
                    {t(`Вверх (${dirData.parent_path})`, `Up (${dirData.parent_path})`)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => navigateToPath('/etc')}
                  className="rounded border border-slate-700 bg-[#0F172A] px-3 py-1.5 font-mono text-xs text-slate-200 hover:bg-slate-800"
                >
                  /etc
                </button>
                <button
                  type="button"
                  onClick={() => navigateToPath('/root')}
                  className="rounded border border-slate-700 bg-[#0F172A] px-3 py-1.5 font-mono text-xs text-slate-200 hover:bg-slate-800"
                >
                  /root
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded border border-slate-800 bg-[#0F172A]">
              <table className="w-full text-left font-mono text-xs">
                <thead className="border-b border-slate-800 text-slate-400">
                  <tr>
                    <th className="px-3.5 py-2.5">{t('Имя', 'Name')}</th>
                    <th className="px-3 py-2.5 text-right">{t('Размер', 'Size')}</th>
                    <th className="hidden sm:table-cell px-3 py-2.5">
                      {t('Права', 'Mode')}
                    </th>
                    <th className="hidden md:table-cell px-3 py-2.5">
                      {t('Изменён', 'Modified')}
                    </th>
                    <th className="px-3.5 py-2.5 text-right">
                      {t('Действия', 'Actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-200 tabular-nums">
                  {dirData?.parent_path && (
                    <tr
                      onClick={() => navigateToPath(dirData.parent_path!)}
                      className="cursor-pointer hover:bg-slate-800/50"
                    >
                      <td className="px-3.5 py-2 text-amber-400 flex items-center gap-2">
                        <Folder className="h-4 w-4 shrink-0 fill-amber-400/20 text-amber-400" />
                        <span>..</span>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">DIR</td>
                      <td className="hidden sm:table-cell px-3 py-2 text-slate-500">—</td>
                      <td className="hidden md:table-cell px-3 py-2 text-slate-500">—</td>
                      <td className="px-3.5 py-2 text-right" />
                    </tr>
                  )}

                  {entries.map((entry) => {
                    const isDir = entry.type === 'directory';
                    const isSelectedFile = openedFile?.path === entry.path;

                    return (
                      <tr
                        key={entry.path}
                        className={`transition-colors ${
                          isSelectedFile
                            ? 'bg-emerald-500/15'
                            : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="px-3.5 py-2">
                          <button
                            type="button"
                            onClick={() => handleOpenFile(entry)}
                            className="flex items-center gap-2 text-left font-medium hover:underline break-all"
                          >
                            {isDir ? (
                              <Folder className="h-4 w-4 shrink-0 fill-amber-400/20 text-amber-400" />
                            ) : entry.name.endsWith('.yml') ||
                              entry.name.endsWith('.yaml') ||
                              entry.name.endsWith('.conf') ||
                              entry.name.endsWith('.json') ||
                              entry.name.endsWith('.sh') ? (
                              <FileCode className="h-4 w-4 shrink-0 text-emerald-400" />
                            ) : (
                              <FileText className="h-4 w-4 shrink-0 text-sky-400" />
                            )}
                            <span
                              className={
                                isDir ? 'text-amber-300 font-semibold' : 'text-slate-100'
                              }
                            >
                              {entry.name}
                            </span>
                          </button>
                        </td>

                        <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">
                          {isDir ? 'DIR' : formatBytes(entry.size)}
                        </td>

                        <td className="hidden sm:table-cell px-3 py-2 text-slate-500 whitespace-nowrap">
                          {entry.permissions}
                        </td>

                        <td className="hidden md:table-cell px-3 py-2 text-slate-400 whitespace-nowrap">
                          {entry.modified_at}
                        </td>

                        <td className="px-3.5 py-2 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {!isDir && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleOpenFile(entry)}
                                  title={t('Открыть / Редактировать', 'Open / Edit')}
                                  className="rounded border border-slate-700 bg-[#1E293B] px-2 py-1 text-[11px] text-emerald-300 hover:bg-slate-700"
                                >
                                  {t('Открыть', 'Edit')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDownloadFile(entry.path, entry.name)
                                  }
                                  title={t('Скачать файл', 'Download file')}
                                  className="rounded border border-slate-700 bg-[#1E293B] p-1 text-sky-300 hover:bg-slate-700"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}

                            {confirmDeletePath === entry.path ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleConfirmDelete(entry.path)}
                                  disabled={deleteMutation.isPending}
                                  className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-rose-500"
                                >
                                  {t('Да', 'Yes')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeletePath(null)}
                                  className="rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300"
                                >
                                  ×
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeletePath(entry.path)}
                                title={t('Удалить', 'Delete')}
                                className="rounded border border-slate-800 p-1 text-slate-500 hover:border-rose-500/40 hover:text-rose-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {entries.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        {t(
                          'Директория пуста или нет совпадений по фильтру.',
                          'Directory is empty or no matching files found.'
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right Pane: In-Browser Config Editor & Log Viewer */}
        {openedFile && (
          <section className="rounded-lg border border-emerald-500/30 bg-[#1E293B] p-5 space-y-4 lg:col-span-6 flex flex-col">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FileCode className="h-4 w-4 text-emerald-400 shrink-0" />
                  <h2 className="font-mono text-sm font-semibold text-slate-100 truncate">
                    {openedFile.name}
                  </h2>
                  <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-300">
                    {formatBytes(openedFile.size)}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-slate-400 break-all">
                  {openedFile.path}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadFile(openedFile.path, openedFile.name)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#0F172A] px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>{t('Скачать', 'Download')}</span>
                </button>

                {!openedFile.is_binary && (
                  <button
                    type="button"
                    onClick={handleSaveOpenedFile}
                    disabled={writeMutation.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>
                      {writeMutation.isPending
                        ? t('Сохранение...', 'Saving...')
                        : t('Сохранить на сервер', 'Save to Server')}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setOpenedFile(null)}
                  className="rounded-md border border-slate-700 p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {isReadingFile ? (
              <div className="h-96 w-full animate-pulse rounded bg-slate-800" />
            ) : openedFile.is_binary ? (
              <div className="rounded border border-slate-800 bg-[#0F172A] p-8 text-center space-y-3">
                <p className="text-xs text-slate-300">
                  {t(
                    'Это бинарный файл (архив или исполняемый файл). Онлайн-редактирование текста недоступно, но вы можете скачать его в один клик.',
                    'This is a binary file. Text editing is disabled, but you can download it directly.'
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => handleDownloadFile(openedFile.path, openedFile.name)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>
                    {t(
                      `Скачать ${openedFile.name} (${formatBytes(openedFile.size)})`,
                      `Download ${openedFile.name} (${formatBytes(openedFile.size)})`
                    )}
                  </span>
                </button>
              </div>
            ) : (
              <>
                {openedFile.truncated && (
                  <div className="rounded border border-amber-500/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">
                    {t(
                      'Файл превышает 2 МБ — показаны первые 2 МБ содержимого.',
                      'File exceeds 2 MB — showing the first 2 MB.'
                    )}
                  </div>
                )}
                <textarea
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  spellCheck={false}
                  rows={22}
                  className="w-full flex-1 rounded-md border border-slate-800 bg-[#0B1120] p-3.5 font-mono text-xs leading-relaxed text-slate-100 focus:border-emerald-500 focus:outline-none resize-y"
                />
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span>
                    {t('Строк:', 'Lines:')} {editorContent.split('\n').length} · UTF-8
                  </span>
                  <span>
                    {useSudo
                      ? t('Запись через sudo tee', 'Write mode: sudo tee')
                      : t('Запись от текущего SSH-пользователя', 'Write mode: standard SSH user')}
                  </span>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
};
