import { getMic } from './audio'

/**
 * Voice-activity detection and segment capture.
 *
 * This is the piece that makes the assistant reliable, and it exists because
 * the browser's SpeechRecognition does not. That API dies silently under
 * always-on use — Chrome throttles it, it stops firing events, and nothing you
 * can catch tells you it has gone deaf. Detecting that a human is speaking is
 * not a language problem, though; it is an energy problem, and energy on the
 * microphone signal is something we can measure ourselves, every frame, with no
 * black box that can quietly stop answering.
 *
 * So: a running-mean noise floor, a threshold above it, and a hysteresis gate.
 * When the signal crosses the threshold a fresh recorder starts; when it falls
 * quiet for long enough the recorder stops and hands back one self-contained
 * audio blob for the bridge to transcribe. The detection is instant and local
 * — that is what makes barge-in feel natural — and the words come back a moment
 * later from a real transcriber that cannot silently fail the way the browser
 * one did.
 *
 * Hearing himself is the one hard part. The microphone picks up JARVIS's own
 * voice through the speakers, and raw energy cannot tell that from the user.
 * Two things handle it: getUserMedia is asked for echo cancellation, which
 * removes most of the playback, and while he is speaking the trigger threshold
 * is raised so the residue that leaks through does not cross it. A text check
 * after transcription is the final backstop, in voice.ts.
 */

export type VadHandlers = {
  /** The signal crossed into speech. Instant; this is the barge-in trigger. */
  onStart: () => void
  /** Speech ended. The blob is one complete, decodable audio file. */
  onEnd: (audio: Blob, ms: number) => void
  /** 0..1 smoothed input level, for the caption/orb while capturing. */
  onLevel: (v: number) => void
  /** Capture is impossible — no microphone, or no MediaRecorder support. */
  onError: (message: string) => void
}

export type Vad = {
  stop: () => void
  /** Raise the trigger bar while JARVIS speaks, so his own playback leaking
   *  past echo cancellation does not register as the user talking. */
  setGuard: (on: boolean) => void
  /** Stop all recording and listening while muted. */
  setMuted: (muted: boolean) => void
  /** Toggle near-field voice isolation mode. */
  setVoiceIsolation: (enabled: boolean) => void
  live: () => boolean
  /** Live internals, for the diagnostics panel. */
  meter: () => { energy: number; floor: number; threshold: number; speaking: boolean }
}

// ---------------------------------------------------------------------------
// Tuning — Google Voice Search Calibrated VAD
// ---------------------------------------------------------------------------

/** While he is speaking, demand this much more, so residual echo is ignored. */
const GUARD_BOOST = 2.4
/** Falling back below trigger×this ends the segment. Hysteresis stops a single
 *  dip mid-word from cutting a sentence in half. */
const RELEASE_RATIO = 0.6

/** Minimum duration of authentic human speech in milliseconds (400ms).
 *  Sub-400ms sounds (coughs, sneezes, clicks, throat clearing, taps) are discarded before STT. */
const MIN_UTTERANCE_MS = 400

/** Sustained vocal energy for 200ms confirms speech rather than a transient tap, click, or cough. */
const START_MS = 200
/** Nobody speaks one segment for this long; cut it and transcribe what we have. */
const MAX_MS = 20000

/** The floor adapts smoothly to room ambient noise within 1-2 seconds rather than lagging. */
const FLOOR_UP = 0.0035
const FLOOR_DOWN = 0.02

function pickMime(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) {
      return m
    }
  }
  return ''
}

