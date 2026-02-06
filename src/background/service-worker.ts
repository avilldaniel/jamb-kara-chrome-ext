import type { InternalMessage, InternalStateResponse, OffscreenMessage } from '../shared/types'
import { PITCH_DEFAULT, SPEED_DEFAULT, STORAGE_PREFIX } from '../shared/constants'

interface TabState {
  pitch: number
  speed: number
  videoId: string | null
  capturing: boolean
}

const tabStates = new Map<number, TabState>()

// Track which tab is currently capturing (only one tab can capture at a time)
let capturingTabId: number | null = null

function getTabState(tabId: number): TabState {
  let s = tabStates.get(tabId)
  if (!s) {
    s = { pitch: PITCH_DEFAULT, speed: SPEED_DEFAULT, videoId: null, capturing: false }
    tabStates.set(tabId, s)
  }
  return s
}

// ---- Badge ----

function updateBadge(tabId: number, pitch: number) {
  const text = pitch === 0 ? '' : (pitch > 0 ? `+${pitch}` : `${pitch}`)
  const color = pitch === 0 ? '#666' : (pitch > 0 ? '#4caf50' : '#f44336')
  chrome.action.setBadgeText({ text, tabId }).catch(() => {})
  chrome.action.setBadgeBackgroundColor({ color, tabId }).catch(() => {})
}

// ---- Storage ----

async function saveVideoSettings(videoId: string, pitch: number, speed: number) {
  try {
    const key = STORAGE_PREFIX + videoId
    await chrome.storage.local.set({ [key]: { pitch, speed } })
  } catch {
    // Storage may be unavailable
  }
}

async function loadVideoSettings(videoId: string): Promise<{ pitch: number; speed: number } | null> {
  try {
    const key = STORAGE_PREFIX + videoId
    const result = await chrome.storage.local.get(key)
    return result[key] ?? null
  } catch {
    return null
  }
}

// ---- Offscreen document management ----

let offscreenCreated = false

async function ensureOffscreenDocument() {
  if (offscreenCreated) return

  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    })
    if (existingContexts.length > 0) {
      offscreenCreated = true
      return
    }

    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Audio processing for pitch shifting',
    })
    offscreenCreated = true
  } catch (err) {
    console.error('[Karaoke Pitch] Failed to create offscreen document:', err)
    throw err
  }
}

async function closeOffscreenDocument() {
  if (!offscreenCreated) return
  try {
    await chrome.offscreen.closeDocument()
  } catch {
    // May already be closed
  }
  offscreenCreated = false
}

function sendToOffscreen(msg: OffscreenMessage) {
  chrome.runtime.sendMessage(msg).catch(() => {})
}

// ---- Tab capture ----

async function startCapture(tabId: number) {
  const s = getTabState(tabId)
  if (s.capturing) return

  // Stop any existing capture from another tab
  if (capturingTabId !== null && capturingTabId !== tabId) {
    await stopCapture(capturingTabId)
  }

  try {
    await ensureOffscreenDocument()

    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve(id)
        }
      })
    })

    sendToOffscreen({
      target: 'offscreen',
      action: 'START',
      streamId,
    })

    // Apply current pitch/speed to the offscreen processor
    sendToOffscreen({ target: 'offscreen', action: 'SET_PITCH', value: s.pitch })
    sendToOffscreen({ target: 'offscreen', action: 'SET_SPEED', value: s.speed })

    s.capturing = true
    capturingTabId = tabId

    chrome.tabs.sendMessage(tabId, {
      action: 'STATE_UPDATE',
      capturing: true,
    }).catch(() => {})
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to capture tab audio'
    console.error('[Karaoke Pitch] Capture failed:', message)
    chrome.tabs.sendMessage(tabId, {
      action: 'ERROR',
      message: `Audio capture failed: ${message}`,
    }).catch(() => {})
  }
}

