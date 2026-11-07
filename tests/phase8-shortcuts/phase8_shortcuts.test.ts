import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { handleHotkeyDown, isInteractiveElement } from '../../apps/web/src/hooks/useHotkeys.js';

interface KeyEventOptions {
  code?: string;
  key?: string;
  altKey?: boolean;
  repeat?: boolean;
  target?: unknown;
}

function createKeyEvent(opts: KeyEventOptions): { event: KeyboardEvent; preventDefault: ReturnType<typeof vi.fn> } {
  const preventDefault = vi.fn();
  const event = {
    code: opts.code || '',
    key: opts.key || '',
    altKey: Boolean(opts.altKey),
    repeat: Boolean(opts.repeat),
    target: opts.target || null,
    preventDefault
  } as unknown as KeyboardEvent;
  return { event, preventDefault };
}

describe('Phase 8: Keyboard Shortcuts', () => {
  const appShellSource = fs.readFileSync(
    path.resolve('apps/web/src/components/AppShell.tsx'),
    'utf8'
  );

  describe('1. Synthetic KeyboardEvent Navigation Shortcuts', () => {
    it('Alt+W navigates to /warehouse and prevents default', () => {
      const onNavigate = vi.fn();
      const onShowToast = vi.fn();
      const onToggleHelp = vi.fn();

      const { event, preventDefault } = createKeyEvent({
        code: 'KeyW',
        altKey: true
      });

      const handled = handleHotkeyDown(event, {
        userRole: 'MANAGER',
        onNavigate,
        onShowToast,
        onToggleHelp
      });

      expect(handled).toBe(true);
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith('/warehouse');
      expect(onShowToast).not.toHaveBeenCalled();
    });

    it('Alt+I navigates to /inventory and prevents default', () => {
      const onNavigate = vi.fn();
      const onShowToast = vi.fn();
      const onToggleHelp = vi.fn();

      const { event, preventDefault } = createKeyEvent({
        code: 'KeyI',
        altKey: true
      });

      const handled = handleHotkeyDown(event, {
        userRole: 'OPERATOR',
        onNavigate,
        onShowToast,
        onToggleHelp
      });

      expect(handled).toBe(true);
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith('/inventory');
    });

    it('Alt+H navigates to / and Alt+O navigates to /orders', () => {
      const onNavigate = vi.fn();
      const onShowToast = vi.fn();
      const onToggleHelp = vi.fn();

      const { event: eventH } = createKeyEvent({
        code: 'KeyH',
        altKey: true
      });
      handleHotkeyDown(eventH, {
        userRole: 'STAFF',
        onNavigate,
        onShowToast,
        onToggleHelp
      });
      expect(onNavigate).toHaveBeenCalledWith('/');

      const { event: eventO } = createKeyEvent({
        code: 'KeyO',
        altKey: true
      });
      handleHotkeyDown(eventO, {
        userRole: 'STAFF',
        onNavigate,
        onShowToast,
        onToggleHelp
      });
      expect(onNavigate).toHaveBeenCalledWith('/orders');
    });
  });

  describe('2. Role-Aware Picking Shortcut (Alt+P)', () => {
    it('allows Alt+P for MANAGER and navigates to /picking', () => {
      const onNavigate = vi.fn();
      const onShowToast = vi.fn();
      const onToggleHelp = vi.fn();

      const { event, preventDefault } = createKeyEvent({
        code: 'KeyP',
        altKey: true
      });

      const handled = handleHotkeyDown(event, {
        userRole: 'MANAGER',
        onNavigate,
        onShowToast,
        onToggleHelp
      });

      expect(handled).toBe(true);
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith('/picking');
      expect(onShowToast).not.toHaveBeenCalled();
    });

    it('allows Alt+P for PICKER and navigates to /picking', () => {
      const onNavigate = vi.fn();
      const onShowToast = vi.fn();
      const onToggleHelp = vi.fn();

      const { event } = createKeyEvent({
        code: 'KeyP',
        altKey: true
      });

      const handled = handleHotkeyDown(event, {
        userRole: 'PICKER',
        onNavigate,
        onShowToast,
        onToggleHelp
      });

      expect(handled).toBe(true);
      expect(onNavigate).toHaveBeenCalledWith('/picking');
      expect(onShowToast).not.toHaveBeenCalled();
    });

    it('blocks Alt+P for STAFF, shows toast, and does NOT navigate', () => {
      const onNavigate = vi.fn();
      const onShowToast = vi.fn();
      const onToggleHelp = vi.fn();

      const { event, preventDefault } = createKeyEvent({
        code: 'KeyP',
        altKey: true
      });

      const handled = handleHotkeyDown(event, {
        userRole: 'STAFF',
        onNavigate,
        onShowToast,
        onToggleHelp
      });

      expect(handled).toBe(true);
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(onNavigate).not.toHaveBeenCalled();
      expect(onShowToast).toHaveBeenCalledWith("Picking isn't available for your role");
    });

    it('blocks Alt+P for OPERATOR, shows toast, and does NOT navigate', () => {
      const onNavigate = vi.fn();
      const onShowToast = vi.fn();
      const onToggleHelp = vi.fn();

      const { event, preventDefault } = createKeyEvent({
        code: 'KeyP',
        altKey: true
      });

      const handled = handleHotkeyDown(event, {
        userRole: 'OPERATOR',
        onNavigate,
        onShowToast,
        onToggleHelp
      });

      expect(handled).toBe(true);
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(onNavigate).not.toHaveBeenCalled();
      expect(onShowToast).toHaveBeenCalledWith("Picking isn't available for your role");
    });
  });

  describe('3. Shortcut Help Dialog (? and Alt+/)', () => {
    it('opens shortcut help on ? key', () => {
      const onNavigate = vi.fn();
      const onShowToast = vi.fn();
      const onToggleHelp = vi.fn();

      const { event } = createKeyEvent({
        key: '?'
      });

      const handled = handleHotkeyDown(event, {
        userRole: 'MANAGER',
        onNavigate,
        onShowToast,
        onToggleHelp
      });

      expect(handled).toBe(true);
      expect(onToggleHelp).toHaveBeenCalledTimes(1);
    });

    it('opens shortcut help on Alt+Slash', () => {
      const onNavigate = vi.fn();
      const onShowToast = vi.fn();
      const onToggleHelp = vi.fn();

      const { event } = createKeyEvent({
        code: 'Slash',
        altKey: true
      });

      const handled = handleHotkeyDown(event, {
        userRole: 'MANAGER',
        onNavigate,
        onShowToast,
        onToggleHelp
      });

      expect(handled).toBe(true);
      expect(onToggleHelp).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. Input Focus & Repeat Key Suppression', () => {
    it('suppresses shortcuts when focus is inside an input element', () => {
      const onNavigate = vi.fn();
      const onShowToast = vi.fn();
      const onToggleHelp = vi.fn();

      const inputElement = { tagName: 'INPUT', isContentEditable: false };
      const { event, preventDefault } = createKeyEvent({
        code: 'KeyW',
        altKey: true,
        target: inputElement
      });

      const handled = handleHotkeyDown(event, {
        userRole: 'MANAGER',
        onNavigate,
        onShowToast,
        onToggleHelp
      });

      expect(handled).toBe(false);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('suppresses shortcuts when focus is inside textarea or select or contenteditable', () => {
      expect(isInteractiveElement({ tagName: 'TEXTAREA', isContentEditable: false })).toBe(true);
      expect(isInteractiveElement({ tagName: 'SELECT', isContentEditable: false })).toBe(true);
      expect(isInteractiveElement({ tagName: 'DIV', isContentEditable: true })).toBe(true);
      expect(isInteractiveElement({ tagName: 'DIV', isContentEditable: false })).toBe(false);
    });

    it('ignores held-down repeated keys (e.repeat === true)', () => {
      const onNavigate = vi.fn();
      const onShowToast = vi.fn();
      const onToggleHelp = vi.fn();

      const { event, preventDefault } = createKeyEvent({
        code: 'KeyW',
        altKey: true,
        repeat: true
      });

      const handled = handleHotkeyDown(event, {
        userRole: 'MANAGER',
        onNavigate,
        onShowToast,
        onToggleHelp
      });

      expect(handled).toBe(false);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('ignores non-shortcut keys without calling preventDefault', () => {
      const onNavigate = vi.fn();
      const onShowToast = vi.fn();
      const onToggleHelp = vi.fn();

      const { event, preventDefault } = createKeyEvent({
        code: 'KeyZ',
        altKey: true
      });

      const handled = handleHotkeyDown(event, {
        userRole: 'MANAGER',
        onNavigate,
        onShowToast,
        onToggleHelp
      });

      expect(handled).toBe(false);
      expect(preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('5. AppShell UI Architecture & Test IDs', () => {
    it('contains data-testid="shortcut-help" modal in AppShell', () => {
      expect(appShellSource).toContain('data-testid="shortcut-help"');
    });

    it('renders aria-keyshortcuts on navigation links', () => {
      expect(appShellSource).toContain('aria-keyshortcuts={link.hotkey}');
    });

    it('renders <kbd> hints in sidebar', () => {
      expect(appShellSource).toContain('<kbd className="nav-kbd">{link.hotkey}</kbd>');
    });

    it('preserves all existing AppShell testids and navigation links', () => {
      expect(appShellSource).toContain('data-testid="ws-status"');
      expect(appShellSource).toContain('data-testid="header-role-switcher"');
      expect(appShellSource).toContain('data-testid="header-user"');
      expect(appShellSource).toContain('data-testid="logout-btn"');
      expect(appShellSource).toContain("testId: 'nav-home'");
      expect(appShellSource).toContain("testId: 'nav-receiving'");
      expect(appShellSource).toContain("testId: 'nav-inventory'");
      expect(appShellSource).toContain("testId: 'nav-orders'");
      expect(appShellSource).toContain("testId: 'nav-picking'");
      expect(appShellSource).toContain("testId: 'nav-packing'");
      expect(appShellSource).toContain("testId: 'nav-exceptions'");
      expect(appShellSource).toContain("testId: 'nav-warehouse'");
      expect(appShellSource).toContain("testId: 'nav-tasks'");
      expect(appShellSource).toContain("testId: 'nav-admin'");
    });
  });
});
