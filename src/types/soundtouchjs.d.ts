declare module 'soundtouchjs' {
  export class SoundTouch {
    pitch: number
    pitchOctaves: number
    pitchSemitones: number
    tempo: number
    tempoChange: number
    rate: number
    rateChange: number
    readonly inputBuffer: unknown
    readonly outputBuffer: unknown
    process(): void
    clear(): void
    clone(): SoundTouch
  }

  export class SimpleFilter {
    constructor(source: { extract: (target: Float32Array, numFrames: number, position: number) => number; position: number }, pipe: SoundTouch, callback?: () => void)
    extract(target: Float32Array, numFrames: number): number
    clear(): void
    readonly position: number
    readonly sourcePosition: number
  }

  export class PitchShifter {
    constructor(context: AudioContext, buffer: AudioBuffer, bufferSize: number, onEnd?: () => void)
    pitch: number
    pitchSemitones: number
    tempo: number
    rate: number
    percentagePlayed: number
    connect(node: AudioNode): void
    disconnect(): void
    on(event: string, callback: (detail: unknown) => void): void
    off(event?: string): void
  }

  export class WebAudioBufferSource {
    constructor(buffer: AudioBuffer)
    extract(target: Float32Array, numFrames: number, position: number): number
    position: number
  }

  export function getWebAudioNode(
    context: AudioContext,
    filter: SimpleFilter,
    sourcePositionCallback?: (position: number) => void,
    bufferSize?: number
  ): ScriptProcessorNode
}
