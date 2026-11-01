import { z } from 'zod';
import { MISSION_STATUSES, PICK_STOP_STATUSES, ROUTE_ALGORITHMS, MissionStatus, PickStopStatus, RouteAlgorithm } from '../enums.js';

export const assignMissionSchema = z.object({
  picker_id: z.number().int().min(1)
});

export type AssignMissionInput = z.infer<typeof assignMissionSchema>;

export const reassignMissionSchema = z.object({
  picker_id: z.number().int().min(1)
});

export type ReassignMissionInput = z.infer<typeof reassignMissionSchema>;

export const missionQuerySchema = z.object({
  status: z.enum(MISSION_STATUSES).optional(),
  picker_id: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25)
});

export type MissionQueryInput = z.infer<typeof missionQuerySchema>;

export interface PickStopDto {
  id: number;
  stop_no: number;
  stop_ref: string;
  seq: number;
  reservation_id: number;
  bin_code: string;
  shelf_code: string;
  sku: string;
  product_name: string;
  qty_required: number;
  qty_picked: number;
  status: PickStopStatus;
  confirmed_at: string | null;
}

export interface MissionProgressDto {
  total_stops: number;
  finished_stops: number;
  open_exceptions: number;
  units_required: number;
  units_picked: number;
}

export interface MissionDto {
  id: number;
  ref: string;
  order_id: number;
  order_ref: string;
  status: MissionStatus;
  picker: {
    id: number;
    name: string;
  };
  route: {
    algorithm: RouteAlgorithm;
    total_distance: number;
    start: string;
    end: string;
    legs: Array<{
      from: string;
      to: string;
      distance: number;
      path: string[];
    }>;
  };
  stops: PickStopDto[];
  progress: MissionProgressDto;
  assigned_by: {
    id: number;
    name: string;
  };
  assigned_at: string;
  started_at: string | null;
  completed_at: string | null;
}
