import type { OffscreenMessage } from '../../utils/types';

let audioCtx: AudioContext | null = null;
let workletNode: AudioWorkletNode | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let lowShelf: BiquadFilterNode | null = null;
let midPeak: BiquadFilterNode | null = null;
let highShelf: BiquadFilterNode | null = null;

async function startAudio(streamId: string) {
  // Get tab audio stream
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    } as any,
    video: false,
  });

  audioCtx = new AudioContext();

  // Load worklet
  await audioCtx.audioWorklet.addModule(chrome.runtime.getURL('pitch-processor.js'));
  workletNode = new AudioWorkletNode(audioCtx, 'pitch-processor', {
    outputChannelCount: [2],
  });

  // Load and init WASM
  const wasmResp = await fetch(chrome.runtime.getURL('wasm/pitch_poc_bg.wasm'));
  const wasmBytes = await wasmResp.arrayBuffer();

  await new Promise<void>((resolve, reject) => {
    workletNode!.port.onmessage = (e) => {
      if (e.data.type === 'wasm-ready') resolve();
      if (e.data.type === 'wasm-error') reject(new Error(e.data.error));
    };
    workletNode!.port.postMessage({ type: 'init-wasm', wasmBytes }, [wasmBytes]);
  });

  // EQ compensation for phase vocoder coloration
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

  // Connect: stream → worklet → EQ → destination
  sourceNode = audioCtx.createMediaStreamSource(stream);
  sourceNode
    .connect(workletNode)
    .connect(lowShelf)
    .connect(midPeak)
    .connect(highShelf)
    .connect(audioCtx.destination);
}

function stopAudio() {
  sourceNode?.disconnect();
  workletNode?.disconnect();
  lowShelf?.disconnect();
  midPeak?.disconnect();
  highShelf?.disconnect();
  audioCtx?.close();

  sourceNode = null;
  workletNode = null;
  lowShelf = null;
  midPeak = null;
  highShelf = null;
  audioCtx = null;
}

function setPitch(pitchFactor: number) {
  workletNode?.port.postMessage({ type: 'set-pitch', value: pitchFactor });
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  switch (message.type) {
    case 'START':
      startAudio(message.streamId)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // async response

    case 'STOP':
      stopAudio();
      sendResponse({ success: true });
      break;

    case 'SET_PITCH':
      setPitch(message.pitchFactor);
      sendResponse({ success: true });
      break;
  }
});
