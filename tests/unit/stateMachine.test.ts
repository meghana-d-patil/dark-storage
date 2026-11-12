import { describe, it, expect } from 'vitest';
import {
  TRANSITIONS,
  transition,
  allowedEvents,
  StateError,
  Machine
} from '@dark-storage/shared';

describe('State Machine Foundations (P1-T8)', () => {
  const machines: Machine[] = ['ORDER', 'MISSION', 'PICK_STOP', 'EXCEPTION', 'ADJUSTMENT', 'FLOOR_TASK'];

  it('every row of every REF-2 table transition succeeds', () => {
    for (const m of machines) {
      const rows = TRANSITIONS[m];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const res = transition(m, row.from, row.event);
        expect(res.to).toBe(row.to);
        if (row.perms) {
          expect(res.perms).toEqual(row.perms);
        }
        if (row.guard) {
          expect(res.guard).toEqual(row.guard);
        }
      }
    }
  });

  it('sample of 10 illegal transitions throw StateError', () => {
    const illegalTransitions: Array<{ machine: Machine; from: string; event: string }> = [
      { machine: 'ORDER', from: 'PENDING', event: 'pack_complete' },
      { machine: 'ORDER', from: 'PICKED', event: 'start_pick' },
      { machine: 'ORDER', from: 'DISPATCHED', event: 'cancel' },
      { machine: 'MISSION', from: 'QUEUED', event: 'first_scan' },
      { machine: 'MISSION', from: 'COMPLETED', event: 'claim' },
      { machine: 'PICK_STOP', from: 'PENDING', event: 'scan_tote' },
      { machine: 'PICK_STOP', from: 'DONE', event: 'scan_bin' },
      { machine: 'EXCEPTION', from: 'OPEN', event: 'count_done' },
      { machine: 'ADJUSTMENT', from: 'PENDING_ADMIN', event: 'approve_low' },
      { machine: 'FLOOR_TASK', from: 'DONE', event: 'claim' }
    ];

    expect(illegalTransitions).toHaveLength(10);

    for (const testCase of illegalTransitions) {
      expect(() => transition(testCase.machine, testCase.from, testCase.event)).toThrowError(StateError);
      try {
        transition(testCase.machine, testCase.from, testCase.event);
      } catch (err: any) {
        expect(err).toBeInstanceOf(StateError);
        expect(err.code).toBe('STATE_CONFLICT');
        expect(err.status).toBe(409);
        expect(err.machine).toBe(testCase.machine);
        expect(err.fromState).toBe(testCase.from);
        expect(err.event).toBe(testCase.event);
      }
    }
  });

  it('no transition leaves a terminal state (terminal states have zero outgoing transitions)', () => {
    const terminalStates: Record<Machine, string[]> = {
      ORDER: ['DISPATCHED', 'CANCELLED'],
      MISSION: ['COMPLETED', 'CANCELLED'],
      PICK_STOP: ['DONE', 'SHORT', 'CANCELLED'],
      EXCEPTION: ['RESOLVED'],
      ADJUSTMENT: ['APPLIED', 'REJECTED', 'CANCELLED'],
      FLOOR_TASK: ['DONE', 'CANCELLED']
    };

    for (const [machineName, states] of Object.entries(terminalStates)) {
      const machine = machineName as Machine;
      for (const terminalState of states) {
        const events = allowedEvents(machine, terminalState);
        expect(events).toEqual([]);
      }
    }
  });
});
