use std::cell::RefCell;
use std::collections::VecDeque;
use std::f32::consts::PI;

use rustfft::num_complex::Complex;
use rustfft::{FftPlanner, Fft};
use wasm_bindgen::prelude::*;

const FFT_SIZE: usize = 2048;
const HOP_SIZE: usize = 512; // 4x overlap
const HALF: usize = FFT_SIZE / 2 + 1;

struct PhaseVocoder {
    pitch_factor: f32,

    input_buf: Vec<f32>,
    output_queue: VecDeque<f32>,

    fft_forward: std::sync::Arc<dyn Fft<f32>>,
    fft_inverse: std::sync::Arc<dyn Fft<f32>>,
    scratch: Vec<Complex<f32>>,

    analysis_phase: Vec<f32>,
    synthesis_phase: Vec<f32>,

    window: Vec<f32>,
}

impl PhaseVocoder {
    fn new() -> Self {
        let mut planner = FftPlanner::new();
        let fwd = planner.plan_fft_forward(FFT_SIZE);
        let inv = planner.plan_fft_inverse(FFT_SIZE);
        let scratch_len = fwd
            .get_inplace_scratch_len()
            .max(inv.get_inplace_scratch_len());

        let window: Vec<f32> = (0..FFT_SIZE)
            .map(|i| 0.5 * (1.0 - (2.0 * PI * i as f32 / FFT_SIZE as f32).cos()))
            .collect();

        Self {
            pitch_factor: 1.0,
            input_buf: Vec::new(),
            output_queue: VecDeque::new(),
            fft_forward: fwd,
            fft_inverse: inv,
            scratch: vec![Complex::new(0.0, 0.0); scratch_len],
            analysis_phase: vec![0.0; HALF],
            synthesis_phase: vec![0.0; HALF],
            window,
        }
    }

    fn set_pitch_factor(&mut self, f: f32) {
        self.pitch_factor = f;
    }

    fn flush(&mut self) {
        self.input_buf.clear();
        self.output_queue.clear();
        self.analysis_phase.fill(0.0);
        self.synthesis_phase.fill(0.0);
    }

    fn process(&mut self, input: &[f32]) -> Vec<f32> {
        self.input_buf.extend_from_slice(input);

        while self.input_buf.len() >= FFT_SIZE {
            self.process_frame();
            self.input_buf.drain(..HOP_SIZE);
        }

        let mut output = Vec::with_capacity(input.len());
        for _ in 0..input.len() {
            output.push(self.output_queue.pop_front().unwrap_or(0.0));
        }
        output
    }

    fn process_frame(&mut self) {
        let expected = 2.0 * PI * HOP_SIZE as f32 / FFT_SIZE as f32;

        // Window + forward FFT
        let mut spectrum: Vec<Complex<f32>> = self.input_buf[..FFT_SIZE]
            .iter()
            .zip(self.window.iter())
            .map(|(&s, &w)| Complex::new(s * w, 0.0))
            .collect();

        self.fft_forward
            .process_with_scratch(&mut spectrum, &mut self.scratch);

        // Analysis: magnitude + instantaneous frequency per bin
        let mut mag = vec![0.0f32; HALF];
        let mut freq = vec![0.0f32; HALF];

        for k in 0..HALF {
            mag[k] = spectrum[k].norm();
            let phase = spectrum[k].arg();

            let mut dp = phase - self.analysis_phase[k];
            self.analysis_phase[k] = phase;

            // Remove expected phase advance, wrap to [-PI, PI]
            dp -= k as f32 * expected;
            dp -= (dp / (2.0 * PI)).round() * 2.0 * PI;

            // Instantaneous frequency as bin offset
            freq[k] = k as f32 + dp / expected;
        }

        // Pitch shift: move bins
        let mut new_mag = vec![0.0f32; HALF];
        let mut new_freq = vec![0.0f32; HALF];

        for k in 0..HALF {
            let target = (k as f32 * self.pitch_factor).round() as usize;
            if target < HALF {
                new_mag[target] += mag[k];
                new_freq[target] = freq[k] * self.pitch_factor;
            }
        }

        // Synthesis: reconstruct phases and spectrum
        for k in 0..HALF {
            self.synthesis_phase[k] += new_freq[k] * expected;

            spectrum[k] = Complex::from_polar(new_mag[k], self.synthesis_phase[k]);

            // Mirror for negative frequencies
            if k > 0 && k < FFT_SIZE / 2 {
                spectrum[FFT_SIZE - k] = spectrum[k].conj();
            }
        }

        // Inverse FFT
        self.fft_inverse
            .process_with_scratch(&mut spectrum, &mut self.scratch);

        // Window, scale, overlap-add
        // rustfft doesn't normalize IFFT (output is N× actual)
        // Hann² with 4× overlap sums to 1.5 at every sample
        let scale = 1.0 / (FFT_SIZE as f32 * 1.5);

        for i in 0..FFT_SIZE {
            let val = spectrum[i].re * self.window[i] * scale;
            if i < self.output_queue.len() {
                self.output_queue[i] += val;
            } else {
                self.output_queue.push_back(val);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// WASM exports — global singleton (WASM is single-threaded)
// ---------------------------------------------------------------------------

thread_local! {
    static VOCODERS: RefCell<Vec<PhaseVocoder>> = const { RefCell::new(Vec::new()) };
}

#[wasm_bindgen]
pub fn init(num_channels: u32) {
    VOCODERS.with(|v| {
        let mut vocoders = v.borrow_mut();
        vocoders.clear();
        for _ in 0..num_channels {
            vocoders.push(PhaseVocoder::new());
        }
    });
}

#[wasm_bindgen]
pub fn set_pitch_factor(f: f32) {
    VOCODERS.with(|v| {
        for vocoder in v.borrow_mut().iter_mut() {
            vocoder.set_pitch_factor(f);
        }
    });
}

#[wasm_bindgen]
pub fn flush() {
    VOCODERS.with(|v| {
        for vocoder in v.borrow_mut().iter_mut() {
            vocoder.flush();
        }
    });
}

#[wasm_bindgen]
pub fn process(channel: u32, input: &[f32]) -> Vec<f32> {
    VOCODERS.with(|v| {
        v.borrow_mut()[channel as usize].process(input)
    })
}

// ---------------------------------------------------------------------------
// Raw memory helpers — let the worklet write/read WASM linear memory directly
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub fn alloc_f32(len: usize) -> *mut f32 {
    let mut buf = vec![0.0f32; len];
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[wasm_bindgen]
pub fn dealloc_f32(ptr: *mut f32, len: usize) {
    unsafe {
        drop(Vec::from_raw_parts(ptr, len, len));
    }
}
