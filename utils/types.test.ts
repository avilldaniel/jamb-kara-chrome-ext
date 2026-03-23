import { describe, it, expect } from 'vitest';
import type {
  ExtensionState,
  ContentScriptMessage,
  BackgroundToContentMessage,
  PopupMessage,
} from './types';
import { semitonesToFactor } from './constants';

describe('Extension Message Types', () => {
  /**
   * Tracer Bullet: Verify that content script can send VIDEO_LOADED message
   * and background can respond with pitch factor.
   *
   * This simulates the core message flow:
   * Content Script → Background → Content Script
   */
  it('should allow content script to report video load and receive pitch', () => {
    // Content script sends VIDEO_LOADED
    const csMessage: ContentScriptMessage = {
      action: 'VIDEO_LOADED',
      videoId: 'dQw4w9WgXcQ',
    };

    expect(csMessage.action).toBe('VIDEO_LOADED');
    expect(csMessage.videoId).toBe('dQw4w9WgXcQ');

    // Background responds with pitch to apply
    const bgMessage: BackgroundToContentMessage = {
      action: 'APPLY_PITCH',
      pitchFactor: semitonesToFactor(5), // 5 semitones up
    };

    expect(bgMessage.action).toBe('APPLY_PITCH');
    expect(bgMessage.pitchFactor).toBeCloseTo(1.3348, 4);
  });

  /**
   * Verify that content script can report audio connection success
   */
  it('should allow content script to report audio connected', () => {
    const csMessage: ContentScriptMessage = {
      action: 'AUDIO_CONNECTED',
    };

    expect(csMessage.action).toBe('AUDIO_CONNECTED');
    expect('videoId' in csMessage).toBe(false); // AUDIO_CONNECTED has no videoId
  });

  /**
   * Verify that content script can report audio errors
   */
  it('should allow content script to report audio errors', () => {
    const csMessage: ContentScriptMessage = {
      action: 'AUDIO_ERROR',
      message: 'Failed to initialize AudioContext',
    };

    expect(csMessage.action).toBe('AUDIO_ERROR');
    expect(csMessage.message).toBeDefined();
  });

  /**
   * Verify that popup can send SET_PITCH and background receives it correctly
   */
  it('should allow popup to send pitch change to background', () => {
    const popupMessage: PopupMessage = {
      action: 'SET_PITCH',
      semitones: -3,
    };

    expect(popupMessage.action).toBe('SET_PITCH');
    expect(popupMessage.semitones).toBe(-3);

    // Simulate background processing
    const pitchFactor = semitonesToFactor(-3);
    expect(pitchFactor).toBeCloseTo(0.8409, 3);
  });

  /**
   * Verify that popup can request state from background
   */
  it('should allow popup to request extension state', () => {
    const popupMessage: PopupMessage = {
      action: 'GET_STATE',
    };

    expect(popupMessage.action).toBe('GET_STATE');
  });

  /**
   * Verify that ExtensionState uses new shape: isActive, activeTabId
   * (NOT isCapturing, capturingTabId)
   */
  it('should have ExtensionState with isActive and activeTabId', () => {
    const state: ExtensionState = {
      isActive: true,
      activeTabId: 42,
      currentVideoId: 'dQw4w9WgXcQ',
      pitchSemitones: 5,
      speed: 1,
    };

    expect(state.isActive).toBe(true);
    expect(state.activeTabId).toBe(42);
    expect(state.currentVideoId).toBe('dQw4w9WgXcQ');
    expect(state.pitchSemitones).toBe(5);
    expect(state.speed).toBe(1);

    // Verify old names don't exist (TypeScript would catch this, but being explicit)
    expect('isCapturing' in state).toBe(false);
    expect('capturingTabId' in state).toBe(false);
  });

  /**
   * Verify that when no video is loaded, state reflects that
   */
  it('should allow inactive state when no video is loaded', () => {
    const state: ExtensionState = {
      isActive: false,
      activeTabId: null,
      currentVideoId: null,
      pitchSemitones: 0,
      speed: 1,
    };

    expect(state.isActive).toBe(false);
    expect(state.activeTabId).toBeNull();
    expect(state.currentVideoId).toBeNull();
  });
});
