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
 */
(function () {
  'use strict';

  let audioCtx = null;
  let workletNode = null;
  let sourceNode = null;
  let lowShelf = null;
  let midPeak = null;
  let highShelf = null;
  let initialized = false;
  let hookPending = false;

  let workletUrl = null;
  let wasmUrl = null;

  // -------------------------------------------------------------------------
  // Initialization — receive URLs from content script
  // -------------------------------------------------------------------------

  window.addEventListener('kara:init', function (e) {
    workletUrl = e.detail.workletUrl;
    wasmUrl = e.detail.wasmUrl;
    hookVideo();
  });

  // -------------------------------------------------------------------------
  // SPA navigation — re-hook on new video
  // -------------------------------------------------------------------------

  document.addEventListener('yt-navigate-finish', function () {
    // Only teardown + re-hook if we have URLs (init was called)
    if (!workletUrl) return;
    teardown();
    hookVideo();
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
  // Core: hook the video element's audio
  // -------------------------------------------------------------------------

  async function hookVideo() {
    if (initialized || hookPending) return;
    hookPending = true;

    try {
      var video = await waitForVideo();
      if (!video) {
        dispatchError('Video element not found within timeout');
        hookPending = false;
        return;
      }

      // Create AudioContext (may need user gesture to resume)
      audioCtx = new AudioContext();

      // Load worklet module
      await audioCtx.audioWorklet.addModule(workletUrl);
      workletNode = new AudioWorkletNode(audioCtx, 'pitch-processor');

      // Fetch and init WASM in the worklet
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

      // EQ coloration compensation (matches offscreen/main.ts values)
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

      // Connect: video → worklet → EQ → speakers
      sourceNode = audioCtx.createMediaElementSource(video);
      sourceNode.connect(workletNode);
      workletNode.connect(lowShelf);
      lowShelf.connect(midPeak);
      midPeak.connect(highShelf);
      highShelf.connect(audioCtx.destination);

      initialized = true;
      hookPending = false;

      window.dispatchEvent(new CustomEvent('kara:audio-connected'));
    } catch (err) {
      hookPending = false;
      dispatchError(err.message || 'Unknown audio error');
    }
  }

  // -------------------------------------------------------------------------
  // Teardown — disconnect all nodes, close context
  // -------------------------------------------------------------------------

  function teardown() {
    try {
      if (sourceNode) sourceNode.disconnect();
      if (workletNode) workletNode.disconnect();
      if (lowShelf) lowShelf.disconnect();
      if (midPeak) midPeak.disconnect();
      if (highShelf) highShelf.disconnect();
      if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();
    } catch (_) {
      // Nodes may already be disconnected
    }
    audioCtx = null;
    workletNode = null;
    sourceNode = null;
    lowShelf = null;
    midPeak = null;
    highShelf = null;
    initialized = false;
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
