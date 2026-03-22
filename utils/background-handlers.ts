import { DEFAULT_STATE, semitonesToFactor } from './constants';
import type { ExtensionState } from './types';

/**
 * Chrome API interface — injected for testability.
 * In production, pass the real `chrome` object.
 * In tests, pass a mock.
 */
export interface ChromeAPIs {
  storage: {
    local: {
      get(key: string): Promise<Record<string, any>>;
      set(items: Record<string, any>): Promise<void>;
      remove(key: string): Promise<void>;
    };
  };
  tabs: {
    sendMessage(tabId: number, message: any): Promise<any>;
  };
  action: {
    setBadgeText(details: { text: string }): void;
    setBadgeBackgroundColor(details: { color: string }): void;
  };
}

export function createBackgroundHandlers(chrome: ChromeAPIs) {
  let state: ExtensionState = { ...DEFAULT_STATE };

  function updateBadge() {
    if (state.isActive) {
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  }

  async function getPitchForVideo(videoId: string): Promise<number | null> {
    const key = `pitch:${videoId}`;
    const result = await chrome.storage.local.get(key);
    return result[key] ?? null;
  }

  async function savePitchForVideo(videoId: string, semitones: number): Promise<void> {
    const key = `pitch:${videoId}`;
    if (semitones === 0) {
      await chrome.storage.local.remove(key);
    } else {
      await chrome.storage.local.set({ [key]: semitones });
    }
  }

  async function forwardPitchToTab(pitchFactor: number) {
    if (state.activeTabId !== null) {
      await chrome.tabs.sendMessage(state.activeTabId, {
        action: 'APPLY_PITCH',
        pitchFactor,
      });
    }
  }

  return {
    getState(): ExtensionState {
      return { ...state };
    },

    async handleVideoLoaded(videoId: string, tabId: number) {
      state.currentVideoId = videoId;
      state.activeTabId = tabId;

      const savedPitch = await getPitchForVideo(videoId);
      if (savedPitch !== null) {
        state.pitchSemitones = savedPitch;
      } else {
        state.pitchSemitones = 0;
      }

      return { pitchFactor: semitonesToFactor(state.pitchSemitones) };
    },

    handleAudioConnected() {
      state.isActive = true;
      updateBadge();
    },

    handleAudioError(message: string) {
      console.error('Audio error from content script:', message);
    },

    async handleSetPitch(semitones: number) {
      state.pitchSemitones = semitones;

      if (state.currentVideoId) {
        await savePitchForVideo(state.currentVideoId, semitones);
      }

      await forwardPitchToTab(semitonesToFactor(semitones));
    },

    handleTabRemoved(tabId: number) {
      if (tabId === state.activeTabId) {
        state.isActive = false;
        state.activeTabId = null;
        state.currentVideoId = null;
        updateBadge();
      }
    },
  };
}
