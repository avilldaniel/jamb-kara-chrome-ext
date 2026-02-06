import type { PageMessage, ExtensionMessage, InternalStateResponse } from '../shared/types'
import {
  EXTENSION_VERSION,
  PITCH_MIN,
  PITCH_MAX,
  PITCH_DEFAULT,
  SPEED_DEFAULT,
  SPEED_MIN,
  SPEED_MAX,
} from '../shared/constants'

interface LocalState {
  pitch: number
  speed: number
  videoId: string | null
  capturing: boolean
}

const state: LocalState = {
  pitch: PITCH_DEFAULT,
  speed: SPEED_DEFAULT,
  videoId: null,
  capturing: false,
}

function postToPage(msg: ExtensionMessage) {
  window.postMessage(msg, '*')
}

function sendStateToPage() {
  postToPage({
    type: 'STATE',
    pitch: state.pitch,
    speed: state.speed,
    videoId: state.videoId,
    capturing: state.capturing,
  })
}

function notifyBackground(action: string, payload: Record<string, unknown> = {}) {
  try {
    chrome.runtime.sendMessage({ action, ...payload }).catch(() => {
      // Service worker may not be ready yet
    })
  } catch {
    // Extension context may be invalidated (e.g. after extension reload)
  }
}

function handlePageMessage(msg: PageMessage) {
  switch (msg.type) {
    case 'PING':
      postToPage({ type: 'PONG', version: EXTENSION_VERSION })
      break

    case 'SET_PITCH': {
      const value = Math.round(Math.max(PITCH_MIN, Math.min(PITCH_MAX, msg.value)))
      state.pitch = value
      notifyBackground('SET_PITCH', { value })
      sendStateToPage()

      if (value !== 0 && !state.capturing) {
        notifyBackground('START_CAPTURE')
      }
      break
    }

    case 'SET_SPEED': {
      const value = Math.max(SPEED_MIN, Math.min(SPEED_MAX, msg.value))
      state.speed = value
      notifyBackground('SET_SPEED', { value })
      sendStateToPage()

      if (value !== 1 && !state.capturing) {
        notifyBackground('START_CAPTURE')
      }
      break
    }

    case 'GET_STATE':
      sendStateToPage()
      break

    case 'SET_VIDEO_ID': {
      const oldVideoId = state.videoId
      state.videoId = msg.videoId
      notifyBackground('VIDEO_CHANGED', { videoId: msg.videoId })

      if (oldVideoId !== msg.videoId) {
        try {
          chrome.runtime.sendMessage({ action: 'GET_STATE' }).then((resp: InternalStateResponse | undefined) => {
            if (resp) {
              state.pitch = resp.pitch
              state.speed = resp.speed
              state.capturing = resp.capturing
              sendStateToPage()
            }
          }).catch(() => {})
        } catch {
          // Extension context invalidated
        }
      }
      break
    }
  }
}

function isPageMessage(data: unknown): data is PageMessage {
  if (typeof data !== 'object' || data === null) return false
  const msg = data as Record<string, unknown>
  return (
    msg.type === 'PING' ||
    msg.type === 'SET_PITCH' ||
    msg.type === 'SET_SPEED' ||
    msg.type === 'GET_STATE' ||
    msg.type === 'SET_VIDEO_ID'
  )
}

// Listen for messages from the page
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (!isPageMessage(event.data)) return
  handlePageMessage(event.data)
})

// Listen for messages from the background service worker / popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'GET_STATE') {
    sendResponse({
      pitch: state.pitch,
      speed: state.speed,
      videoId: state.videoId,
      capturing: state.capturing,
    })
    return true
  }

  if (msg.action === 'STATE_UPDATE') {
    if (typeof msg.pitch === 'number') state.pitch = msg.pitch
    if (typeof msg.speed === 'number') state.speed = msg.speed
    if (typeof msg.capturing === 'boolean') state.capturing = msg.capturing
    sendStateToPage()
  }

  if (msg.action === 'ERROR') {
    postToPage({ type: 'ERROR', message: msg.message })
  }

  if (msg.action === 'SET_PITCH_FROM_POPUP') {
    const value = Math.round(Math.max(PITCH_MIN, Math.min(PITCH_MAX, msg.value)))
    state.pitch = value
    sendStateToPage()
    if (value !== 0 && !state.capturing) {
      notifyBackground('START_CAPTURE')
    }
  }

  if (msg.action === 'SET_SPEED_FROM_POPUP') {
    const value = Math.max(SPEED_MIN, Math.min(SPEED_MAX, msg.value))
    state.speed = value
    sendStateToPage()
    if (value !== 1 && !state.capturing) {
      notifyBackground('START_CAPTURE')
    }
  }
})

// Inject CSS to hide YouTube's native playback speed controls inside iframes
// This prevents users from accidentally desyncing speed via YouTube's built-in UI
function injectYouTubeSpeedHiderCSS() {
  const style = document.createElement('style')
  style.textContent = `
    /* Hide YouTube speed option in settings menu when embedded */
    iframe[src*="youtube.com"] ~ .ytp-settings-menu .ytp-menuitem[data-title="Playback speed"],
    iframe[src*="youtube.com"] ~ .ytp-settings-menu .ytp-panel-menu .ytp-menuitem:has(.ytp-menuitem-label:contains("Speed")) {
      display: none !important;
    }
  `
  document.head.appendChild(style)
}

injectYouTubeSpeedHiderCSS()

// Clean up when the page unloads
window.addEventListener('beforeunload', () => {
  if (state.capturing) {
    notifyBackground('STOP_CAPTURE')
  }
})

console.log('[Karaoke Pitch] Extension loaded v' + EXTENSION_VERSION)
