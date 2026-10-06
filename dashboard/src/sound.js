// Alarm sounds, synthesised with the Web Audio API (no audio files to ship or load).
// One looping pattern per alarm type; the loudest priority wins. Browsers only allow audio after a
// user gesture, so the context is created from the "Sound on" toggle click.
import { useEffect, useRef } from 'react'

let ctx = null
let master = null

export function unlockAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    master = ctx.createGain()
    master.gain.value = 0.18          // alarms, but not ear-splitting on a projector's speakers
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume()
}

function tone(freq, start, dur, { type = 'square', to = null, vol = 1 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, start)
  if (to) o.frequency.linearRampToValueAtTime(to, start + dur)
  g.gain.setValueAtTime(0, start)
  g.gain.linearRampToValueAtTime(vol, start + 0.01)          // tiny attack/release: no clicks
  g.gain.setValueAtTime(vol, start + dur - 0.03)
  g.gain.linearRampToValueAtTime(0, start + dur)
  o.connect(g).connect(master)
  o.start(start)
  o.stop(start + dur + 0.02)
}

// each pattern plays one cycle starting at t and returns the cycle length (s)
const PATTERNS = {
  // intruder: rising/falling siren
  intrusion: (t) => { tone(600, t, 0.7, { type: 'sawtooth', to: 1200, vol: 0.6 }); tone(1200, t + 0.7, 0.7, { type: 'sawtooth', to: 600, vol: 0.6 }); return 1.4 },
  // cyber: fast electronic double pulses
  cyber: (t) => { for (let i = 0; i < 4; i++) tone(i % 2 ? 1320 : 990, t + i * 0.12, 0.09, { vol: 0.5 }); return 0.9 },
  // gas: classic hazard beep-beep
  gas: (t) => { tone(880, t, 0.25, { vol: 0.6 }); tone(880, t + 0.4, 0.25, { vol: 0.6 }); return 1.3 },
  // overheat: slow low warning tone
  heat: (t) => { tone(440, t, 0.6, { type: 'triangle', vol: 0.8 }); return 1.4 },
}
export const ALARM_PRIORITY = ['intrusion', 'cyber', 'gas', 'heat']

function chime() {
  const t = ctx.currentTime + 0.02
  tone(660, t, 0.25, { type: 'sine', vol: 0.5 })
  tone(880, t + 0.18, 0.4, { type: 'sine', vol: 0.5 })
}

/** Plays `kind` in a loop while it is set; a soft chime when an alarm ends. */
export function useAlarmSound(kind, enabled) {
  const timer = useRef(null)
  const prev = useRef(null)
  useEffect(() => {
    clearTimeout(timer.current)
    if (!enabled || !ctx) { prev.current = kind; return }
    if (!kind) {
      if (prev.current) chime()
      prev.current = null
      return
    }
    prev.current = kind
    const loop = () => {
      const len = PATTERNS[kind](ctx.currentTime + 0.02)
      timer.current = setTimeout(loop, len * 1000)
    }
    loop()
    return () => clearTimeout(timer.current)
  }, [kind, enabled])
}
