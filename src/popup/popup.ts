import { SPEED_PRESETS, PITCH_MIN, PITCH_MAX } from '../shared/constants'

const statusEl = document.getElementById('status')!
const controlsEl = document.getElementById('controls')!
const pitchSlider = document.getElementById('pitch-slider') as HTMLInputElement
const pitchValue = document.getElementById('pitch-value')!
const pitchDown = document.getElementById('pitch-down')!
const pitchUp = document.getElementById('pitch-up')!
const speedButtons = document.getElementById('speed-buttons')!
const videoInfo = document.getElementById('video-info')!

let currentTabId: number | null = null
let state = { pitch: 0, speed: 1, videoId: null as string | null, capturing: false }

// ---- Speed button rendering ----

function renderSpeedButtons() {
  speedButtons.innerHTML = ''
  for (const speed of SPEED_PRESETS) {
    const btn = document.createElement('button')
    btn.className = `speed-btn${speed === state.speed ? ' active' : ''}`
    btn.textContent = `${speed}x`
    btn.addEventListener('click', () => setSpeed(speed))
    speedButtons.appendChild(btn)
  }
}

// ---- UI update ----

function updateUI() {
  pitchSlider.value = String(state.pitch)
  const sign = state.pitch > 0 ? '+' : ''
  pitchValue.textContent = `${sign}${state.pitch} st`
  renderSpeedButtons()
  videoInfo.textContent = state.videoId ? `Video: ${state.videoId}` : ''
}

function setConnected(connected: boolean) {
  statusEl.textContent = connected ? 'Connected' : 'Not on karaoke page'
  statusEl.className = `status ${connected ? 'connected' : 'disconnected'}`
  controlsEl.classList.toggle('disabled', !connected)
}

// ---- Send commands to content script via background ----

async function sendToContentScript(action: string, payload: Record<string, unknown> = {}) {
  if (!currentTabId) return
  try {
    await chrome.tabs.sendMessage(currentTabId, { action, ...payload })
  } catch {
    // Content script not available
  }
}

function setPitch(value: number) {
  const clamped = Math.round(Math.max(PITCH_MIN, Math.min(PITCH_MAX, value)))
  state.pitch = clamped
  updateUI()
  sendToContentScript('SET_PITCH_FROM_POPUP', { value: clamped })

  // Also send directly to background so badge + offscreen update
  chrome.runtime.sendMessage({ action: 'SET_PITCH', value: clamped, tabId: currentTabId })
}

function setSpeed(value: number) {
  state.speed = value
  updateUI()
  sendToContentScript('SET_SPEED_FROM_POPUP', { value })
  chrome.runtime.sendMessage({ action: 'SET_SPEED', value, tabId: currentTabId })
}

// ---- Event listeners ----

pitchSlider.addEventListener('input', () => {
  setPitch(parseInt(pitchSlider.value, 10))
})

pitchDown.addEventListener('click', () => {
  setPitch(state.pitch - 1)
})

pitchUp.addEventListener('click', () => {
  setPitch(state.pitch + 1)
})

// ---- Initialize ----

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) {
    setConnected(false)
    return
  }

  currentTabId = tab.id

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_STATE' })
    if (response) {
      state = { ...state, ...response }
      setConnected(true)
      updateUI()
    } else {
      setConnected(false)
    }
  } catch {
    setConnected(false)
  }
}

init()
