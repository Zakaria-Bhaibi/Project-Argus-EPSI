// One timeline for the three threat families from the brief, plus system messages.
import { useState } from 'react'
import { nodeLabel } from '../site.js'

const FILTERS = [
  { id: 'environmental', label: 'Environment' },
  { id: 'intrusion', label: 'Intrusion' },
  { id: 'cyber', label: 'Cyber' },
  { id: 'system', label: 'System' },
]
const SEVERITY_MARK = { critical: '◆', warning: '▲', info: '·' }

function ago(ts) {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function Timeline({ events, onSelectNode }) {
  const [shown, setShown] = useState({ environmental: true, intrusion: true, cyber: true, system: false })
  const counts = Object.fromEntries(FILTERS.map((f) => [f.id, events.filter((e) => e.category === f.id).length]))
  const visible = events.filter((e) => shown[e.category])

  return (
    <section className="panel timeline" aria-label="Threat timeline">
      <header className="panel-head">
        <h2>Threat timeline</h2>
        <div className="filters" role="group" aria-label="Show categories">
          {FILTERS.map((f) => (
            <button key={f.id} className={`chip chip-${f.id}`} aria-pressed={shown[f.id]}
                    onClick={() => setShown((s) => ({ ...s, [f.id]: !s[f.id] }))}>
              {f.label} <span className="chip-count">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </header>
      <ol className="events">
        {visible.length === 0 && <li className="empty">Nothing yet. Alerts from sensors, the camera and the network appear here as they happen.</li>}
        {visible.map((e) => {
          const node = e.data?.node
          return (
            <li key={e.id} className={`event cat-${e.category} sev-${e.severity}`}>
              <span className="event-time">{ago(e.ts)}</span>
              <span className="event-mark" aria-label={e.severity}>{SEVERITY_MARK[e.severity]}</span>
              <div className="event-body">
                <p className="event-msg">{e.message}</p>
                <p className="event-meta">
                  {node ? <button className="link" onClick={() => onSelectNode(node)}>{nodeLabel(node)}</button> : e.source}
                  {e.data?.ip && <> from {e.data.ip}</>}
                  {e.data?.username && <> as “{e.data.username}”</>}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
