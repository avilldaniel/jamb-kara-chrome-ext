import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBackgroundHandlers } from './background-handlers';
import { DEFAULT_STATE, semitonesToFactor } from './constants';
import type { ExtensionState } from './types';

/**
 * Mock Chrome APIs — injected into background handlers for testability.
 */
function createMockChrome() {
  const storage: Record<string, any> = {};

  return {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] ?? undefined })),
        set: vi.fn(async (items: Record<string, any>) => {
          Object.assign(storage, items);
        }),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
    },
    tabs: {
      sendMessage: vi.fn(async () => {}),
    },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    },
    // Helper: seed storage for tests
    _seedStorage(data: Record<string, any>) {
      Object.assign(storage, data);
    },
  };
}

describe('Background Handlers', () => {
  let chrome: ReturnType<typeof createMockChrome>;
  let handlers: ReturnType<typeof createBackgroundHandlers>;

  beforeEach(() => {
    chrome = createMockChrome();
    handlers = createBackgroundHandlers(chrome);
  });

  // =========================================================================
  // Cycle 1: VIDEO_LOADED — look up stored pitch, respond with pitchFactor
  // =========================================================================

  describe('handleVideoLoaded', () => {
    it('should return pitch factor 1.0 when no saved pitch exists', async () => {
      const result = await handlers.handleVideoLoaded('abc123', 42);

      expect(result).toEqual({ pitchFactor: 1.0 });
      expect(handlers.getState().currentVideoId).toBe('abc123');
      expect(handlers.getState().activeTabId).toBe(42);
    });

    it('should return saved pitch factor when video has stored pitch', async () => {
      chrome._seedStorage({ 'pitch:abc123': 5 });

      const result = await handlers.handleVideoLoaded('abc123', 42);

      expect(result.pitchFactor).toBeCloseTo(semitonesToFactor(5), 4);
      expect(handlers.getState().pitchSemitones).toBe(5);
      expect(handlers.getState().currentVideoId).toBe('abc123');
    });

    it('should update state when switching between videos', async () => {
      chrome._seedStorage({ 'pitch:video1': 3 });

      await handlers.handleVideoLoaded('video1', 42);
      expect(handlers.getState().pitchSemitones).toBe(3);

      // Navigate to video2 (no saved pitch) — pitch resets to 0
      await handlers.handleVideoLoaded('video2', 42);
      expect(handlers.getState().pitchSemitones).toBe(0);
      expect(handlers.getState().currentVideoId).toBe('video2');
    });
  });

  // =========================================================================
  // Cycle 2: AUDIO_CONNECTED — mark state as active
  // =========================================================================

  describe('handleAudioConnected', () => {
    it('should set isActive to true and update badge', () => {
      handlers.handleAudioConnected();

      expect(handlers.getState().isActive).toBe(true);
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'ON' });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#4CAF50' });
    });
  });

  // =========================================================================
  // Cycle 3: SET_PITCH — store pitch, forward to content script
  // =========================================================================

  describe('handleSetPitch', () => {
    it('should store pitch and forward to active tab', async () => {
      // First load a video so we have an active tab
      await handlers.handleVideoLoaded('abc123', 42);
      handlers.handleAudioConnected();

      await handlers.handleSetPitch(5);

      expect(handlers.getState().pitchSemitones).toBe(5);
      // Verify storage
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ 'pitch:abc123': 5 });
      // Verify forwarded to content script
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, {
        action: 'APPLY_PITCH',
        pitchFactor: semitonesToFactor(5),
      });
    });

    it('should remove storage entry when pitch is set to 0', async () => {
      await handlers.handleVideoLoaded('abc123', 42);
      handlers.handleAudioConnected();

      await handlers.handleSetPitch(0);

      expect(chrome.storage.local.remove).toHaveBeenCalledWith('pitch:abc123');
    });

    it('should not forward to tab if no active tab', async () => {
      await handlers.handleSetPitch(3);

      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Cycle 4: Tab removal — reset state
  // =========================================================================

  describe('handleTabRemoved', () => {
    it('should reset state when active tab is removed', async () => {
      await handlers.handleVideoLoaded('abc123', 42);
      handlers.handleAudioConnected();
      expect(handlers.getState().isActive).toBe(true);

      handlers.handleTabRemoved(42);

      expect(handlers.getState().isActive).toBe(false);
      expect(handlers.getState().activeTabId).toBeNull();
      expect(handlers.getState().currentVideoId).toBeNull();
      expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    });

    it('should not reset state when a different tab is removed', async () => {
      await handlers.handleVideoLoaded('abc123', 42);
      handlers.handleAudioConnected();

      handlers.handleTabRemoved(99); // different tab

      expect(handlers.getState().isActive).toBe(true);
      expect(handlers.getState().activeTabId).toBe(42);
    });
  });

  // =========================================================================
  // GET_STATE — return current state
  // =========================================================================

  describe('getState', () => {
    it('should return default state initially', () => {
      const state = handlers.getState();

      expect(state).toEqual(DEFAULT_STATE);
    });
  });

  // =========================================================================
  // Issue #4: Per-video pitch persistence across navigation
  // =========================================================================

  describe('per-video pitch persistence', () => {
    it('should persist pitch for a video then restore on revisit', async () => {
      // Load video A and set pitch
      await handlers.handleVideoLoaded('videoA', 42);
      handlers.handleAudioConnected();
      await handlers.handleSetPitch(7);

      // Navigate to video B (no saved pitch)
      await handlers.handleVideoLoaded('videoB', 42);
      expect(handlers.getState().pitchSemitones).toBe(0);

      // Navigate back to video A — pitch should be restored from storage
      const result = await handlers.handleVideoLoaded('videoA', 42);
      expect(handlers.getState().pitchSemitones).toBe(7);
      expect(result.pitchFactor).toBeCloseTo(semitonesToFactor(7), 4);
    });

    it('should not persist pitch when set to 0 (cleanup)', async () => {
      await handlers.handleVideoLoaded('videoA', 42);
      await handlers.handleSetPitch(5);
      await handlers.handleSetPitch(0); // reset to default

      // Revisit — should get default (no saved pitch)
      const result = await handlers.handleVideoLoaded('videoA', 42);
      expect(result.pitchFactor).toBe(1.0);
      expect(handlers.getState().pitchSemitones).toBe(0);
    });
  });

  // =========================================================================
  // Issue #5: Multiple YouTube tabs — independent state per tab
  // =========================================================================

  describe('multiple tabs', () => {
    it('should update activeTabId when a new tab reports VIDEO_LOADED', async () => {
      await handlers.handleVideoLoaded('videoA', 42);
      expect(handlers.getState().activeTabId).toBe(42);

      // Different tab loads a video
      await handlers.handleVideoLoaded('videoB', 99);
      expect(handlers.getState().activeTabId).toBe(99);
      expect(handlers.getState().currentVideoId).toBe('videoB');
    });

    it('should forward pitch only to the current active tab', async () => {
      await handlers.handleVideoLoaded('videoA', 42);
      handlers.handleAudioConnected();

      // Switch to tab 99
      await handlers.handleVideoLoaded('videoB', 99);
      handlers.handleAudioConnected();

      await handlers.handleSetPitch(3);

      // Should forward to tab 99 (active), not tab 42
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(99, {
        action: 'APPLY_PITCH',
        pitchFactor: semitonesToFactor(3),
      });
      // Should NOT have been called with tab 42 for this pitch change
      const lastCall = chrome.tabs.sendMessage.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe(99);
    });

    it('should not affect other tabs when one tab is removed', async () => {
      await handlers.handleVideoLoaded('videoA', 42);
      handlers.handleAudioConnected();

      // Tab 42 is active. Remove a random other tab.
      handlers.handleTabRemoved(99);

      expect(handlers.getState().isActive).toBe(true);
      expect(handlers.getState().activeTabId).toBe(42);
    });
  });
});
