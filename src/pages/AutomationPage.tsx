import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Edit3,
  Eye,
  FileCode2,
  Filter,
  FolderGit2,
  History,
  Layers,
  Loader2,
  Play,
  Plus,
  Rocket,
  Save,
  Server as ServerIcon,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  useAnsibleJob,
  useAnsibleJobs,
  useAutomationAuditLogs,
  useAutomationStatus,
  useCancelAnsibleJob,
  useCreateInventory,
  useCreatePlaybook,
  useDeleteInventory,
  useDeletePlaybook,
  useInventories,
  usePlaybooks,
  useStartAnsibleJob,
  useUpdateInventory,
  useUpdatePlaybook,
  useValidatePlaybookById,
  useValidatePlaybookContent,
} from '../hooks/useAutomation.ts';
import {
  useExecuteSshCommand,
  useServerCommandLogs,
  useServers,
} from '../hooks/useServers.ts';
import { getInMemoryAuthToken } from '../context/AuthContext.tsx';
import { useI18n } from '../context/I18nContext.tsx';
import type { AnsibleInventory, AnsibleJob, AnsibleJobStatus, AnsiblePlaybook } from '../api/automation.ts';

interface LayoutOutletContext {
  openAddServerModal: () => void;
}

type AutomationTab = 'playbooks' | 'inventories' | 'run' | 'history' | 'ssh';

const DEFAULT_PLAYBOOK_TEMPLATE = `---
- name: Custom Infrastructure Playbook
  hosts: all
  gather_facts: false
  tasks:
    - name: Verify SSH connectivity
      ansible.builtin.ping:
      tags:
        - ping

    - name: Check system uptime and kernel
      ansible.builtin.command: uname -snrm
      register: uname_out
      changed_when: false
      tags:
        - info

    - name: Print kernel output
      ansible.builtin.debug:
        var: uname_out.stdout
      tags:
        - info
`;

