import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelAnsibleJob,
  createInventory,
  createPlaybook,
  deleteInventory,
  deletePlaybook,
  fetchAnsibleJobById,
  fetchAnsibleJobs,
  fetchAutomationAuditLogs,
  fetchAutomationStatus,
  fetchInventories,
  fetchPlaybooks,
  startAnsibleJob,
  updateInventory,
  updatePlaybook,
  validatePlaybookById,
  validatePlaybookContent,
} from '../api/automation.ts';

export function useAutomationStatus() {
  return useQuery({
    queryKey: ['automation', 'status'],
    queryFn: fetchAutomationStatus,
  });
}

export function useInventories() {
  return useQuery({
    queryKey: ['automation', 'inventories'],
    queryFn: fetchInventories,
  });
}

export function useCreateInventory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createInventory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation', 'inventories'] });
    },
  });
}

export function useUpdateInventory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: number;
      input: {
        name?: string;
        description?: string;
        group_name?: string;
        server_ids?: number[];
      };
    }) => updateInventory(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation', 'inventories'] });
    },
  });
}

export function useDeleteInventory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteInventory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation', 'inventories'] });
    },
  });
}

export function usePlaybooks() {
  return useQuery({
    queryKey: ['automation', 'playbooks'],
    queryFn: fetchPlaybooks,
  });
}

export function useCreatePlaybook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPlaybook,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation', 'playbooks'] });
    },
  });
}

export function useUpdatePlaybook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: number;
      input: { name?: string; description?: string; content?: string };
    }) => updatePlaybook(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation', 'playbooks'] });
    },
  });
}

export function useDeletePlaybook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePlaybook,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation', 'playbooks'] });
    },
  });
}

export function useValidatePlaybookById() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: validatePlaybookById,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation', 'playbooks'] });
    },
  });
}

export function useValidatePlaybookContent() {
  return useMutation({
    mutationFn: validatePlaybookContent,
  });
}

export function useAnsibleJobs(filters?: {
  status?: string;
  playbook_id?: number;
  inventory_id?: number;
  date_from?: string;
  date_to?: string;
}) {
  return useQuery({
    queryKey: ['automation', 'jobs', filters || {}],
    queryFn: () => fetchAnsibleJobs(filters),
  });
}

export function useAnsibleJob(id: number | null) {
  return useQuery({
    queryKey: ['automation', 'jobs', id],
    queryFn: () => fetchAnsibleJobById(id!),
    enabled: typeof id === 'number' && id > 0,
  });
}

export function useStartAnsibleJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: startAnsibleJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation', 'jobs'] });
      queryClient.invalidateQueries({ queryKey: ['automation', 'audit-logs'] });
    },
  });
}

export function useCancelAnsibleJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelAnsibleJob,
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['automation', 'jobs'] });
      queryClient.invalidateQueries({ queryKey: ['automation', 'jobs', id] });
      queryClient.invalidateQueries({ queryKey: ['automation', 'audit-logs'] });
    },
  });
}

export function useAutomationAuditLogs() {
  return useQuery({
    queryKey: ['automation', 'audit-logs'],
    queryFn: fetchAutomationAuditLogs,
  });
}
