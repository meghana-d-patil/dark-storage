import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { MissionDto } from '@dark-storage/shared';

export interface BinLayout {
  code: string;
  level: number;
  capacity: number;
  status: string;
  recount_required: boolean;
  sku: string | null;
  product_name: string | null;
  qty: number;
  reserved_qty: number;
}

export interface ShelfLayout {
  code: string;
  bay: number;
  side: string;
  status: string;
  storage_class: string;
  x: number;
  y: number;
  bins: BinLayout[];
}

export interface AisleLayout {
  aisle: string;
  shelves: ShelfLayout[];
}

export interface WarehouseLayoutResponse {
  aisles: AisleLayout[];
}

export interface MissionsListResponse {
  missions: MissionDto[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * Shared hook to load warehouse layout.
 * Shares the single React Query cache key ['warehouse', 'layout'] across all views.
 */
export function useWarehouseLayout() {
  return useQuery<WarehouseLayoutResponse>({
    queryKey: ['warehouse', 'layout'],
    queryFn: () => apiFetch<WarehouseLayoutResponse>('/api/warehouse/layout'),
    refetchOnWindowFocus: true
  });
}

/**
 * Shared hook to load a specific mission with its full route and stops.
 * Query key ['missions', ref] is invalidated by realtime WebSocket mission events.
 */
export function useMissionRoute(ref?: string | null) {
  return useQuery<MissionDto>({
    queryKey: ['missions', ref],
    queryFn: () => apiFetch<MissionDto>(`/api/missions/${ref}`),
    enabled: Boolean(ref && ref.trim().length > 0),
    refetchOnWindowFocus: true
  });
}

/**
 * Shared hook to load active missions for the route selector.
 * Key ['missions'] is invalidated by realtime WebSocket mission events.
 */
export function useActiveMissions() {
  return useQuery<MissionsListResponse>({
    queryKey: ['missions'],
    queryFn: () => apiFetch<MissionsListResponse>('/api/missions?page_size=100'),
    refetchOnWindowFocus: true
  });
}
