import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useRealtimeStore, FeedEvent, MAX_FEED_EVENTS } from '../../apps/web/src/stores/realtimeStore.js';
import {
  formatEventSummary,
  formatRelativeTime,
  getEventCategory
} from '../../apps/web/src/features/feed/eventFormatter.js';

describe('Phase 6: Live Event Feed Widget', () => {
  const homePageSource = fs.readFileSync(
    path.resolve('apps/web/src/pages/HomePage.tsx'),
    'utf8'
  );
  const drawerSource = fs.readFileSync(
    path.resolve('apps/web/src/features/feed/EventFeedDrawer.tsx'),
    'utf8'
  );
  const hookSource = fs.readFileSync(
    path.resolve('apps/web/src/hooks/useRealtime.ts'),
    'utf8'
  );

  beforeEach(() => {
    useRealtimeStore.getState().clearEvents();
  });

  describe('1. Test ID Contract & UI Architecture', () => {
    it('contains all required data-testid attributes from PRD Phase 6', () => {
      // Event feed panel and controls
      expect(drawerSource).toContain('data-testid="event-feed"');
      expect(drawerSource).toContain('data-testid="event-feed-toggle"');
      expect(drawerSource).toContain('data-testid="event-feed-pause"');
      expect(drawerSource).toContain('data-testid="event-feed-clear"');

      // Filter chips
      expect(drawerSource).toContain('data-testid={`event-feed-filter-${opt.id}`}');

      // Dynamic item and replay testids
      expect(drawerSource).toContain('data-testid={`event-feed-item-${ev.seq}`}');
      expect(drawerSource).toContain('data-testid={`event-feed-replay-${ev.seq}`}');
    });

    it('embeds EventFeedDrawer in HomePage while preserving all dashboard KPI testids', () => {
      expect(homePageSource).toContain('<EventFeedDrawer');
      expect(homePageSource).toContain('data-testid="tile-staged-units"');
      expect(homePageSource).toContain('data-testid="tile-reserved-units"');
      expect(homePageSource).toContain('data-testid="tile-available-units"');
      expect(homePageSource).toContain('data-testid="tile-pending-orders"');
      expect(homePageSource).toContain('data-testid="tile-active-missions"');
      expect(homePageSource).toContain('data-testid="tile-completed-today"');
      expect(homePageSource).toContain('data-testid="tile-open-exceptions"');
    });

    it('buffers incoming events with requestAnimationFrame batching in useRealtime', () => {
      expect(hookSource).toContain('requestAnimationFrame');
      expect(hookSource).toContain('pendingEventsRef');
      expect(hookSource).toContain('pushEvents');
    });
  });

  describe('2. Ring Buffer & Deduplication Logic in realtimeStore', () => {
    it('caps event buffer at MAX_FEED_EVENTS (50) keeping newest first', () => {
      const events: FeedEvent[] = [];
      for (let i = 1; i <= 70; i++) {
        events.push({
          seq: i,
          event_type: 'order.created',
          entity_type: 'order',
          entity_id: `ORD-${i}`,
          data: { ref: `ORD-${i}` },
          created_at: new Date(Date.now() + i * 1000).toISOString()
        });
      }

      useRealtimeStore.getState().pushEvents(events);

      const stored = useRealtimeStore.getState().events;
      expect(stored.length).toBe(MAX_FEED_EVENTS); // 50
      expect(stored[0].seq).toBe(70); // newest first
      expect(stored[stored.length - 1].seq).toBe(21); // oldest kept
      expect(useRealtimeStore.getState().lastSeq).toBe(70);
    });

    it('deduplicates events by seq strictly without creating duplicates', () => {
      const initial: FeedEvent[] = [
        {
          seq: 10,
          event_type: 'order.created',
          entity_type: 'order',
          entity_id: 'ORD-0010',
          data: { ref: 'ORD-0010' },
          created_at: '2026-11-06T12:00:00Z'
        },
        {
          seq: 11,
          event_type: 'order.created',
          entity_type: 'order',
          entity_id: 'ORD-0011',
          data: { ref: 'ORD-0011' },
          created_at: '2026-11-06T12:01:00Z'
        }
      ];

      useRealtimeStore.getState().pushEvents(initial);
      expect(useRealtimeStore.getState().events.length).toBe(2);

      // Re-push seq 10 and 11 along with new seq 12
      const duplicateBatch: FeedEvent[] = [
        {
          seq: 10,
          event_type: 'order.created',
          entity_type: 'order',
          entity_id: 'ORD-0010',
          data: { ref: 'ORD-0010' },
          created_at: '2026-11-06T12:00:00Z',
          replay: true
        },
        {
          seq: 11,
          event_type: 'order.created',
          entity_type: 'order',
          entity_id: 'ORD-0011',
          data: { ref: 'ORD-0011' },
          created_at: '2026-11-06T12:01:00Z',
          replay: true
        },
        {
          seq: 12,
          event_type: 'pick.confirmed',
          entity_type: 'stop',
          entity_id: 'STP-001',
          data: { picked_qty: 3, stop_ref: 'MIS-0001-S01' },
          created_at: '2026-11-06T12:02:00Z'
        }
      ];

      useRealtimeStore.getState().pushEvents(duplicateBatch);

      const updated = useRealtimeStore.getState().events;
      expect(updated.length).toBe(3);
      expect(updated.map((e) => e.seq)).toEqual([12, 11, 10]);
    });

    it('clears all events cleanly on clearEvents()', () => {
      useRealtimeStore.getState().pushEvent({
        seq: 1,
        event_type: 'order.created',
        entity_type: 'order',
        entity_id: 'ORD-0001',
        data: {},
        created_at: new Date().toISOString()
      });
      expect(useRealtimeStore.getState().events.length).toBe(1);

      useRealtimeStore.getState().clearEvents();
      expect(useRealtimeStore.getState().events.length).toBe(0);
    });

    it('processes 500 replayed events in a single batch update', () => {
      const replay500: FeedEvent[] = Array.from({ length: 500 }, (_, i) => ({
        seq: i + 1,
        event_type: 'inventory.changed',
        entity_type: 'inventory',
        entity_id: `BIN-${i + 1}`,
        data: { bins: [`BIN-${i + 1}`] },
        created_at: new Date().toISOString(),
        replay: true
      }));

      useRealtimeStore.getState().pushEvents(replay500);

      const stored = useRealtimeStore.getState().events;
      expect(stored.length).toBe(50);
      expect(stored[0].seq).toBe(500);
      expect(stored[0].replay).toBe(true);
      expect(useRealtimeStore.getState().lastSeq).toBe(500);
    });
  });

  describe('3. Human Summaries & Formatter', () => {
    it('formats pick.confirmed correctly', () => {
      const summary = formatEventSummary({
        seq: 1,
        event_type: 'pick.confirmed',
        entity_type: 'stop',
        entity_id: 'STP-01',
        data: { picked_qty: 5, stop_ref: 'MIS-0001-S01' },
        created_at: '2026-11-06T10:00:00Z'
      });
      expect(summary).toBe('Picked 5 on MIS-0001-S01');
    });

    it('formats inventory.changed with <= 3 bins', () => {
      const summary = formatEventSummary({
        seq: 2,
        event_type: 'inventory.changed',
        entity_type: 'inventory',
        entity_id: 'A-01-L-1',
        data: { bins: ['A-01-L-1', 'B-02-R-1'] },
        created_at: '2026-11-06T10:00:00Z'
      });
      expect(summary).toBe('Stock changed in A-01-L-1, B-02-R-1');
    });

    it('formats inventory.changed with > 3 bins truncated with +n', () => {
      const summary = formatEventSummary({
        seq: 3,
        event_type: 'inventory.changed',
        entity_type: 'inventory',
        entity_id: 'A-01-L-1',
        data: { bins: ['A-01-L-1', 'B-02-R-1', 'C-03-L-1', 'D-04-R-1', 'D-05-L-2'] },
        created_at: '2026-11-06T10:00:00Z'
      });
      expect(summary).toBe('Stock changed in A-01-L-1, B-02-R-1, C-03-L-1 +2');
    });

    it('formats order.created correctly', () => {
      const summary = formatEventSummary({
        seq: 4,
        event_type: 'order.created',
        entity_type: 'order',
        entity_id: 'ORD-0001',
        data: { ref: 'ORD-0001' },
        created_at: '2026-11-06T10:00:00Z'
      });
      expect(summary).toBe('Order ORD-0001 created');
    });

    it('formats order.status_changed and order.completed correctly', () => {
      const s1 = formatEventSummary({
        seq: 5,
        event_type: 'order.status_changed',
        entity_type: 'order',
        entity_id: 'ORD-0001',
        data: { ref: 'ORD-0001', status: 'ASSIGNED' },
        created_at: '2026-11-06T10:00:00Z'
      });
      expect(s1).toBe('Order ORD-0001 → ASSIGNED');

      const s2 = formatEventSummary({
        seq: 6,
        event_type: 'order.completed',
        entity_type: 'order',
        entity_id: 'ORD-0001',
        data: { ref: 'ORD-0001' },
        created_at: '2026-11-06T10:00:00Z'
      });
      expect(s2).toBe('Order ORD-0001 completed');
    });

    it('formats exception.opened and exception.resolved correctly', () => {
      const s1 = formatEventSummary({
        seq: 7,
        event_type: 'exception.opened',
        entity_type: 'exception',
        entity_id: 'EXC-0001',
        data: { type: 'SHORTAGE' },
        created_at: '2026-11-06T10:00:00Z'
      });
      expect(s1).toBe('Exception opened: SHORTAGE');

      const s2 = formatEventSummary({
        seq: 8,
        event_type: 'exception.resolved',
        entity_type: 'exception',
        entity_id: 'EXC-0001',
        data: { resolution: 'REALLOCATED' },
        created_at: '2026-11-06T10:00:00Z'
      });
      expect(s2).toBe('Exception resolved: REALLOCATED');
    });

    it('falls back to raw event_type for unmapped events', () => {
      const s = formatEventSummary({
        seq: 9,
        event_type: 'custom.telemetry.ping',
        entity_type: 'telemetry',
        entity_id: '123',
        data: {},
        created_at: '2026-11-06T10:00:00Z'
      });
      expect(s).toBe('custom.telemetry.ping');
    });
  });

  describe('4. Relative Timestamps & Event Categories', () => {
    it('formats relative timestamps accurately', () => {
      const now = new Date('2026-11-06T12:00:00Z').getTime();

      expect(formatRelativeTime('2026-11-06T11:59:58Z', now)).toBe('just now');
      expect(formatRelativeTime('2026-11-06T11:59:48Z', now)).toBe('12s ago');
      expect(formatRelativeTime('2026-11-06T11:58:00Z', now)).toBe('2m ago');
      expect(formatRelativeTime('2026-11-06T10:00:00Z', now)).toBe('2h ago');
      expect(formatRelativeTime('2026-11-04T12:00:00Z', now)).toBe('2d ago');
    });

    it('categorizes events into correct filter domains', () => {
      expect(getEventCategory('order.created')).toBe('orders');
      expect(getEventCategory('order.status_changed')).toBe('orders');
      expect(getEventCategory('reservation.changed')).toBe('orders');

      expect(getEventCategory('mission.assigned')).toBe('missions');
      expect(getEventCategory('mission.started')).toBe('missions');

      expect(getEventCategory('pick.confirmed')).toBe('picks');

      expect(getEventCategory('inventory.changed')).toBe('inventory');
      expect(getEventCategory('bin.status_changed')).toBe('inventory');
      expect(getEventCategory('receipt.created')).toBe('inventory');
      expect(getEventCategory('putaway.completed')).toBe('inventory');

      expect(getEventCategory('exception.opened')).toBe('exceptions');
      expect(getEventCategory('exception.resolved')).toBe('exceptions');
    });
  });
});