async function stopCapture(tabId: number) {
  const s = getTabState(tabId)
  if (!s.capturing) return

  sendToOffscreen({ target: 'offscreen', action: 'STOP' })
  s.capturing = false

  if (capturingTabId === tabId) {
    capturingTabId = null
  }

  chrome.tabs.sendMessage(tabId, {
    action: 'STATE_UPDATE',
    capturing: false,
  }).catch(() => {})
}

// Helper to update content script and offscreen with new pitch/speed after video change
function syncStateToTabAndOffscreen(tabId: number, s: TabState) {
  updateBadge(tabId, s.pitch)

  if (s.capturing) {
    sendToOffscreen({ target: 'offscreen', action: 'SET_PITCH', value: s.pitch })
    sendToOffscreen({ target: 'offscreen', action: 'SET_SPEED', value: s.speed })
  }

  chrome.tabs.sendMessage(tabId, {
    action: 'STATE_UPDATE',
    pitch: s.pitch,
    speed: s.speed,
  }).catch(() => {})
}

// ---- Message handling ----

chrome.runtime.onMessage.addListener((msg: InternalMessage & { target?: string }, sender, sendResponse) => {
  // Ignore messages targeted at offscreen
  if (msg.target === 'offscreen') return

  const tabId = sender.tab?.id ?? msg.tabId
  if (!tabId) return

  const s = getTabState(tabId)

  switch (msg.action) {
    case 'SET_PITCH': {
      s.pitch = msg.value
      updateBadge(tabId, msg.value)
      if (s.capturing) {
        sendToOffscreen({ target: 'offscreen', action: 'SET_PITCH', value: msg.value })
      }
      if (s.videoId) {
        saveVideoSettings(s.videoId, s.pitch, s.speed)
      }
      break
    }

    case 'SET_SPEED': {
      s.speed = msg.value
      if (s.capturing) {
        sendToOffscreen({ target: 'offscreen', action: 'SET_SPEED', value: msg.value })
      }
      if (s.videoId) {
        saveVideoSettings(s.videoId, s.pitch, s.speed)
      }
      break
    }

    case 'GET_STATE': {
      const response: InternalStateResponse = {
        pitch: s.pitch,
        speed: s.speed,
        videoId: s.videoId,
        capturing: s.capturing,
      }
      sendResponse(response)
      return true
    }

    case 'START_CAPTURE':
      startCapture(tabId)
      break

    case 'STOP_CAPTURE':
      stopCapture(tabId)
      break

    case 'VIDEO_CHANGED': {
      const oldVideoId = s.videoId
      s.videoId = msg.videoId

      // Save settings for old video
      if (oldVideoId && (s.pitch !== PITCH_DEFAULT || s.speed !== SPEED_DEFAULT)) {
        saveVideoSettings(oldVideoId, s.pitch, s.speed)
      }

      // Load settings for new video
      if (msg.videoId) {
        loadVideoSettings(msg.videoId).then((saved) => {
          if (saved) {
            s.pitch = saved.pitch
            s.speed = saved.speed
          } else {
            s.pitch = PITCH_DEFAULT
            s.speed = SPEED_DEFAULT
          }
          syncStateToTabAndOffscreen(tabId, s)
        })
      } else {
        // No video — reset
        s.pitch = PITCH_DEFAULT
        s.speed = SPEED_DEFAULT
        syncStateToTabAndOffscreen(tabId, s)
      }
      break
    }
  }
})

// Clean up when tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  const s = tabStates.get(tabId)
  if (s?.capturing) {
    sendToOffscreen({ target: 'offscreen', action: 'STOP' })
    closeOffscreenDocument()
    if (capturingTabId === tabId) {
      capturingTabId = null
    }
  }
  tabStates.delete(tabId)
})

// Handle tab navigation — stop capture if user navigates away
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    const s = tabStates.get(tabId)
    if (s?.capturing) {
      stopCapture(tabId)
    }
  }
})

console.log('[Karaoke Pitch] Service worker started')
