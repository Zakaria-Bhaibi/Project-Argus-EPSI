// What the map should show for each node, derived from live measurements and detections.
// Never from the simulator's scenario label: the Wokwi box's real sliders animate the map the same way.
import { NODE_INFO } from './site.js'

const BASELINE_READINGS = 15          // first 30 s of a node's history = its "normal"
const INTRUSION_WINDOW_S = 20
const INTRUSION_KINDS = new Set(['pir', 'person_in_zone', 'tamper'])

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : null
}
const clamp01 = (x) => Math.min(1, Math.max(0, x))

// Baselines are frozen once known, so a slow leak can't drag "normal" up with it.
const baselines = {}
function baseline(id, series) {
  if (baselines[id]?.done) return baselines[id]
  const pts = (series || []).slice(0, BASELINE_READINGS)
  const temps = pts.map((p) => p.temp_c).filter((v) => v != null)
  const gases = pts.map((p) => p.gas_ppm).filter((v) => v != null)
  baselines[id] = { temp: median(temps), gas: median(gases), done: pts.length >= BASELINE_READINGS && gases.length > 5 }
  return baselines[id]
}

/** Per node: { heat 0..1, gas 0..1, tempC, gasPpm, intruder: {since, confidence} | null } */
export function threatState(nodes, series, events, nowS) {
  const out = {}
  for (const id of Object.keys(NODE_INFO)) {
    const last = nodes[id]?.last
    const b = baseline(id, series[id])
    // median of the last 5 readings: one noisy sample (the emulated MQ-2 is noisy) can't raise a hazard
    const recent = (series[id] || []).slice(-5)
    const tempC = median(recent.map((p) => p.temp_c).filter((v) => v != null)) ?? last?.temp_c ?? null
    const gasPpm = median(recent.map((p) => p.gas_ppm).filter((v) => v != null)) ?? last?.gas_ppm ?? null
    // visual intensity only (the alarms themselves come from the AI): +2 °C starts glowing, +12 °C is full
    const heat = tempC != null && b.temp != null ? clamp01((tempC - b.temp - 2) / 10) : 0
    // a real leak climbs +150 ppm within ~15 s; the overheat's slow gas drift stays below it
    const gas = gasPpm != null && b.gas != null ? clamp01((gasPpm - b.gas - 150) / 600) : 0

    // an intrusion "episode": consecutive intrusion events less than 20 s apart; `since` anchors the walk
    let intruder = null
    for (const e of events) {               // newest first
      if (nowS - e.ts > 120) break
      const node = e.data?.node ?? (e.source === 'vision' ? 'sentinel-hero' : e.source)
      if (node !== id || !INTRUSION_KINDS.has(e.kind)) continue
      if (!intruder) {
        if (nowS - e.ts > INTRUSION_WINDOW_S) break
        intruder = { since: e.ts, confidence: e.data?.confidence ?? null }
      } else if (intruder.since - e.ts < INTRUSION_WINDOW_S) {
        intruder.since = e.ts
        intruder.confidence ??= e.data?.confidence ?? null
      } else break
    }
    out[id] = { heat, gas, tempC, gasPpm, intruder }
  }
  return out
}
