export type Machine = 'ORDER' | 'MISSION' | 'PICK_STOP' | 'EXCEPTION' | 'ADJUSTMENT' | 'FLOOR_TASK';

export interface Transition {
  from: string;
  event: string;
  to: string;
  perms?: string[];
  guard?: string;
}

export class StateError extends Error {
  public readonly code = 'STATE_CONFLICT';
  public readonly status = 409;

  constructor(
    public readonly machine: Machine,
    public readonly fromState: string,
    public readonly event: string,
    message?: string
  ) {
    super(message || `Invalid transition '${event}' on machine ${machine} from state '${fromState}'`);
    this.name = 'StateError';
  }
}

export const TRANSITIONS: Record<Machine, Transition[]> = {
  ORDER: [
    { from: 'PENDING', event: 'assign', to: 'ASSIGNED' },
    { from: 'RESERVED', event: 'assign', to: 'ASSIGNED' }, // legacy compatibility
    { from: 'ASSIGNED', event: 'start_pick', to: 'PICKING', perms: ['pick:execute'] },
    { from: 'ASSIGNED', event: 'unassign', to: 'PENDING', perms: ['mission:reassign'] },
    { from: 'PICKING', event: 'unassign', to: 'PENDING', perms: ['mission:reassign'] },
    { from: 'PICKING', event: 'pick_complete', to: 'PICKED', perms: ['pick:execute'] },
    { from: 'PICKED', event: 'open_pack', to: 'PACKING', perms: ['pack:execute'] },
    { from: 'PACKING', event: 'pack_complete', to: 'PACKED', perms: ['pack:execute'] },
    { from: 'PACKING', event: 'repick', to: 'PICKING', perms: ['repick:request'] },
    { from: 'PACKED', event: 'handover', to: 'DISPATCHED', perms: ['dispatch:handover'] },
    { from: 'PENDING', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
    { from: 'RESERVED', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
    { from: 'ASSIGNED', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
    { from: 'PICKING', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
    { from: 'PICKED', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
    { from: 'PACKING', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
    { from: 'PACKED', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] }
  ],

  MISSION: [
    { from: 'QUEUED', event: 'claim', to: 'CLAIMED', perms: ['mission:claim'] },
    { from: 'ASSIGNED', event: 'claim', to: 'CLAIMED', perms: ['mission:claim'] }, // legacy compatibility
    { from: 'CLAIMED', event: 'first_scan', to: 'IN_PROGRESS', perms: ['pick:execute'] },
    { from: 'IN_PROGRESS', event: 'complete', to: 'COMPLETED', perms: ['pick:execute'] },
    { from: 'CLAIMED', event: 'release', to: 'QUEUED', perms: ['mission:claim'] },
    { from: 'IN_PROGRESS', event: 'release', to: 'QUEUED', perms: ['mission:claim'] },
    { from: 'CLAIMED', event: 'force_unassign', to: 'QUEUED', perms: ['mission:reassign'] },
    { from: 'IN_PROGRESS', event: 'force_unassign', to: 'QUEUED', perms: ['mission:reassign'] },
    { from: 'QUEUED', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
    { from: 'CLAIMED', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] },
    { from: 'IN_PROGRESS', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel'] }
  ],

  PICK_STOP: [
    { from: 'PENDING', event: 'scan_bin', to: 'BIN_OK', perms: ['pick:execute'] },
    { from: 'BIN_OK', event: 'scan_item', to: 'ITEM_OK', perms: ['pick:execute'] },
    { from: 'ITEM_OK', event: 'scan_tote', to: 'DONE', perms: ['pick:execute'] },
    { from: 'PENDING', event: 'short', to: 'SHORT', perms: ['pick:execute'] },
    { from: 'BIN_OK', event: 'short', to: 'SHORT', perms: ['pick:execute'] },
    { from: 'ITEM_OK', event: 'short', to: 'SHORT', perms: ['pick:execute'] },
    { from: 'PENDING', event: 'reroute', to: 'CANCELLED' },
    { from: 'BIN_OK', event: 'reroute', to: 'CANCELLED' },
    { from: 'ITEM_OK', event: 'reroute', to: 'CANCELLED' },
    { from: 'PENDING', event: 'cancel', to: 'CANCELLED' }
  ],

  EXCEPTION: [
    { from: 'OPEN', event: 'request_count', to: 'COUNT_REQUESTED', perms: ['count:request'] },
    { from: 'COUNT_REQUESTED', event: 'count_done', to: 'COUNT_SUBMITTED' },
    { from: 'OPEN', event: 'resolve', to: 'RESOLVED', perms: ['exception:resolve'] },
    { from: 'COUNT_SUBMITTED', event: 'resolve', to: 'RESOLVED', perms: ['exception:resolve'] }
  ],

  ADJUSTMENT: [
    { from: 'PENDING_MANAGER', event: 'approve_low', to: 'APPLIED', perms: ['adjust:approve'], guard: 'value<threshold' },
    { from: 'PENDING_MANAGER', event: 'approve_high', to: 'PENDING_ADMIN', perms: ['adjust:approve'], guard: 'value>=threshold' },
    { from: 'PENDING_ADMIN', event: 'approve', to: 'APPLIED', perms: ['adjust:approve_high'] },
    { from: 'PENDING_MANAGER', event: 'reject', to: 'REJECTED', perms: ['adjust:approve', 'adjust:approve_high'] },
    { from: 'PENDING_ADMIN', event: 'reject', to: 'REJECTED', perms: ['adjust:approve', 'adjust:approve_high'] },
    { from: 'PENDING_MANAGER', event: 'cancel', to: 'CANCELLED' }
  ],

  FLOOR_TASK: [
    { from: 'OPEN', event: 'claim', to: 'CLAIMED', perms: ['floortask:claim', 'floortask:claim_pick'] },
    { from: 'CLAIMED', event: 'start', to: 'IN_PROGRESS' },
    { from: 'CLAIMED', event: 'complete', to: 'DONE' },
    { from: 'IN_PROGRESS', event: 'complete', to: 'DONE' },
    { from: 'CLAIMED', event: 'release', to: 'OPEN' },
    { from: 'IN_PROGRESS', event: 'release', to: 'OPEN' },
    { from: 'OPEN', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel', 'exception:resolve'] },
    { from: 'CLAIMED', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel', 'exception:resolve'] },
    { from: 'IN_PROGRESS', event: 'cancel', to: 'CANCELLED', perms: ['order:cancel', 'exception:resolve'] }
  ]
};

export function transition(
  machine: Machine,
  from: string,
  event: string
): { to: string; perms?: string[]; guard?: string } {
  const transitions = TRANSITIONS[machine];
  if (!transitions) {
    throw new StateError(machine, from, event, `Unknown machine: ${machine}`);
  }

  const match = transitions.find((t) => t.from === from && t.event === event);
  if (!match) {
    throw new StateError(machine, from, event);
  }

  return { to: match.to, perms: match.perms, guard: match.guard };
}

export function allowedEvents(machine: Machine, from: string): string[] {
  const transitions = TRANSITIONS[machine] || [];
  return transitions.filter((t) => t.from === from).map((t) => t.event);
}
