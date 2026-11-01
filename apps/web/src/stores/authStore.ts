import { create } from 'zustand';
import { Role } from '@dark-storage/shared';

export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  role: Role;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const STORAGE_KEY = 'dark_storage_auth';

function getInitialState(): { token: string | null; user: AuthUser | null } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore
  }
  return { token: null, user: null };
}

export const useAuthStore = create<AuthState>((set) => ({
  ...getInitialState(),
  login: (token, user) => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
    set({ token, user });
  },
  logout: () => {
    sessionStorage.removeItem(STORAGE_KEY);
    set({ token: null, user: null });
  }
}));
