// One timeline for the three threat families from the brief, plus system messages.
import { useState } from 'react'
import { nodeLabel } from '../site.js'
import { eventMessage, locale, t } from '../i18n.js'

const FILTERS = ['environmental', 'intrusion', 'cyber', 'system']
const SEVERITY_MARK = { critical: '◆', warning: '▲', info: '·' }

function ago(ts) {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return new Date(ts * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
}

export default function Timeline({ events: current, allEvents, onSelectNode }) {
  const [history, setHistory] = useState(false)
  const events = history ? allEvents : current
  const [shown, setShown] = useState({ environmental: true, intrusion: true, cyber: true, system: false })
  const counts = Object.fromEntries(FILTERS.map((f) => [f, events.filter((e) => e.category === f).length]))
  const visible = events.filter((e) => shown[e.category])

  return (
    <section className="panel timeline" aria-label={t('timeline.title')}>
      <header className="panel-head">
        <h2>{t('timeline.title')}</h2>
        <button className="link" aria-pressed={history} onClick={() => setHistory((h) => !h)}>
          {history ? t('timeline.sinceClear') : t('timeline.earlier')}
        </button>
        <div className="filters" role="group" aria-label={t('timeline.filters')}>
          {FILTERS.map((f) => (
            <button key={f} className={`chip chip-${f}`} aria-pressed={shown[f]}
                    onClick={() => setShown((s) => ({ ...s, [f]: !s[f] }))}>
              {t(`cat.${f}`)} <span className="chip-count">{counts[f]}</span>
            </button>
          ))}
        </div>
      </header>
      <ol className="events">
        {visible.length === 0 && <li className="empty">{t('timeline.empty')}</li>}
        {visible.map((e) => {
          const node = e.data?.node
          return (
            <li key={e.id} className={`event cat-${e.category} sev-${e.severity}`}>
              <span className="event-time">{ago(e.ts)}</span>
              <span className="event-mark" aria-label={t(`sev.${e.severity}`)}>{SEVERITY_MARK[e.severity]}</span>
              <div className="event-body">
                <p className="event-msg">{eventMessage(e)}</p>
                <p className="event-meta">
                  {node ? <button className="link" onClick={() => onSelectNode(node)}>{nodeLabel(node)}</button> : e.source}
                  {e.data?.ip && <> {t('timeline.from', { ip: e.data.ip })}</>}
                  {e.data?.username && <> {t('timeline.as', { user: e.data.username })}</>}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
