// Extension state
export interface ExtensionState {
  isActive: boolean;
  activeTabId: number | null;
  currentVideoId: string | null;
  pitchSemitones: number;
  speed: number;
}

// Popup <-> Background messages
export type PopupMessage =
  | { action: 'GET_STATE' }
  | { action: 'SET_PITCH'; semitones: number }
  | { action: 'SET_SPEED'; speed: number };

// Content Script -> Background messages
export type ContentScriptMessage =
  | { action: 'VIDEO_LOADED'; videoId: string }
  | { action: 'AUDIO_CONNECTED' }
  | { action: 'AUDIO_ERROR'; message: string };

// Background -> Content Script messages
export type BackgroundToContentMessage =
  | { action: 'APPLY_PITCH'; pitchFactor: number };

// External (page -> extension) messages
export type ExternalMessage =
  | { type: 'PING' }
  | { type: 'SET_PITCH'; semitones: number }
  | { type: 'SET_SPEED'; speed: number }
  | { type: 'GET_STATE' }
  | { type: 'SET_VIDEO_ID'; videoId: string };

// Response types
export type StateResponse = { type: 'STATE'; state: ExtensionState };
export type PongResponse = { type: 'PONG' };
export type ErrorResponse = { type: 'ERROR'; message: string };
