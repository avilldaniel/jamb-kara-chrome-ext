/**
 * youtube-audio-hook.js
 *
 * Injected into YouTube page context by the content script.
 * Hooks the <video> element's audio via createMediaElementSource,
 * routes it through the pitch-shifting AudioWorklet + EQ chain.
 *
 * Communication with the content script is via CustomEvent on window.
 *
 * IMPORTANT: This script runs in the PAGE's main world, not the extension's
 * isolated world. It has no access to chrome.* APIs.
 *
 * KEY DESIGN DECISION: YouTube reuses the same <video> element across SPA
 * navigations. We hook the video element ONCE and keep the pipeline alive.
 * The content script handles navigation by updating pitch via kara:set-pitch.
 * We do NOT teardown/re-hook on yt-navigate-finish — that causes race conditions.
 */
(function () {
  'use strict';

  var audioCtx = null;
  var workletNode = null;
  var sourceNode = null;
  var lowShelf = null;
  var midPeak = null;
  var highShelf = null;
  var initialized = false;
  var hookPending = false;

  // -------------------------------------------------------------------------
  // Initialization — receive URLs from content script
  // -------------------------------------------------------------------------

  window.addEventListener('kara:init', function (e) {
    hookVideo(e.detail.workletUrl, e.detail.wasmUrl);
  });

  // -------------------------------------------------------------------------
  // Pitch control — receive from content script
  // -------------------------------------------------------------------------

  window.addEventListener('kara:set-pitch', function (e) {
    if (workletNode) {
      workletNode.port.postMessage({ type: 'set-pitch', value: e.detail.pitchFactor });
    }
  });

  // -------------------------------------------------------------------------
  // Core: hook the video element's audio (called ONCE per page lifecycle)
  // -------------------------------------------------------------------------

  async function hookVideo(workletUrl, wasmUrl) {
    if (initialized || hookPending) return;
    hookPending = true;

    try {
      var video = await waitForVideo();
      if (!video) {
        dispatchError('Video element not found within timeout');
        hookPending = false;
        return;
      }

      // 1. Create AudioContext and ensure it's running
      audioCtx = new AudioContext();
      if (audioCtx.state === 'suspended') {
        // Try to resume immediately; if blocked by autoplay policy,
        // we'll resume on first user interaction
        audioCtx.resume().catch(function () {});
        document.addEventListener('click', function resumeOnClick() {
          if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
          }
          document.removeEventListener('click', resumeOnClick);
        }, { once: true });
      }

      // 2. Load worklet module
      await audioCtx.audioWorklet.addModule(workletUrl);
      workletNode = new AudioWorkletNode(audioCtx, 'pitch-processor');

      // 3. Fetch and init WASM in the worklet
      var resp = await fetch(wasmUrl);
      var wasmBytes = await resp.arrayBuffer();
      await new Promise(function (resolve, reject) {
        var timeout = setTimeout(function () {
          reject(new Error('WASM init timeout'));
        }, 10000);

        workletNode.port.onmessage = function (e) {
          if (e.data.type === 'wasm-ready') {
            clearTimeout(timeout);
            resolve();
          }
        };
        workletNode.port.postMessage({ type: 'init-wasm', wasmBytes: wasmBytes }, [wasmBytes]);
      });

      // 4. Set up EQ coloration compensation
      lowShelf = audioCtx.createBiquadFilter();
      lowShelf.type = 'lowshelf';
      lowShelf.frequency.value = 200;
      lowShelf.gain.value = 2;

      midPeak = audioCtx.createBiquadFilter();
      midPeak.type = 'peaking';
      midPeak.frequency.value = 1000;
      midPeak.Q.value = 1.0;
      midPeak.gain.value = 3;

      highShelf = audioCtx.createBiquadFilter();
      highShelf.type = 'highshelf';
      highShelf.frequency.value = 4000;
      highShelf.gain.value = 3;

      // 5. Wire up the downstream chain FIRST (worklet → EQ → speakers)
      workletNode.connect(lowShelf);
      lowShelf.connect(midPeak);
      midPeak.connect(highShelf);
      highShelf.connect(audioCtx.destination);

      // 6. Connect video source LAST — this is the moment audio gets redirected
      //    through our pipeline. By connecting last, we ensure the full chain
      //    is ready so there's no silence gap.
      sourceNode = audioCtx.createMediaElementSource(video);
      sourceNode.connect(workletNode);

      initialized = true;
      hookPending = false;

      window.dispatchEvent(new CustomEvent('kara:audio-connected'));
    } catch (err) {
      hookPending = false;
      dispatchError(err.message || 'Unknown audio error');
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function waitForVideo() {
    return new Promise(function (resolve) {
      var el = document.querySelector('video');
      if (el) return resolve(el);

      var observer = new MutationObserver(function () {
        var v = document.querySelector('video');
        if (v) {
          observer.disconnect();
          resolve(v);
        }
      });
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });

      // Timeout after 10 seconds
      setTimeout(function () {
        observer.disconnect();
        resolve(null);
      }, 10000);
    });
  }

  function dispatchError(message) {
    window.dispatchEvent(
      new CustomEvent('kara:error', { detail: { message: message } }),
    );
  }
})();
