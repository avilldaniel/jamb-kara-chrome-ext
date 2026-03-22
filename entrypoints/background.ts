import { DEFAULT_STATE, semitonesToFactor } from '../utils/constants';
import type { ExtensionState, PopupMessage, OffscreenMessage } from '../utils/types';

export default defineBackground(() => {
  let state: ExtensionState = { ...DEFAULT_STATE };

  // ---------------------------------------------------------------------------
  // Per-video pitch storage
  // ---------------------------------------------------------------------------

  function extractVideoId(url: string): string | null {
    try {
      const u = new URL(url);
      if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    } catch {}
    return null;
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

  // ---------------------------------------------------------------------------
  // Offscreen lifecycle
  // ---------------------------------------------------------------------------

  async function ensureOffscreen() {
    const contexts = await (chrome.runtime as any).getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (contexts.length > 0) return;

    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'Tab audio pitch shifting via WASM AudioWorklet',
    });
  }

  async function closeOffscreen() {
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      // already closed
    }
  }

  function sendToOffscreen(message: OffscreenMessage) {
    return chrome.runtime.sendMessage(message);
  }

  // ---------------------------------------------------------------------------
  // Tab capture
  // ---------------------------------------------------------------------------

  function getMediaStreamId(tabId: number): Promise<string> {
    return new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(streamId);
        }
      });
    });
  }

  async function startCapture(tabId?: number, videoId?: string) {
    // If already capturing, stop first (handles tab navigation)
    if (state.isCapturing) {
      await stopCapture();
    }

    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab');
      tabId = tab.id;
      if (!videoId && tab.url) videoId = extractVideoId(tab.url) ?? undefined;
    }

    const streamId = await getMediaStreamId(tabId);
    await ensureOffscreen();

    const response = await sendToOffscreen({
      target: 'offscreen',
      type: 'START',
      streamId,
    });

    if (!response?.success) {
      await closeOffscreen();
      throw new Error(response?.error || 'Failed to start audio');
    }

    state.isCapturing = true;
    state.capturingTabId = tabId;
    state.currentVideoId = videoId ?? null;

    // Restore saved pitch for this video, or apply current pitch
    if (videoId) {
      const savedPitch = await getPitchForVideo(videoId);
      if (savedPitch !== null) {
        state.pitchSemitones = savedPitch;
      }
    }

    if (state.pitchSemitones !== 0) {
      await sendToOffscreen({
        target: 'offscreen',
        type: 'SET_PITCH',
        pitchFactor: semitonesToFactor(state.pitchSemitones),
      });
    }

    updateBadge();
  }

  async function stopCapture() {
    await sendToOffscreen({ target: 'offscreen', type: 'STOP' }).catch(() => {});
    await closeOffscreen();

    state.isCapturing = false;
    state.capturingTabId = null;
    state.currentVideoId = null;
    updateBadge();
  }

  async function setPitch(semitones: number) {
    state.pitchSemitones = semitones;

    if (state.currentVideoId) {
      await savePitchForVideo(state.currentVideoId, semitones);
    }

    if (state.isCapturing) {
      await sendToOffscreen({
        target: 'offscreen',
        type: 'SET_PITCH',
        pitchFactor: semitonesToFactor(semitones),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Badge
  // ---------------------------------------------------------------------------

  function updateBadge() {
    if (state.isCapturing) {
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  }

  // ---------------------------------------------------------------------------
  // Message listeners
  // ---------------------------------------------------------------------------

  // Popup messages
  chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
    // Ignore messages meant for offscreen
    if ('target' in message) return false;

    const handle = async () => {
      switch (message.action) {
        case 'GET_STATE':
          return { type: 'STATE', state };

        case 'START_CAPTURE':
          await startCapture();
          return { type: 'STATE', state };

        case 'STOP_CAPTURE':
          await stopCapture();
          return { type: 'STATE', state };

        case 'SET_PITCH':
          await setPitch(message.semitones);
          return { type: 'STATE', state };

        case 'SET_SPEED':
          state.speed = message.speed;
          return { type: 'STATE', state };
      }
    };

    handle()
      .then(sendResponse)
      .catch((err) => sendResponse({ type: 'ERROR', message: err.message }));

    return true; // async response
  });

  // Clean up if captured tab is closed
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === state.capturingTabId) {
      stopCapture();
    }
  });

  // Handle tab navigation — re-capture or auto-start based on saved pitch
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;

    const videoId = extractVideoId(tab.url);
    if (!videoId) return;

    if (tabId === state.capturingTabId) {
      // User navigated within the captured tab — re-capture with new video's pitch
      try {
        await startCapture(tabId, videoId);
      } catch {
        // Tab may not be capturable anymore
      }
    } else if (!state.isCapturing) {
      // Different tab, not currently capturing — auto-start if saved pitch exists
      const savedPitch = await getPitchForVideo(videoId);
      if (savedPitch !== null && savedPitch !== 0) {
        try {
          await startCapture(tabId, videoId);
        } catch {
          // Tab may not be capturable
        }
      }
    }
  });

  console.log('Background service worker started');
});