export const AutomationPage: React.FC = () => {
  const { locale, t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const outletCtx = useOutletContext<LayoutOutletContext | undefined>();
  const openAddServerModal = outletCtx?.openAddServerModal || (() => {});

  const initialTab = (searchParams.get('tab') as AutomationTab) || 'playbooks';
  const [activeTab, setActiveTab] = useState<AutomationTab>(
    ['playbooks', 'inventories', 'run', 'history', 'ssh'].includes(initialTab)
      ? initialTab
      : 'playbooks'
  );

  const switchTab = (tab: AutomationTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  // Queries
  const { data: runtimeStatus } = useAutomationStatus();
  const { data: servers = [] } = useServers();
  const { data: inventories = [], isLoading: isInventoriesLoading } = useInventories();
  const { data: playbooks = [], isLoading: isPlaybooksLoading } = usePlaybooks();

  // History filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [playbookFilter, setPlaybookFilter] = useState<number | undefined>(undefined);
  const [inventoryFilter, setInventoryFilter] = useState<number | undefined>(undefined);

  const { data: jobs = [], refetch: refetchJobs } = useAnsibleJobs({
    status: statusFilter,
    playbook_id: playbookFilter,
    inventory_id: inventoryFilter,
  });
  const { data: auditLogs = [], refetch: refetchAuditLogs } = useAutomationAuditLogs();

  // Mutations
  const createPlaybookMut = useCreatePlaybook();
  const updatePlaybookMut = useUpdatePlaybook();
  const deletePlaybookMut = useDeletePlaybook();
  const validatePlaybookIdMut = useValidatePlaybookById();
  const validateContentMut = useValidatePlaybookContent();

  const createInventoryMut = useCreateInventory();
  const updateInventoryMut = useUpdateInventory();
  const deleteInventoryMut = useDeleteInventory();

  const startJobMut = useStartAnsibleJob();
  const cancelJobMut = useCancelAnsibleJob();

  // --- Playbook Editor State ---
  const [editingPlaybook, setEditingPlaybook] = useState<AnsiblePlaybook | null>(null);
  const [isCreatingPlaybook, setIsCreatingPlaybook] = useState(false);
  const [pbName, setPbName] = useState('');
  const [pbDescription, setPbDescription] = useState('');
  const [pbContent, setPbContent] = useState(DEFAULT_PLAYBOOK_TEMPLATE);
  const [pbFormError, setPbFormError] = useState('');
  const [pbValidationBanner, setPbValidationBanner] = useState<{
    valid: boolean;
    message: string;
  } | null>(null);

  const openCreatePlaybook = () => {
    setEditingPlaybook(null);
    setIsCreatingPlaybook(true);
    setPbName('');
    setPbDescription('');
    setPbContent(DEFAULT_PLAYBOOK_TEMPLATE);
    setPbFormError('');
    setPbValidationBanner(null);
  };

  const openEditPlaybook = (pb: AnsiblePlaybook) => {
    setIsCreatingPlaybook(false);
    setEditingPlaybook(pb);
    setPbName(pb.name);
    setPbDescription(pb.description);
    setPbContent(pb.content);
    setPbFormError('');
    setPbValidationBanner(
      pb.validation_message
        ? { valid: pb.validation_status === 'valid', message: pb.validation_message }
        : null
    );
  };

  const handleSavePlaybook = () => {
    setPbFormError('');
    if (!pbName.trim()) {
      setPbFormError(t('Укажите название плейбука', 'Playbook name is required'));
      return;
    }
    if (!pbContent.trim()) {
      setPbFormError(t('YAML-содержимое плейбука не может быть пустым', 'Playbook YAML is required'));
      return;
    }

    if (editingPlaybook) {
      updatePlaybookMut.mutate(
        {
          id: editingPlaybook.id,
          input: {
            name: pbName.trim(),
            description: pbDescription.trim(),
            content: pbContent,
          },
        },
        {
          onSuccess: (updated) => {
            setEditingPlaybook(updated);
          },
          onError: (err: any) => {
            setPbFormError(err?.message || 'Failed to update playbook');
          },
        }
      );
    } else {
      createPlaybookMut.mutate(
        {
          name: pbName.trim(),
          description: pbDescription.trim(),
          content: pbContent,
        },
        {
          onSuccess: (created) => {
            setIsCreatingPlaybook(false);
            setEditingPlaybook(created);
          },
          onError: (err: any) => {
            setPbFormError(err?.message || 'Failed to create playbook');
          },
        }
      );
    }
  };

  const handleValidateDraftOrSaved = () => {
    setPbFormError('');
    if (editingPlaybook && pbContent === editingPlaybook.content) {
      validatePlaybookIdMut.mutate(editingPlaybook.id, {
        onSuccess: (res) => {
          setPbValidationBanner({
            valid: res.validation.valid,
            message: res.validation.message,
          });
          if (res.playbook) setEditingPlaybook(res.playbook);
        },
        onError: (err: any) => {
          setPbFormError(err?.message || 'Validation failed');
        },
      });
    } else {
      validateContentMut.mutate(pbContent, {
        onSuccess: (res) => {
          setPbValidationBanner({
            valid: res.valid,
            message: res.message,
          });
        },
        onError: (err: any) => {
          setPbFormError(err?.message || 'Validation failed');
        },
      });
    }
  };

  // --- Inventory Editor State ---
  const [editingInventory, setEditingInventory] = useState<AnsibleInventory | null>(null);
  const [isCreatingInventory, setIsCreatingInventory] = useState(false);
  const [invName, setInvName] = useState('');
  const [invDescription, setInvDescription] = useState('');
  const [invGroupName, setInvGroupName] = useState('all');
  const [invServerIds, setInvServerIds] = useState<number[]>([]);
  const [invFormError, setInvFormError] = useState('');

  const openCreateInventory = () => {
    setEditingInventory(null);
    setIsCreatingInventory(true);
    setInvName('');
    setInvDescription('');
    setInvGroupName('all');
    setInvServerIds(servers.map((s) => s.id));
    setInvFormError('');
  };

  const openEditInventory = (inv: AnsibleInventory) => {
    setIsCreatingInventory(false);
    setEditingInventory(inv);
    setInvName(inv.name);
    setInvDescription(inv.description);
    setInvGroupName(inv.group_name || 'all');
    setInvServerIds(inv.servers.map((s) => s.id));
    setInvFormError('');
  };

  const toggleInventoryServer = (serverId: number) => {
    setInvServerIds((prev) =>
      prev.includes(serverId) ? prev.filter((id) => id !== serverId) : [...prev, serverId]
    );
  };

  const handleSaveInventory = () => {
    setInvFormError('');
    if (!invName.trim()) {
      setInvFormError(t('Укажите название инвентаря', 'Inventory name is required'));
      return;
    }

    if (editingInventory) {
      updateInventoryMut.mutate(
        {
          id: editingInventory.id,
          input: {
            name: invName.trim(),
            description: invDescription.trim(),
            group_name: invGroupName.trim() || 'all',
            server_ids: invServerIds,
          },
        },
        {
          onSuccess: (updated) => {
            setEditingInventory(updated);
          },
          onError: (err: any) => {
            setInvFormError(err?.message || 'Failed to update inventory');
          },
        }
      );
    } else {
      createInventoryMut.mutate(
        {
          name: invName.trim(),
          description: invDescription.trim(),
          group_name: invGroupName.trim() || 'all',
          server_ids: invServerIds,
        },
        {
          onSuccess: (created) => {
            setIsCreatingInventory(false);
            setEditingInventory(created);
          },
          onError: (err: any) => {
            setInvFormError(err?.message || 'Failed to create inventory');
          },
        }
      );
    }
  };

  // --- Run Job & Live SSE Output State ---
  const [runPlaybookId, setRunPlaybookId] = useState<number>(0);
  const [runInventoryId, setRunInventoryId] = useState<number>(0);
  const [runCheckMode, setRunCheckMode] = useState<boolean>(false);
  const [runDiffMode, setRunDiffMode] = useState<boolean>(false);
  const [runTags, setRunTags] = useState<string>('');
  const [runExtraVarsJson, setRunExtraVarsJson] = useState<string>('{}');
  const [runError, setRunError] = useState<string>('');

  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<AnsibleJobStatus | null>(null);
  const [liveStdout, setLiveStdout] = useState<string>('');
  const [liveStderr, setLiveStderr] = useState<string>('');
  const [liveExitCode, setLiveExitCode] = useState<number | null>(null);
  const [liveDurationMs, setLiveDurationMs] = useState<number>(0);
  const [copiedConsole, setCopiedConsole] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const consoleEndRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (!runPlaybookId && playbooks.length > 0) {
      setRunPlaybookId(playbooks[0].id);
    }
  }, [playbooks, runPlaybookId]);

  useEffect(() => {
    if (!runInventoryId && inventories.length > 0) {
      setRunInventoryId(inventories[0].id);
    }
  }, [inventories, runInventoryId]);

  const closeActiveEventSource = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      closeActiveEventSource();
    };
  }, []);

  const connectJobStream = async (jobId: number) => {
    closeActiveEventSource();
    const token = await getInMemoryAuthToken();
    const url = `/api/automation/jobs/${jobId}/stream${
      token ? `?token=${encodeURIComponent(token)}` : ''
    }`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener('snapshot', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        setLiveStatus(data.status || 'RUNNING');
        setLiveStdout(data.stdout || '');
        setLiveStderr(data.stderr || '');
        if (data.exit_code !== undefined) setLiveExitCode(data.exit_code);
        if (data.duration_ms !== undefined) setLiveDurationMs(data.duration_ms);
      } catch {
        // Ignore parse error
      }
    });

    es.addEventListener('status', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.status) setLiveStatus(data.status);
      } catch {
        // Ignore
      }
    });

    es.addEventListener('output', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.stream === 'stderr') {
          setLiveStderr((prev) => prev + (data.chunk || ''));
        } else {
          setLiveStdout((prev) => prev + (data.chunk || ''));
        }
        if (consoleEndRef.current) {
          consoleEndRef.current.scrollTop = consoleEndRef.current.scrollHeight;
        }
      } catch {
        // Ignore
      }
    });

    es.addEventListener('done', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.status) setLiveStatus(data.status);
        if (data.exit_code !== undefined) setLiveExitCode(data.exit_code);
        if (data.duration_ms !== undefined) setLiveDurationMs(data.duration_ms);
      } catch {
        // Ignore
      }
      closeActiveEventSource();
      void refetchJobs();
      void refetchAuditLogs();
    });

    es.onerror = () => {
      closeActiveEventSource();
      void refetchJobs();
    };
  };

  const handleLaunchJob = () => {
    setRunError('');
    if (!runPlaybookId) {
      setRunError(t('Выберите плейбук для запуска', 'Select an Ansible Playbook'));
      return;
    }
    if (!runInventoryId) {
      setRunError(
        t(
          'Выберите или создайте Ansible Inventory с целевыми серверами',
          'Select or create an Ansible Inventory with target servers'
        )
      );
      return;
    }

    let parsedExtraVars: Record<string, any> = {};
    if (runExtraVarsJson.trim()) {
      try {
        parsedExtraVars = JSON.parse(runExtraVarsJson);
      } catch {
        setRunError(
          t('Поле Extra Vars должно содержать валидный JSON-объект', 'Extra Vars must be valid JSON')
        );
        return;
      }
    }

    startJobMut.mutate(
      {
        playbook_id: runPlaybookId,
        inventory_id: runInventoryId,
        check_mode: runCheckMode,
        diff_mode: runDiffMode,
        tags: runTags,
        extra_vars: parsedExtraVars,
      },
      {
        onSuccess: (job) => {
          setActiveJobId(job.id);
          setLiveStatus(job.status);
          setLiveStdout('');
          setLiveStderr('');
          setLiveExitCode(null);
          setLiveDurationMs(0);
          void connectJobStream(job.id);
        },
        onError: (err: any) => {
          setRunError(err?.message || 'Failed to start Ansible job');
        },
      }
    );
  };

  const handleOpenRunWithPlaybook = (pb: AnsiblePlaybook) => {
    setRunPlaybookId(pb.id);
    switchTab('run');
  };

  // --- Job Details Modal / Drawer in History Tab ---
  const [inspectedJobId, setInspectedJobId] = useState<number | null>(null);
  const { data: inspectedJob, isLoading: isInspectedJobLoading } = useAnsibleJob(inspectedJobId);

  // --- Legacy SSH Rollout State (Preserved) ---
  const [selectedSshServerId, setSelectedSshServerId] = useState<number>(0);
  useEffect(() => {
    if (servers.length > 0 && !selectedSshServerId) {
      setSelectedSshServerId(servers[0].id);
    }
  }, [servers, selectedSshServerId]);
  const { data: sshCommandLogs = [] } = useServerCommandLogs(selectedSshServerId);
  const execSshMut = useExecuteSshCommand();
  const [customSshCmd, setCustomSshCmd] = useState(
    'uname -snrm && uptime && df -h /'
  );
  const [sshLastOutput, setSshLastOutput] = useState<{
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
  } | null>(null);

  const selectedRunPlaybook = useMemo(
    () => playbooks.find((p) => p.id === runPlaybookId) || null,
    [playbooks, runPlaybookId]
  );
  const selectedRunInventory = useMemo(
    () => inventories.find((i) => i.id === runInventoryId) || null,
    [inventories, runInventoryId]
  );

  const renderStatusBadge = (status: AnsibleJobStatus | null) => {
    if (!status) return null;
    switch (status) {
      case 'SUCCESS':
        return (
          <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            <span>SUCCESS</span>
          </span>
        );
      case 'RUNNING':
      case 'PENDING':
        return (
          <span className="inline-flex items-center gap-1 rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-sky-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{status}</span>
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-400">
            <Square className="h-3 w-3" />
            <span>CANCELLED</span>
          </span>
        );
      case 'FAILED':
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-rose-400">
            <XCircle className="h-3 w-3" />
            <span>FAILED</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Runtime Status Banner */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
              {t('Автоматизация Ansible (Ansible Automation)', 'Ansible Automation & Playbooks')}
            </h1>
            {runtimeStatus && (
              <span
                className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-0.5 font-mono text-xs ${
                  runtimeStatus.available
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-rose-500/40 bg-rose-500/10 text-rose-400'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    runtimeStatus.available ? 'bg-emerald-400' : 'bg-rose-500'
                  }`}
                />
                <span>
                  {runtimeStatus.available
                    ? runtimeStatus.version
                    : runtimeStatus.error || 'Ansible unavailable'}
                </span>
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {t(
              'Централизованное управление YAML-плейбуками, инвентарями серверов и потоковым выполнением ansible-playbook через SSH.',
              'Managed Ansible YAML playbooks, dynamic host inventories, syntax validation, and real-time SSE playbook execution over SSH.'
            )}
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-[#1E293B] p-1">
          <button
            type="button"
            onClick={() => switchTab('playbooks')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'playbooks'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <FileCode2 className="h-3.5 w-3.5" />
            <span>{t('Плейбуки', 'Playbooks')}</span>
            <span className="font-mono text-[11px] opacity-80">({playbooks.length})</span>
          </button>

          <button
            type="button"
            onClick={() => switchTab('inventories')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'inventories'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>{t('Инвентари', 'Inventories')}</span>
            <span className="font-mono text-[11px] opacity-80">({inventories.length})</span>
          </button>

          <button
            type="button"
            onClick={() => switchTab('run')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'run'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Play className="h-3.5 w-3.5" />
            <span>{t('Запуск Job', 'Run Job')}</span>
          </button>

          <button
            type="button"
            onClick={() => switchTab('history')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'history'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            <span>{t('История и аудит', 'Job History')}</span>
            <span className="font-mono text-[11px] opacity-80">({jobs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => switchTab('ssh')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'ssh'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>{t('Быстрый SSH', 'Direct SSH')}</span>
          </button>
        </div>
      </div>

      {/* Warning if Ansible binary is missing */}
      {runtimeStatus && !runtimeStatus.available && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
          <div>
            <p className="font-semibold text-rose-300">
              {runtimeStatus.error || 'Ansible is not installed or unavailable'}
            </p>
            <p className="mt-1 text-rose-200/80">
              {t(
                `Проверьте наличие бинарных файлов ANSIBLE_BIN (${runtimeStatus.ansible_bin}) и ANSIBLE_PLAYBOOK_BIN (${runtimeStatus.ansible_playbook_bin}) на сервере InfraLab Backend.`,
                `Verify that ANSIBLE_BIN (${runtimeStatus.ansible_bin}) and ANSIBLE_PLAYBOOK_BIN (${runtimeStatus.ansible_playbook_bin}) are installed on the InfraLab Backend host.`
              )}
            </p>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 1: PLAYBOOKS
         ===================================================================== */}
      {activeTab === 'playbooks' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Column: Playbook List */}
          <div className="space-y-4 lg:col-span-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                {t('Каталог Ansible Playbooks', 'Ansible Playbook Library')}
              </h2>
              <button
                type="button"
                onClick={openCreatePlaybook}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t('+ Новый плейбук', '+ New Playbook')}</span>
              </button>
            </div>

            {isPlaybooksLoading ? (
              <div className="space-y-3">
                <div className="h-24 animate-pulse rounded-lg bg-[#1E293B]" />
                <div className="h-24 animate-pulse rounded-lg bg-[#1E293B]" />
              </div>
            ) : playbooks.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-6 text-center text-xs text-slate-400">
                {t('Нет сохранённых плейбуков.', 'No playbooks created yet.')}
              </div>
            ) : (
              <div className="space-y-3">
                {playbooks.map((pb) => {
                  const isSelected = editingPlaybook?.id === pb.id && !isCreatingPlaybook;
                  return (
                    <div
                      key={pb.id}
                      className={`rounded-lg border p-4 transition-colors ${
                        isSelected
                          ? 'border-emerald-500/60 bg-[#1E293B]'
                          : 'border-slate-800 bg-[#1E293B]/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-100">{pb.name}</h3>
                          <p className="mt-1 text-xs text-slate-400 line-clamp-2">
                            {pb.description || t('Без описания', 'No description')}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                            pb.validation_status === 'valid'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : pb.validation_status === 'invalid'
                              ? 'bg-rose-500/15 text-rose-400'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {pb.validation_status}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3">
                        <span className="font-mono text-[11px] text-slate-500">
                          {new Date(pb.updated_at).toLocaleDateString()}
                        </span>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditPlaybook(pb)}
                            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#0F172A] px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
                          >
                            <Edit3 className="h-3 w-3" />
                            <span>{t('Редактировать', 'Edit')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => validatePlaybookIdMut.mutate(pb.id)}
                            disabled={validatePlaybookIdMut.isPending}
                            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#0F172A] px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-slate-800"
                          >
                            <ShieldCheck className="h-3 w-3" />
                            <span>{t('Проверить', 'Validate')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenRunWithPlaybook(pb)}
                            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                          >
                            <Play className="h-3 w-3" />
                            <span>{t('Запустить', 'Run')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              deletePlaybookMut.mutate(pb.id);
                              if (editingPlaybook?.id === pb.id) {
                                setEditingPlaybook(null);
                              }
                            }}
                            className="inline-flex items-center rounded border border-slate-800 p-1 text-slate-400 hover:border-rose-500/40 hover:text-rose-400"
                            title={t('Удалить плейбук', 'Delete playbook')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: YAML Playbook Editor */}
          <div className="lg:col-span-7">
            <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <FileCode2 className="h-4 w-4 text-emerald-400" />
                  <h2 className="text-sm font-semibold text-slate-100">
                    {editingPlaybook
                      ? `${t('Редактор плейбука:', 'Editing Playbook:')} ${editingPlaybook.name}`
                      : t('Создание нового Ansible Playbook (YAML)', 'Create New Ansible Playbook (YAML)')}
                  </h2>
                </div>
                {editingPlaybook && (
                  <button
                    type="button"
                    onClick={() => handleOpenRunWithPlaybook(editingPlaybook)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>{t('Перейти к запуску', 'Run This Playbook')}</span>
                  </button>
                )}
              </div>

              {pbFormError && (
                <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {pbFormError}
                </div>
              )}

              {pbValidationBanner && (
                <div
                  className={`rounded border px-3 py-2 font-mono text-xs whitespace-pre-wrap ${
                    pbValidationBanner.valid
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  }`}
                >
                  {pbValidationBanner.message}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t('Название плейбука', 'Playbook Name')}
                  </label>
                  <input
                    type="text"
                    value={pbName}
                    onChange={(e) => setPbName(e.target.value)}
                    placeholder="Nginx Reverse Proxy Setup"
                    className="w-full rounded-md border border-slate-700 bg-[#0F172A] px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t('Краткое описание', 'Description')}
                  </label>
                  <input
                    type="text"
                    value={pbDescription}
                    onChange={(e) => setPbDescription(e.target.value)}
                    placeholder={t(
                      'Описание задач и ролей плейбука',
                      'Summary of tasks performed by this playbook'
                    )}
                    className="w-full rounded-md border border-slate-700 bg-[#0F172A] px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-300">
                    {t('YAML-содержимое плейбука', 'Playbook YAML Content')}
                  </label>
                  <span className="font-mono text-[11px] text-slate-500">
                    ansible-playbook YAML
                  </span>
                </div>
                <textarea
                  rows={16}
                  value={pbContent}
                  onChange={(e) => setPbContent(e.target.value)}
                  spellCheck={false}
                  className="w-full rounded-md border border-slate-700 bg-[#0F172A] p-3 font-mono text-xs leading-relaxed text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={handleValidateDraftOrSaved}
                  disabled={
                    validateContentMut.isPending || validatePlaybookIdMut.isPending
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#0F172A] px-3.5 py-2 text-xs font-medium text-sky-300 hover:bg-slate-800 disabled:opacity-60"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>
                    {validateContentMut.isPending || validatePlaybookIdMut.isPending
                      ? t('Проверка синтаксиса...', 'Validating syntax...')
                      : t('Проверить синтаксис (--syntax-check)', 'Validate Syntax (--syntax-check)')}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleSavePlaybook}
                  disabled={createPlaybookMut.isPending || updatePlaybookMut.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>
                    {editingPlaybook
                      ? t('Сохранить изменения', 'Save Playbook')
                      : t('Создать плейбук', 'Create Playbook')}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 2: INVENTORIES
         ===================================================================== */}
      {activeTab === 'inventories' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Column: Inventories List */}
          <div className="space-y-4 lg:col-span-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                {t('Инвентари Ansible (Inventories)', 'Ansible Inventories')}
              </h2>
              <button
                type="button"
                onClick={openCreateInventory}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t('+ Создать инвентарь', '+ New Inventory')}</span>
              </button>
            </div>

            {isInventoriesLoading ? (
              <div className="space-y-3">
                <div className="h-24 animate-pulse rounded-lg bg-[#1E293B]" />
              </div>
            ) : inventories.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-6 text-center space-y-2">
                <p className="text-xs text-slate-400">
                  {t(
                    'Инвентари ещё не созданы. Объедините серверы в группу для запуска плейбуков.',
                    'No Ansible inventories created yet. Group your Linux servers to run playbooks.'
                  )}
                </p>
                <button
                  type="button"
                  onClick={openCreateInventory}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t('Создать первый инвентарь', 'Create First Inventory')}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {inventories.map((inv) => {
                  const isSelected = editingInventory?.id === inv.id && !isCreatingInventory;
                  return (
                    <div
                      key={inv.id}
                      className={`rounded-lg border p-4 transition-colors ${
                        isSelected
                          ? 'border-emerald-500/60 bg-[#1E293B]'
                          : 'border-slate-800 bg-[#1E293B]/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-100">{inv.name}</h3>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {inv.description || t('Без описания', 'No description')}
                          </p>
                        </div>
                        <span className="rounded border border-slate-700 bg-[#0F172A] px-2 py-0.5 font-mono text-[11px] text-emerald-400">
                          [{inv.group_name}] · {inv.server_count}{' '}
                          {t('узлов', 'hosts')}
                        </span>
                      </div>

                      {inv.servers.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {inv.servers.map((srv) => (
                            <span
                              key={srv.id}
                              className="inline-flex items-center gap-1 rounded bg-[#0F172A] px-2 py-0.5 font-mono text-[11px] text-slate-300"
                            >
                              <ServerIcon className="h-2.5 w-2.5 text-emerald-400" />
                              <span>{srv.name}</span>
                              <span className="text-slate-500">({srv.ip_address})</span>
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-800/80 pt-3">
                        <button
                          type="button"
                          onClick={() => openEditInventory(inv)}
                          className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#0F172A] px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
                        >
                          <Edit3 className="h-3 w-3" />
                          <span>{t('Изменить состав', 'Edit Hosts')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRunInventoryId(inv.id);
                            switchTab('run');
                          }}
                          className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                        >
                          <Play className="h-3 w-3" />
                          <span>{t('Выбрать для запуска', 'Use in Job')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            deleteInventoryMut.mutate(inv.id);
                            if (editingInventory?.id === inv.id) {
                              setEditingInventory(null);
                            }
                          }}
                          className="inline-flex items-center rounded border border-slate-800 p-1 text-slate-400 hover:border-rose-500/40 hover:text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Inventory Builder */}
          <div className="lg:col-span-7">
            <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-emerald-400" />
                  <h2 className="text-sm font-semibold text-slate-100">
                    {editingInventory
                      ? `${t('Редактирование инвентаря:', 'Editing Inventory:')} ${editingInventory.name}`
                      : t('Создание нового Ansible Inventory', 'Create New Ansible Inventory')}
                  </h2>
                </div>
              </div>

              {invFormError && (
                <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {invFormError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t('Название инвентаря', 'Inventory Name')}
                  </label>
                  <input
                    type="text"
                    value={invName}
                    onChange={(e) => setInvName(e.target.value)}
                    placeholder="Production Web Cluster"
                    className="w-full rounded-md border border-slate-700 bg-[#0F172A] px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t('Группа Ansible (INI group)', 'Ansible Host Group')}
                  </label>
                  <input
                    type="text"
                    value={invGroupName}
                    onChange={(e) => setInvGroupName(e.target.value)}
                    placeholder="all"
                    className="w-full rounded-md border border-slate-700 bg-[#0F172A] px-3 py-2 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {t('Описание', 'Description')}
                  </label>
                  <input
                    type="text"
                    value={invDescription}
                    onChange={(e) => setInvDescription(e.target.value)}
                    placeholder="Primary Linux servers"
                    className="w-full rounded-md border border-slate-700 bg-[#0F172A] px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-slate-300">
                    {t(
                      'Целевые серверы в инвентаре (используются существующие SSH-учётные данные)',
                      'Target Servers in Inventory (reuses existing encrypted SSH credentials)'
                    )}
                  </label>
                  <span className="font-mono text-xs text-emerald-400">
                    {invServerIds.length} / {servers.length} {t('выбрано', 'selected')}
                  </span>
                </div>

                {servers.length === 0 ? (
                  <div className="rounded border border-slate-800 bg-[#0F172A] p-4 text-center">
                    <p className="text-xs text-slate-400">
                      {t('В системе ещё нет серверов.', 'No servers registered in InfraLab yet.')}
                    </p>
                    <button
                      type="button"
                      onClick={openAddServerModal}
                      className="mt-2 inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
                    >
                      <Plus className="h-3 w-3" />
                      <span>{t('+ Добавить сервер', '+ Add Server')}</span>
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 max-h-64 overflow-y-auto rounded-md border border-slate-800 bg-[#0F172A] p-3">
                    {servers.map((srv) => {
                      const checked = invServerIds.includes(srv.id);
                      return (
                        <label
                          key={srv.id}
                          className={`flex cursor-pointer items-center justify-between rounded border px-3 py-2 text-xs transition-colors ${
                            checked
                              ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                              : 'border-slate-800 bg-[#1E293B]/60 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleInventoryServer(srv.id)}
                              className="rounded border-slate-600 text-emerald-500 focus:ring-emerald-500"
                            />
                            <div className="truncate">
                              <div className="font-medium truncate">{srv.name}</div>
                              <div className="font-mono text-[11px] text-slate-400">
                                {srv.username}@{srv.ip_address}:{srv.ssh_port} ({srv.auth_type})
                              </div>
                            </div>
                          </div>
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${
                              srv.status === 'online'
                                ? 'bg-emerald-400'
                                : srv.status === 'offline'
                                ? 'bg-rose-500'
                                : 'bg-amber-400'
                            }`}
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleSaveInventory}
                  disabled={createInventoryMut.isPending || updateInventoryMut.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>
                    {editingInventory
                      ? t('Сохранить инвентарь', 'Update Inventory')
                      : t('Создать инвентарь', 'Create Inventory')}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 3: RUN JOB & REAL-TIME SSE STREAMING CONSOLE
         ===================================================================== */}
      {activeTab === 'run' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Column: Job Launch Parameters */}
          <div className="space-y-4 lg:col-span-5">
            <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <Rocket className="h-4 w-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-slate-100">
                  {t('Параметры запуска Ansible Job', 'Ansible Playbook Execution Config')}
                </h2>
              </div>

              {runError && (
                <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {runError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t('1. Выберите Ansible Playbook', '1. Select Ansible Playbook')}
                </label>
                <select
                  value={runPlaybookId}
                  onChange={(e) => setRunPlaybookId(Number(e.target.value))}
                  className="w-full rounded-md border border-slate-700 bg-[#0F172A] px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value={0}>
                    {t('-- Выберите плейбук --', '-- Select Playbook --')}
                  </option>
                  {playbooks.map((pb) => (
                    <option key={pb.id} value={pb.id}>
                      {pb.name} ({pb.validation_status})
                    </option>
                  ))}
                </select>
                {selectedRunPlaybook && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    {selectedRunPlaybook.description}
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-300">
                    {t('2. Выберите целевой Inventory', '2. Select Target Inventory')}
                  </label>
                  {inventories.length === 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        openCreateInventory();
                        switchTab('inventories');
                      }}
                      className="text-[11px] font-medium text-emerald-400 hover:underline"
                    >
                      {t('+ Создать инвентарь', '+ Create Inventory')}
                    </button>
                  )}
                </div>
                <select
                  value={runInventoryId}
                  onChange={(e) => setRunInventoryId(Number(e.target.value))}
                  className="w-full rounded-md border border-slate-700 bg-[#0F172A] px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value={0}>
                    {t('-- Выберите инвентарь --', '-- Select Inventory --')}
                  </option>
                  {inventories.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.name} ({inv.server_count} hosts)
                    </option>
                  ))}
                </select>
                {selectedRunInventory && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {selectedRunInventory.servers.map((s) => (
                      <span
                        key={s.id}
                        className="rounded bg-[#0F172A] px-2 py-0.5 font-mono text-[10px] text-slate-300"
                      >
                        {s.name} ({s.ip_address})
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-800 bg-[#0F172A] px-3 py-2 text-xs text-slate-200">
                  <input
                    type="checkbox"
                    checked={runCheckMode}
                    onChange={(e) => setRunCheckMode(e.target.checked)}
                    className="rounded border-slate-600 text-emerald-500"
                  />
                  <div>
                    <div className="font-medium">Check Mode</div>
                    <div className="font-mono text-[10px] text-slate-400">--check (dry-run)</div>
                  </div>
                </label>

                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-800 bg-[#0F172A] px-3 py-2 text-xs text-slate-200">
                  <input
                    type="checkbox"
                    checked={runDiffMode}
                    onChange={(e) => setRunDiffMode(e.target.checked)}
                    className="rounded border-slate-600 text-emerald-500"
                  />
                  <div>
                    <div className="font-medium">Diff Mode</div>
                    <div className="font-mono text-[10px] text-slate-400">--diff</div>
                  </div>
                </label>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t('Теги задач (--tags, через запятую)', 'Task Tags (--tags, comma-separated)')}
                </label>
                <input
                  type="text"
                  value={runTags}
                  onChange={(e) => setRunTags(e.target.value)}
                  placeholder="health,audit"
                  className="w-full rounded-md border border-slate-700 bg-[#0F172A] px-3 py-2 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-300">
                    {t('Переменные (--extra-vars JSON)', 'Extra Variables (--extra-vars JSON)')}
                  </label>
                  <span className="font-mono text-[10px] text-slate-500">
                    {t('Секреты маскируются автоматически', 'Secrets auto-redacted')}
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={runExtraVarsJson}
                  onChange={(e) => setRunExtraVarsJson(e.target.value)}
                  placeholder='{"prune_dangling": false, "app_port": 8080}'
                  className="w-full rounded-md border border-slate-700 bg-[#0F172A] p-2.5 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-2">
                {activeJobId && (liveStatus === 'RUNNING' || liveStatus === 'PENDING') ? (
                  <button
                    type="button"
                    onClick={() => cancelJobMut.mutate(activeJobId)}
                    disabled={cancelJobMut.isPending}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-rose-500"
                  >
                    <Square className="h-3.5 w-3.5" />
                    <span>{t('Остановить выполнение (Cancel Job)', 'Cancel Running Job')}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleLaunchJob}
                    disabled={startJobMut.isPending}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    <Play className="h-4 w-4" />
                    <span>
                      {startJobMut.isPending
                        ? t('Запуск ansible-playbook...', 'Starting ansible-playbook...')
                        : t('Запустить Ansible Playbook', 'Execute Ansible Playbook')}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Live SSE Execution Terminal */}
          <div className="lg:col-span-7">
            <div className="flex h-full flex-col rounded-lg border border-slate-800 bg-[#1E293B] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <Terminal className="h-4 w-4 text-emerald-400" />
                  <h2 className="text-sm font-semibold text-slate-100">
                    {activeJobId
                      ? `Job #${activeJobId} — Live SSE Stream`
                      : t('Консоль вывода ansible-playbook (SSE)', 'Live Ansible Execution Output (SSE)')}
                  </h2>
                  {renderStatusBadge(liveStatus)}
                </div>

                <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
                  {liveExitCode !== null && <span>exit={liveExitCode}</span>}
                  {liveDurationMs > 0 && <span>{liveDurationMs}ms</span>}
                  <button
                    type="button"
                    onClick={() => {
                      const text = [liveStdout, liveStderr].filter(Boolean).join('\n');
                      navigator.clipboard?.writeText(text);
                      setCopiedConsole(true);
                      setTimeout(() => setCopiedConsole(false), 1500);
                    }}
                    className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#0F172A] px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
                  >
                    <Copy className="h-3 w-3" />
                    <span>{copiedConsole ? t('Скопировано', 'Copied') : t('Копировать', 'Copy')}</span>
                  </button>
                </div>
              </div>

              <pre
                ref={consoleEndRef}
                className="mt-3 flex-1 min-h-[380px] max-h-[540px] overflow-y-auto rounded-md border border-slate-800 bg-[#0F172A] p-4 font-mono text-xs leading-relaxed text-slate-200 whitespace-pre-wrap"
              >
                {liveStdout || liveStderr ? (
                  <>
                    {liveStdout}
                    {liveStderr && (
                      <span className="text-rose-400">
                        {liveStdout ? '\n' : ''}
                        {liveStderr}
                      </span>
                    )}
                  </>
                ) : activeJobId ? (
                  <span className="text-slate-400">
                    {t(
                      'Ожидание потокового вывода от процесса ansible-playbook...',
                      'Waiting for real-time stdout/stderr stream from ansible-playbook...'
                    )}
                  </span>
                ) : (
                  <span className="text-slate-500">
                    {t(
                      'Выберите плейбук и инвентарь слева и нажмите «Запустить Ansible Playbook». Вывод PLAY / TASK / PLAY RECAP будет транслироваться сюда в реальном времени через SSE.',
                      'Select a playbook and inventory on the left and click "Execute Ansible Playbook". Real-time PLAY / TASK / PLAY RECAP output streams here over SSE.'
                    )}
                  </span>
                )}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 4: JOB HISTORY & AUTOMATION AUDIT LOGS
         ===================================================================== */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#1E293B] p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                <Filter className="h-3.5 w-3.5 text-emerald-400" />
                <span>{t('Фильтры:', 'Filters:')}</span>
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded border border-slate-700 bg-[#0F172A] px-2.5 py-1.5 text-xs text-slate-200"
              >
                <option value="all">{t('Все статусы', 'All Statuses')}</option>
                <option value="SUCCESS">SUCCESS</option>
                <option value="FAILED">FAILED</option>
                <option value="RUNNING">RUNNING</option>
                <option value="CANCELLED">CANCELLED</option>
                <option value="PENDING">PENDING</option>
              </select>

              <select
                value={playbookFilter || ''}
                onChange={(e) =>
                  setPlaybookFilter(e.target.value ? Number(e.target.value) : undefined)
                }
                className="rounded border border-slate-700 bg-[#0F172A] px-2.5 py-1.5 text-xs text-slate-200"
              >
                <option value="">{t('Все плейбуки', 'All Playbooks')}</option>
                {playbooks.map((pb) => (
                  <option key={pb.id} value={pb.id}>
                    {pb.name}
                  </option>
                ))}
              </select>

              <select
                value={inventoryFilter || ''}
                onChange={(e) =>
                  setInventoryFilter(e.target.value ? Number(e.target.value) : undefined)
                }
                className="rounded border border-slate-700 bg-[#0F172A] px-2.5 py-1.5 text-xs text-slate-200"
              >
                <option value="">{t('Все инвентари', 'All Inventories')}</option>
                {inventories.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => {
                void refetchJobs();
                void refetchAuditLogs();
              }}
              className="rounded border border-slate-700 bg-[#0F172A] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              {t('Обновить журнал', 'Refresh')}
            </button>
          </div>

          {/* Jobs Table */}
          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#1E293B]">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 font-medium text-slate-400">
                  <th className="px-4 py-3">Job ID</th>
                  <th className="px-4 py-3">{t('Статус', 'Status')}</th>
                  <th className="px-4 py-3">{t('Плейбук', 'Playbook')}</th>
                  <th className="px-4 py-3">{t('Инвентарь', 'Inventory')}</th>
                  <th className="px-4 py-3">{t('Режим / Теги', 'Mode / Tags')}</th>
                  <th className="px-4 py-3">{t('Длительность', 'Duration')}</th>
                  <th className="px-4 py-3">{t('Время запуска', 'Created At')}</th>
                  <th className="px-4 py-3 text-right">{t('Действия', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      {t('Запусков Ansible Job не найдено.', 'No Ansible jobs recorded yet.')}
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => (
                    <tr key={job.id} className="hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-200">
                        #{job.id}
                      </td>
                      <td className="px-4 py-3">{renderStatusBadge(job.status)}</td>
                      <td className="px-4 py-3 font-medium text-slate-100">
                        {job.playbook_name}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{job.inventory_name}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-400">
                        {job.check_mode ? '--check ' : ''}
                        {job.diff_mode ? '--diff ' : ''}
                        {job.tags.length > 0 ? `tags:${job.tags.join(',')}` : 'default'}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-400 tabular-nums">
                        {job.duration_ms}ms
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-400 tabular-nums">
                        {new Date(job.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setInspectedJobId(job.id)}
                          className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#0F172A] px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
                        >
                          <Eye className="h-3 w-3 text-emerald-400" />
                          <span>{t('Лог вывода', 'View Output')}</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Inspected Job Output Drawer */}
          {inspectedJobId && (
            <div className="rounded-lg border border-emerald-500/40 bg-[#1E293B] p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-slate-100">
                    {t(`Детали выполнения Job #${inspectedJobId}`, `Job #${inspectedJobId} Execution Details`)}
                  </h3>
                  {inspectedJob && renderStatusBadge(inspectedJob.status)}
                </div>
                <button
                  type="button"
                  onClick={() => setInspectedJobId(null)}
                  className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                >
                  {t('Закрыть', 'Close')}
                </button>
              </div>

              {isInspectedJobLoading || !inspectedJob ? (
                <div className="py-6 text-center text-xs text-slate-400">
                  {t('Загрузка полного вывода Job...', 'Loading full job output...')}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-4 font-mono text-xs text-slate-400">
                    <span>Playbook: {inspectedJob.playbook_name}</span>
                    <span>Inventory: {inspectedJob.inventory_name}</span>
                    <span>Exit Code: {inspectedJob.exit_code ?? '—'}</span>
                    <span>Duration: {inspectedJob.duration_ms}ms</span>
                    <span>
                      Extra Vars: {JSON.stringify(inspectedJob.extra_vars || {})}
                    </span>
                  </div>
                  <pre className="max-h-96 overflow-y-auto rounded border border-slate-800 bg-[#0F172A] p-4 font-mono text-xs text-slate-200 whitespace-pre-wrap">
                    {(
                      (inspectedJob.stdout || '') +
                      (inspectedJob.stderr ? `\n${inspectedJob.stderr}` : '')
                    ).trim() || 'No output recorded.'}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Automation Audit Trail */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              {t('Журнал аудита безопасности (Automation Audit Trail)', 'Automation Security Audit Trail')}
            </h2>
            <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#1E293B]">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 font-medium text-slate-400">
                    <th className="px-4 py-2.5">{t('Событие', 'Event')}</th>
                    <th className="px-4 py-2.5">Job</th>
                    <th className="px-4 py-2.5">{t('Плейбук / Инвентарь', 'Playbook / Inventory')}</th>
                    <th className="px-4 py-2.5">{t('Целевые серверы', 'Target Servers')}</th>
                    <th className="px-4 py-2.5">{t('Результат', 'Result')}</th>
                    <th className="px-4 py-2.5">{t('Время', 'Timestamp')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-mono">
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                        {t('Записей аудита пока нет.', 'No automation audit events yet.')}
                      </td>
                    </tr>
                  ) : (
                    auditLogs.slice(0, 25).map((log) => (
                      <tr key={log.id} className="hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 text-emerald-400">{log.event_type}</td>
                        <td className="px-4 py-2.5 text-slate-300">#{log.job_id}</td>
                        <td className="px-4 py-2.5 text-slate-200">
                          {log.playbook_name} → {log.inventory_name}
                        </td>
                        <td className="px-4 py-2.5 text-slate-400">
                          {Array.isArray(log.target_servers)
                            ? log.target_servers.map((s) => s.name || s.ip_address).join(', ')
                            : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-slate-300">{log.result}</td>
                        <td className="px-4 py-2.5 text-slate-400">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 5: DIRECT SSH ROLLOUT (PRESERVED EXISTING SSH MODULE)
         ===================================================================== */}
      {activeTab === 'ssh' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-800 bg-[#1E293B] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-slate-100">
                  {t(
                    'Быстрое выполнение одиночной SSH-команды (Direct SSH Command)',
                    'Direct Single-Host SSH Command Runner'
                  )}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {servers.map((srv) => (
                  <button
                    key={srv.id}
                    type="button"
                    onClick={() => setSelectedSshServerId(srv.id)}
                    className={`rounded border px-2.5 py-1 text-xs font-medium ${
                      selectedSshServerId === srv.id
                        ? 'border-emerald-500/60 bg-emerald-500/15 text-white'
                        : 'border-slate-700 bg-[#0F172A] text-slate-300'
                    }`}
                  >
                    {srv.name} ({srv.ip_address})
                  </button>
                ))}
              </div>
            </div>

            <textarea
              rows={3}
              value={customSshCmd}
              onChange={(e) => setCustomSshCmd(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-[#0F172A] p-3 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            />

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  if (!selectedSshServerId || !customSshCmd.trim()) return;
                  execSshMut.mutate(
                    { id: selectedSshServerId, command: customSshCmd },
                    {
                      onSuccess: (res) => {
                        setSshLastOutput({
                          command: res.command,
                          stdout: res.stdout,
                          stderr: res.stderr,
                          exitCode: res.exit_code,
                          durationMs: res.duration_ms,
                        });
                      },
                    }
                  );
                }}
                disabled={execSshMut.isPending || !selectedSshServerId}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                <Play className="h-3.5 w-3.5" />
                <span>
                  {execSshMut.isPending
                    ? t('Выполнение...', 'Executing...')
                    : t('Выполнить по SSH', 'Run over SSH')}
                </span>
              </button>
            </div>

            {sshLastOutput && (
              <pre className="rounded border border-slate-800 bg-[#0F172A] p-4 font-mono text-xs text-slate-200 whitespace-pre-wrap">
                $ {sshLastOutput.command} (exit {sshLastOutput.exitCode}, {sshLastOutput.durationMs}ms)
                {'\n'}
                {sshLastOutput.stdout}
                {sshLastOutput.stderr ? `\n${sshLastOutput.stderr}` : ''}
              </pre>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#1E293B]">
            <table className="w-full border-collapse text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="px-4 py-2.5">Exit</th>
                  <th className="px-4 py-2.5">Command</th>
                  <th className="px-4 py-2.5">Duration</th>
                  <th className="px-4 py-2.5">Executed At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {sshCommandLogs.slice(0, 10).map((log) => (
                  <tr key={log.id}>
                    <td className="px-4 py-2 text-emerald-400">exit {log.exit_code}</td>
                    <td className="px-4 py-2 text-slate-200 truncate max-w-md">{log.command}</td>
                    <td className="px-4 py-2 text-slate-400">{log.duration_ms}ms</td>
                    <td className="px-4 py-2 text-slate-400">
                      {new Date(log.executed_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
