"use strict";

let wasm = null;
let f32View = null;
let WASM_VECTOR_LEN = 0;

function refreshMemoryView() {
  if (!wasm) return;
  f32View = new Float32Array(wasm.memory.buffer);
}

function passToWasm(input) {
  const len = input.length;
  const ptr = wasm.__wbindgen_malloc(len * 4, 4) >>> 0;
  refreshMemoryView();
  f32View.set(input, ptr / 4);
  WASM_VECTOR_LEN = len;
  return ptr;
}

function callProcess(channel, input) {
  const ptr = passToWasm(input);
  const ret = wasm.process(channel, ptr, WASM_VECTOR_LEN);
  refreshMemoryView();
  const outPtr = ret[0] >>> 0;
  const outLen = ret[1];
  const result = f32View.slice(outPtr / 4, outPtr / 4 + outLen);
  wasm.__wbindgen_free(outPtr, outLen * 4, 4);
  return result;
}

// Perf measurement
let perfBlockCount = 0;
let perfTotalMs = 0;
let perfMaxMs = 0;
const PERF_REPORT_INTERVAL = 344; // ~1 second at 128 samples / 44.1kHz

class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (e) => {
      if (e.data.type === "init-wasm") {
        const imports = {
          "./pitch_poc_bg.js": {
            __wbindgen_init_externref_table() {
              const table = wasm.__wbindgen_externrefs;
              const offset = table.grow(4);
              table.set(0, undefined);
              table.set(offset + 0, undefined);
              table.set(offset + 1, null);
              table.set(offset + 2, true);
              table.set(offset + 3, false);
            },
          },
        };

        WebAssembly.instantiate(e.data.wasmBytes, imports)
          .then((result) => {
            wasm = result.instance.exports;
            wasm.__wbindgen_start();
            wasm.init(2); // stereo
            refreshMemoryView();
            this.port.postMessage({ type: "wasm-ready" });
          })
          .catch((err) => {
            this.port.postMessage({ type: "wasm-error", error: err.message });
          });
      }

      if (e.data.type === "set-pitch") {
        if (wasm) wasm.set_pitch_factor(e.data.value);
      }

      if (e.data.type === "flush") {
        if (wasm) wasm.flush();
      }
    };
  }

  process(inputs, outputs) {
    const inputChannels = inputs[0];
    const outputChannels = outputs[0];
    if (!inputChannels?.length || !outputChannels?.length) return true;

    const t0 = Date.now();

    for (let ch = 0; ch < outputChannels.length; ch++) {
      const input = inputChannels[ch] || inputChannels[0];
      const output = outputChannels[ch];

      if (wasm) {
        const processed = callProcess(ch, input);
        output.set(processed);
      } else {
        output.set(input);
      }
    }

    const elapsed = Date.now() - t0;
    perfBlockCount++;
    perfTotalMs += elapsed;
    if (elapsed > perfMaxMs) perfMaxMs = elapsed;

    if (perfBlockCount >= PERF_REPORT_INTERVAL) {
      this.port.postMessage({
        type: "perf",
        avgMs: (perfTotalMs / perfBlockCount).toFixed(3),
        maxMs: perfMaxMs.toFixed(3),
        blocks: perfBlockCount,
        budgetMs: "2.9",
      });
      perfBlockCount = 0;
      perfTotalMs = 0;
      perfMaxMs = 0;
    }

    return true;
  }
}

registerProcessor("pitch-processor", PitchProcessor);
