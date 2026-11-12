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
  permissions: string[];
  login: (token: string, user: AuthUser, permissions?: string[]) => void;
  logout: () => void;
}

const STORAGE_KEY = 'dark_storage_auth';

function getInitialState(): { token: string | null; user: AuthUser | null; permissions: string[] } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        token: parsed.token || null,
        user: parsed.user || null,
        permissions: parsed.permissions || []
      };
    }
  } catch {
    // ignore
  }
  return { token: null, user: null, permissions: [] };
}

export const useAuthStore = create<AuthState>((set) => ({
  ...getInitialState(),
  login: (token, user, permissions = []) => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user, permissions }));
    set({ token, user, permissions });
  },
  logout: () => {
    sessionStorage.removeItem(STORAGE_KEY);
    set({ token: null, user: null, permissions: [] });
  }
}));
