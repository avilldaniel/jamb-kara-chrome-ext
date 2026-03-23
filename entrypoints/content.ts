export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_end',

  main() {
    let audioReady = false;

    // 1. Inject page script (runs in main world for Web Audio API access)
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('youtube-audio-hook.js');
    script.onload = () => {
      // 2. Pass worklet + WASM URLs (content script can access chrome.runtime.getURL)
      window.dispatchEvent(
        new CustomEvent('kara:init', {
          detail: {
            workletUrl: chrome.runtime.getURL('pitch-processor.js'),
            wasmUrl: chrome.runtime.getURL('wasm/pitch_poc_bg.wasm'),
          },
        }),
      );
      // NOTE: Don't report video here — wait for kara:audio-connected
    };
    (document.head || document.documentElement).append(script);

    // 3. When audio pipeline is ready, report current video to get saved pitch
    window.addEventListener('kara:audio-connected', () => {
      audioReady = true;
      chrome.runtime.sendMessage({ action: 'AUDIO_CONNECTED' });
      reportCurrentVideo();
    });

    window.addEventListener('kara:error', ((e: CustomEvent) => {
      chrome.runtime.sendMessage({ action: 'AUDIO_ERROR', message: e.detail?.message });
    }) as EventListener);

    // 4. Listen for YouTube SPA navigation — just update pitch, no re-hook needed
    document.addEventListener('yt-navigate-finish', () => {
      if (audioReady) {
        reportCurrentVideo();
      }
    });

    // 5. Forward pitch commands from background → page script
    chrome.runtime.onMessage.addListener((msg: any) => {
      if (msg.action === 'APPLY_PITCH') {
        window.dispatchEvent(
          new CustomEvent('kara:set-pitch', {
            detail: { pitchFactor: msg.pitchFactor },
          }),
        );
      }
    });

    // Helper: extract videoId from URL and report to background
    function reportCurrentVideo() {
      const videoId = new URLSearchParams(location.search).get('v');
      if (!videoId) return;

      chrome.runtime.sendMessage({ action: 'VIDEO_LOADED', videoId }).then((resp: any) => {
        if (resp?.pitchFactor !== undefined) {
          window.dispatchEvent(
            new CustomEvent('kara:set-pitch', {
              detail: { pitchFactor: resp.pitchFactor },
            }),
          );
        }
      });
    }
  },
});
