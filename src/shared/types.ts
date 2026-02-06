// ---- Page → Extension messages ----

export interface PingMessage {
  type: 'PING'
}

export interface SetPitchMessage {
  type: 'SET_PITCH'
  value: number
}

export interface SetSpeedMessage {
  type: 'SET_SPEED'
  value: number
}

export interface GetStateMessage {
  type: 'GET_STATE'
}

export interface SetVideoIdMessage {
  type: 'SET_VIDEO_ID'
  videoId: string | null
}

export type PageMessage =
  | PingMessage
  | SetPitchMessage
  | SetSpeedMessage
  | GetStateMessage
  | SetVideoIdMessage

// ---- Extension → Page messages ----

export interface PongMessage {
  type: 'PONG'
  version: string
}

export interface StateMessage {
  type: 'STATE'
  pitch: number
  speed: number
  videoId: string | null
  capturing: boolean
}

export interface ErrorMessage {
  type: 'ERROR'
  message: string
}

export type ExtensionMessage = PongMessage | StateMessage | ErrorMessage

// ---- Content ↔ Background internal messages ----

export interface InternalSetPitch {
  action: 'SET_PITCH'
  value: number
  tabId?: number
}

export interface InternalSetSpeed {
  action: 'SET_SPEED'
  value: number
  tabId?: number
}

export interface InternalGetState {
  action: 'GET_STATE'
  tabId?: number
}

export interface InternalStartCapture {
  action: 'START_CAPTURE'
  tabId?: number
}

export interface InternalStopCapture {
  action: 'STOP_CAPTURE'
  tabId?: number
}

export interface InternalVideoChanged {
  action: 'VIDEO_CHANGED'
  videoId: string | null
  tabId?: number
}

export interface InternalStateResponse {
  pitch: number
  speed: number
  videoId: string | null
  capturing: boolean
}

export type InternalMessage =
  | InternalSetPitch
  | InternalSetSpeed
  | InternalGetState
  | InternalStartCapture
  | InternalStopCapture
  | InternalVideoChanged

// ---- Background ↔ Offscreen messages ----

export interface OffscreenStartMessage {
  target: 'offscreen'
  action: 'START'
  streamId: string
}

export interface OffscreenStopMessage {
  target: 'offscreen'
  action: 'STOP'
}

export interface OffscreenSetPitchMessage {
  target: 'offscreen'
  action: 'SET_PITCH'
  value: number
}

export interface OffscreenSetSpeedMessage {
  target: 'offscreen'
  action: 'SET_SPEED'
  value: number
}

export type OffscreenMessage =
  | OffscreenStartMessage
  | OffscreenStopMessage
  | OffscreenSetPitchMessage
  | OffscreenSetSpeedMessage
