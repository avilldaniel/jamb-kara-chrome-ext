import type { ExtensionState } from './types';

export const DEFAULT_STATE: ExtensionState = {
  isCapturing: false,
  capturingTabId: null,
  currentVideoId: null,
  pitchSemitones: 0,
  speed: 1,
};

export const SEMITONES_MIN = -12;
export const SEMITONES_MAX = 12;

export function semitonesToFactor(semitones: number): number {
  return Math.pow(2, semitones / 12);
}
