import { createBackgroundHandlers } from '../utils/background-handlers';
import { semitonesToFactor } from '../utils/constants';

export default defineBackground(() => {
  const handlers = createBackgroundHandlers(chrome as any);

  // ---------------------------------------------------------------------------
  // Message listeners
  // ---------------------------------------------------------------------------

  // Content script + Popup messages
  chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
    const handle = async () => {
      switch (message.action) {
        // --- Content script messages ---
        case 'VIDEO_LOADED': {
          const tabId = sender.tab?.id;
          if (!tabId || !message.videoId) return { type: 'ERROR', message: 'Missing tab or videoId' };
          const result = await handlers.handleVideoLoaded(message.videoId, tabId);
          return result;
        }

        case 'AUDIO_CONNECTED':
          handlers.handleAudioConnected();
          return { type: 'OK' };

        case 'AUDIO_ERROR':
          handlers.handleAudioError(message.message);
          return { type: 'OK' };

        // --- Popup messages ---
        case 'GET_STATE':
          return { type: 'STATE', state: handlers.getState() };

        case 'SET_PITCH':
          await handlers.handleSetPitch(message.semitones);
          return { type: 'STATE', state: handlers.getState() };

        case 'SET_SPEED':
          // Speed is stored but applied by web app via YouTube API, not by extension
          return { type: 'STATE', state: handlers.getState() };
      }
    };

    handle()
      .then(sendResponse)
      .catch((err: any) => sendResponse({ type: 'ERROR', message: err.message }));

    return true; // async response
  });

  // External messages (from jam-bag web app via externally_connectable)
  chrome.runtime.onMessageExternal.addListener(
    (message: any, _sender: any, sendResponse: any) => {
      const handle = async () => {
        switch (message.type) {
          case 'PING':
            return { type: 'PONG' };

          case 'GET_STATE':
            return { type: 'STATE', state: handlers.getState() };

          case 'SET_PITCH':
            await handlers.handleSetPitch(message.semitones);
            return { type: 'STATE', state: handlers.getState() };

          case 'SET_SPEED':
            // Speed stored but applied by web app
            return { type: 'STATE', state: handlers.getState() };
        }
      };

      handle()
        .then(sendResponse)
        .catch((err: any) => sendResponse({ type: 'ERROR', message: err.message }));

      return true;
    },
  );

  // Clean up if active tab is closed
  chrome.tabs.onRemoved.addListener((tabId: number) => {
    handlers.handleTabRemoved(tabId);
  });

  console.log('Background service worker started');
});
