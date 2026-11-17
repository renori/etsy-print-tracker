import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

/** Standard list/create/update/delete hooks for a flat REST resource at `path`. */
export function makeResourceHooks<T extends { id: string }>(key: string, path: string) {
  function useList(opts: { refetchInterval?: number } = {}) {
    return useQuery({ queryKey: [key], queryFn: () => api.get<T[]>(path), refetchInterval: opts.refetchInterval });
  }

  function useCreate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (data: Partial<T>) => api.post<T>(path, data),
      onSuccess: () => qc.invalidateQueries({ queryKey: [key] }),
    });
  }

  function useUpdate() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: ({ id, data }: { id: string; data: Partial<T> }) => api.put<T>(`${path}/${id}`, data),
      onSuccess: () => qc.invalidateQueries({ queryKey: [key] }),
    });
  }

  function useDelete() {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => api.del(`${path}/${id}`),
      onSuccess: () => qc.invalidateQueries({ queryKey: [key] }),
    });
  }

  return { useList, useCreate, useUpdate, useDelete };
}
