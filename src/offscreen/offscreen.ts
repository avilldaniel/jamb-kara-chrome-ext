import { SoundTouch, SimpleFilter } from 'soundtouchjs'
import type { OffscreenMessage } from '../shared/types'

let audioContext: AudioContext | null = null
let sourceNode: MediaStreamAudioSourceNode | null = null
let gainNode: GainNode | null = null
let processorNode: ScriptProcessorNode | null = null
let mediaStream: MediaStream | null = null
let soundtouch: SoundTouch | null = null
let filter: SimpleFilter | null = null

const BUFFER_SIZE = 4096
let inputBuffer: Float32Array[] = []
let inputReadPos = 0

// Prevent unbounded memory growth — cap the input buffer queue
const MAX_QUEUED_CHUNKS = 16

let currentPitch = 0
let currentSpeed = 1

/**
 * Source adapter that feeds captured audio from our ring buffer into SoundTouch.
 */
class StreamSource {
  position = 0

  extract(target: Float32Array, numFrames: number, _position: number): number {
    let framesWritten = 0
    let bufIdx = 0

    while (framesWritten < numFrames && bufIdx < inputBuffer.length) {
      const chunk = inputBuffer[bufIdx]
      const chunkFrames = chunk.length / 2
      const availableFrames = chunkFrames - inputReadPos

      const framesToCopy = Math.min(numFrames - framesWritten, availableFrames)
      const srcOffset = inputReadPos * 2
      const dstOffset = framesWritten * 2

      for (let i = 0; i < framesToCopy * 2; i++) {
        target[dstOffset + i] = chunk[srcOffset + i]
      }

      framesWritten += framesToCopy
      inputReadPos += framesToCopy

      if (inputReadPos >= chunkFrames) {
        inputReadPos = 0
        bufIdx++
      }
    }

    if (bufIdx > 0) {
      inputBuffer.splice(0, bufIdx)
    }

    this.position += framesWritten
    return framesWritten
  }
}

function applySettings() {
  if (!soundtouch) return
  soundtouch.pitchSemitones = currentPitch
  soundtouch.tempo = currentSpeed
}

async function startAudioPipeline(streamId: string) {
  stopAudioPipeline()

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } as MediaTrackConstraints,
      video: false,
    })

    audioContext = new AudioContext({ sampleRate: 44100 })

    // Resume context if it starts suspended (browser policy)
    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }

    sourceNode = audioContext.createMediaStreamSource(mediaStream)
    gainNode = audioContext.createGain()
    gainNode.gain.value = 1.0

    soundtouch = new SoundTouch()
    const streamSource = new StreamSource()
    filter = new SimpleFilter(streamSource, soundtouch)
    applySettings()

    processorNode = audioContext.createScriptProcessor(BUFFER_SIZE, 2, 2)

    processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
      const inputL = event.inputBuffer.getChannelData(0)
      const inputR = event.inputBuffer.getChannelData(1)
      const outputL = event.outputBuffer.getChannelData(0)
      const outputR = event.outputBuffer.getChannelData(1)

      // Pass through directly when no processing is needed
      if (currentPitch === 0 && currentSpeed === 1) {
        outputL.set(inputL)
        outputR.set(inputR)
        return
      }

      const numFrames = inputL.length
      const interleaved = new Float32Array(numFrames * 2)
      for (let i = 0; i < numFrames; i++) {
        interleaved[i * 2] = inputL[i]
        interleaved[i * 2 + 1] = inputR[i]
      }

      // Drop oldest chunks if queue is too long (prevents unbounded memory)
      if (inputBuffer.length >= MAX_QUEUED_CHUNKS) {
        inputBuffer.splice(0, inputBuffer.length - MAX_QUEUED_CHUNKS + 1)
        inputReadPos = 0
      }
      inputBuffer.push(interleaved)

      try {
        const outputInterleaved = new Float32Array(numFrames * 2)
        const framesExtracted = filter!.extract(outputInterleaved, numFrames)

        for (let i = 0; i < framesExtracted; i++) {
          outputL[i] = outputInterleaved[i * 2]
          outputR[i] = outputInterleaved[i * 2 + 1]
        }
        for (let i = framesExtracted; i < numFrames; i++) {
          outputL[i] = 0
          outputR[i] = 0
        }
      } catch {
        // If SoundTouch extraction fails, pass through raw audio
        outputL.set(inputL)
        outputR.set(inputR)
      }
    }

    sourceNode.connect(processorNode)
    processorNode.connect(gainNode)
    gainNode.connect(audioContext.destination)

    console.log('[Karaoke Pitch Offscreen] Audio pipeline started with SoundTouch')
  } catch (err) {
    console.error('[Karaoke Pitch Offscreen] Failed to start audio pipeline:', err)
    stopAudioPipeline()
  }
}

function stopAudioPipeline() {
  if (processorNode) {
    processorNode.onaudioprocess = null
    processorNode.disconnect()
    processorNode = null
  }
  if (gainNode) {
    gainNode.disconnect()
    gainNode = null
  }
  if (sourceNode) {
    sourceNode.disconnect()
    sourceNode = null
  }
  if (audioContext) {
    audioContext.close().catch(() => {})
    audioContext = null
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop())
    mediaStream = null
  }
  if (soundtouch) {
    soundtouch.clear()
    soundtouch = null
  }
  filter = null
  inputBuffer = []
  inputReadPos = 0
  console.log('[Karaoke Pitch Offscreen] Audio pipeline stopped')
}

function setPitch(semitones: number) {
  currentPitch = semitones
  applySettings()
}

function setSpeed(speed: number) {
  currentSpeed = speed
  applySettings()
}

chrome.runtime.onMessage.addListener((msg: OffscreenMessage & { target?: string }) => {
  if (msg.target !== 'offscreen') return

  switch (msg.action) {
    case 'START':
      startAudioPipeline(msg.streamId)
      break
    case 'STOP':
      stopAudioPipeline()
      break
    case 'SET_PITCH':
      setPitch(msg.value)
      break
    case 'SET_SPEED':
      setSpeed(msg.value)
      break
  }
})

console.log('[Karaoke Pitch Offscreen] Ready')