export async function startVad(h: VadHandlers): Promise<Vad> {
  let stream: MediaStream
  try {
    stream = await getMic()
  } catch (err) {
    h.onError(
      err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Microphone access denied — voice input is unavailable.'
        : 'No microphone available.',
    )
    return {
      stop: () => {},
      setGuard: () => {},
      setMuted: () => {},
      setVoiceIsolation: () => {},
      live: () => false,
      meter: () => ({ energy: 0, floor: 0, threshold: 0, speaking: false }),
    }
  }

  if (typeof MediaRecorder === 'undefined') {
    h.onError('This browser cannot record audio — voice input is unavailable.')
    return {
      stop: () => {},
      setGuard: () => {},
      setMuted: () => {},
      setVoiceIsolation: () => {},
      live: () => false,
      meter: () => ({ energy: 0, floor: 0, threshold: 0, speaking: false }),
    }
  }

  const mime = pickMime()
  const ctx = new AudioContext()
  void ctx.resume()
  const source = ctx.createMediaStreamSource(stream)

  // Google Voice Search Vocal Bandpass Filter:
  // Isolates authentic human vocal formant band (160Hz - 3800Hz)
  // Strips DC offset, table knocks, air currents, breathing pops (<160Hz)
  // Strips keyboard clicks, mouse snaps, high-frequency hiss (>3800Hz)
  const highpass = ctx.createBiquadFilter()
  highpass.type = 'highpass'
  highpass.frequency.value = 160
  highpass.Q.value = 0.7

  const lowpass = ctx.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = 3800
  lowpass.Q.value = 0.7

  source.connect(highpass)
  highpass.connect(lowpass)

  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.35
  lowpass.connect(analyser)
  const buf = new Float32Array(analyser.fftSize)

  let stopped = false
  let guard = false
  let isMuted = false
  let voiceIsolation = true
  let floor = 0.01
  let smoothEnergy = 0
  let threshold = 0

  // Segment state.
  let recorder: MediaRecorder | null = null
  let parts: Blob[] = []
  let armedAt = 0 // energy first rose; recording may be pre-rolling
  let speaking = false
  let speechStartedAt = 0
  let lastLoud = 0
  let raf = 0

  const rms = (): number => {
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    return Math.sqrt(sum / buf.length)
  }

  const startRecorder = () => {
    parts = []
    try {
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 24000 })
        : new MediaRecorder(stream)
    } catch {
      recorder = new MediaRecorder(stream)
    }
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) parts.push(e.data)
    }
    recorder.start()
  }

  const discardRecorder = () => {
    if (!recorder) return
    try {
      recorder.ondataavailable = null
      if (recorder.state !== 'inactive') recorder.stop()
    } catch {
      /* already gone */
    }
    recorder = null
    parts = []
  }

  const endSegment = () => {
    const rec = recorder
    const startedAt = speechStartedAt
    speaking = false
    speechStartedAt = 0
    if (!rec) return
    recorder = null

    const finalise = () => {
      const type = rec.mimeType || mime || 'audio/webm'
      const blob = new Blob(parts, { type })
      parts = []
      const ms = startedAt ? performance.now() - startedAt : 0
      // Ignore sub-400ms sounds (coughs, mic bumps, clicks, throat clearing)
      if (ms < MIN_UTTERANCE_MS) {
        return
      }
      h.onEnd(blob, ms)
    }
    rec.onstop = finalise
    try {
      if (rec.state !== 'inactive') rec.stop()
      else finalise()
    } catch {
      finalise()
    }
  }

  const tick = () => {
    if (stopped) return
    raf = requestAnimationFrame(tick)

    // While microphone is muted, cancel recording and ignore input
    if (isMuted) {
      if (speaking || armedAt !== 0) {
        armedAt = 0
        speaking = false
        discardRecorder()
      }
      return
    }

    const energy = rms()
    smoothEnergy += (energy - smoothEnergy) * 0.5
    h.onLevel(Math.min(1, smoothEnergy * 12))

    // Adapt the floor only when we are confident this is not speech.
    if (!speaking && armedAt === 0) {
      const rate = smoothEnergy > floor ? FLOOR_UP : FLOOR_DOWN
      floor += (smoothEnergy - floor) * rate
      floor = Math.max(floor, 0.003)
    }

    // Voice Isolation Gate:
    // When enabled, demands near-field primary speaker loudness (0.028) and higher relative rise (3.6x),
    // strictly rejecting far-field chatter, secondary voices in the room, distant TV, and ambient noise.
    const triggerRatio = voiceIsolation ? 3.6 : 3.0
    const minSpeech = voiceIsolation ? 0.028 : 0.016
    const calcThreshold = floor * triggerRatio * (guard ? GUARD_BOOST : 1)
    threshold = Math.max(calcThreshold, minSpeech * (guard ? GUARD_BOOST : 1))
    const release = threshold * RELEASE_RATIO
    const now = performance.now()

    if (!speaking) {
      if (smoothEnergy > threshold) {
        if (armedAt === 0) {
          armedAt = now
          startRecorder()
        } else if (now - armedAt >= (voiceIsolation ? 160 : START_MS)) {
          // Confirmed primary speaker speech
          speaking = true
          speechStartedAt = armedAt
          lastLoud = now
          h.onStart()
        }
      } else if (armedAt !== 0) {
        // Rose and fell without confirming — a transient knock or click
        armedAt = 0
        discardRecorder()
      }
    } else {
      if (smoothEnergy > release) lastLoud = now
      const quietFor = now - lastLoud
      const runFor = now - speechStartedAt
      // Adaptive low-latency endpointing: 340ms after sustained speech, 460ms for shorter words
      const targetSilence = runFor > 600 ? 340 : 460
      if (quietFor >= targetSilence || runFor >= MAX_MS) {
        armedAt = 0
        endSegment()
      }
    }
  }

  tick()

  return {
    stop: () => {
      stopped = true
      cancelAnimationFrame(raf)
      discardRecorder()
      try {
        source.disconnect()
        highpass.disconnect()
        lowpass.disconnect()
        void ctx.close()
      } catch {
        /* noop */
      }
    },
    setGuard: (on) => {
      guard = on
    },
    setMuted: (m) => {
      isMuted = m
      if (m) {
        armedAt = 0
        speaking = false
        discardRecorder()
      }
    },
    setVoiceIsolation: (on) => {
      voiceIsolation = on
    },
    live: () => !stopped,
    meter: () => ({ energy: smoothEnergy, floor, threshold, speaking }),
  }
}
