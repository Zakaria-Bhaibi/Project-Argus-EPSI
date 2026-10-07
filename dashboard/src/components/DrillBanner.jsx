// Visual "cyber drill" banner over the map. Pure animation: no traffic, no API call, no timeline entry.
import { useEffect, useState } from 'react'
import { t } from '../i18n.js'

export const DRILL_S = 9
const STEPS = [
  { until: 3, kind: 'attack', icon: '⚠', text: 'drill.attack' },
  { until: 6, kind: 'defend', icon: '⛨', text: 'drill.defend' },
  { until: DRILL_S, kind: 'blocked', icon: '✓', text: 'drill.blocked' },
]

export default function DrillBanner({ drill }) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    if (!drill) return
    const t = setInterval(() => setNow(Date.now() / 1000), 200)
    return () => clearInterval(t)
  }, [drill])
  if (!drill) return null
  const age = now - drill.startedAt
  const step = STEPS.find((s) => age < s.until) ?? STEPS[STEPS.length - 1]
  return (
    <div className={`drill drill-${step.kind}`} role="status" aria-live="assertive">
      <span className="drill-text"><b aria-hidden="true">{step.icon}</b>{t(step.text)}</span>
    </div>
  )
}
