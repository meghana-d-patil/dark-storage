import { create } from 'zustand';

interface RealtimeState {
  lastSeq: number;
  connected: boolean;
  statusText: string;
  setConnected: (connected: boolean, statusText: string) => void;
  updateSeq: (seq: number) => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  lastSeq: 0,
  connected: false,
  statusText: 'Connecting…',
  setConnected: (connected, statusText) => set({ connected, statusText }),
  updateSeq: (seq) => set((s) => ({ lastSeq: Math.max(s.lastSeq, seq) }))
}));
