import { create } from 'zustand';

export interface FeedEvent {
  seq: number;
  event_type: string;
  entity_type: string;
  entity_id: string;
  data: Record<string, unknown>;
  created_at: string;
  replay?: boolean;
}

export interface RealtimeState {
  lastSeq: number;
  connected: boolean;
  statusText: string;
  events: FeedEvent[];
  setConnected: (connected: boolean, statusText: string) => void;
  updateSeq: (seq: number) => void;
  pushEvent: (e: FeedEvent) => void;
  pushEvents: (events: FeedEvent[]) => void;
  clearEvents: () => void;
}

export const MAX_FEED_EVENTS = 50;

export const useRealtimeStore = create<RealtimeState>((set) => ({
  lastSeq: 0,
  connected: false,
  statusText: 'Connecting…',
  events: [],
  setConnected: (connected, statusText) => set({ connected, statusText }),
  updateSeq: (seq) => set((s) => ({ lastSeq: Math.max(s.lastSeq, seq) })),
  pushEvents: (incoming: FeedEvent[]) =>
    set((state) => {
      if (!incoming || incoming.length === 0) return state;

      const existingSeqs = new Set(state.events.map((e) => e.seq));
      const newItems: FeedEvent[] = [];
      for (const item of incoming) {
        if (typeof item.seq === 'number' && !existingSeqs.has(item.seq)) {
          existingSeqs.add(item.seq);
          newItems.push(item);
        }
      }

      if (newItems.length === 0) return state;

      const merged = [...newItems, ...state.events]
        .sort((a, b) => b.seq - a.seq)
        .slice(0, MAX_FEED_EVENTS);

      const maxSeq = Math.max(state.lastSeq, ...newItems.map((m) => m.seq));

      return {
        events: merged,
        lastSeq: maxSeq
      };
    }),
  pushEvent: (e: FeedEvent) => {
    useRealtimeStore.getState().pushEvents([e]);
  },
  clearEvents: () => set({ events: [] })
}));
