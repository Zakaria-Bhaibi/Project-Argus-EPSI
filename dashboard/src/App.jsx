import { useEffect, useMemo, useReducer, useState } from 'react'
import { connectLive, getEvents, getTelemetry, session } from './api.js'
import { initialState, recentThreat, reducer } from './state.js'
import { threatState } from './threats.js'
import { ALARM_PRIORITY, unlockAudio, useAlarmSound } from './sound.js'
import { NODE_INFO, SITE, nodeLabel } from './site.js'
import { eventMessage, locale, t, useLang } from './i18n.js'
import LangSwitch from './components/LangSwitch.jsx'
import Login from './components/Login.jsx'
import SiteTwin from './components/SiteTwin.jsx'
import Timeline from './components/Timeline.jsx'
import NodePanel from './components/NodePanel.jsx'
import Controls from './components/Controls.jsx'
import CameraFeed from './components/CameraFeed.jsx'
import DrillBanner, { DRILL_S } from './components/DrillBanner.jsx'

function useClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  return now
}

// The headline is the current situation, not the product name.
function Situation({ events, now }) {
  const age = (e) => now / 1000 - e.ts
  const open = events.find((e) => e.kind === 'incident' && age(e) < 120)
    || events.find((e) => e.severity === 'critical' && e.category !== 'system' && age(e) < 60)
    || events.find((e) => e.severity === 'warning' && e.category !== 'system' && age(e) < 30)
  if (!open) return <p className="situation is-clear">{t('situation.clear')}</p>
  return (
    <p className={`situation cat-${open.category}`} role="alert">
      {eventMessage(open)}
    </p>
  )
}

function Console() {
  const [s, dispatch] = useReducer(reducer, initialState)
  const [selected, setSelected] = useState('sentinel-hero')
  const now = useClock()
  // visual-only cyber drill: animation on the map, never an event in the timeline
  const [drill, setDrill] = useState(null)
  useEffect(() => {
    if (!drill) return
    const t = setTimeout(() => setDrill(null), DRILL_S * 1000)
    return () => clearTimeout(t)
  }, [drill])
  // Clean slate: the view reacts only to events since this login or the last "All clear".
  // Nothing is deleted; the timeline can still show earlier events on demand.
  const [clearedAt, setClearedAt] = useState(() => Date.now() / 1000)
  const events = useMemo(() => s.events.filter((e) => e.ts >= clearedAt), [s.events, clearedAt])
  const startDrill = () => setDrill({ startedAt: Date.now() / 1000 })
  const stopDrill = () => setDrill(null)

  useEffect(() => {
    getEvents().then((events) => dispatch({ type: 'events', events })).catch(() => {})
    // history for every node, so each has a baseline for the threat effects straight away
    for (const id of Object.keys(NODE_INFO)) {
      getTelemetry(id, 15).then((points) => dispatch({ type: 'history', node: id, points })).catch(() => {})
    }
    return connectLive((msg) => dispatch({ type: 'msg', msg }), (value) => dispatch({ type: 'link', value }))
  }, [])

  useEffect(() => {
    if (selected) getTelemetry(selected).then((points) => dispatch({ type: 'history', node: selected, points })).catch(() => {})
  }, [selected])

  const threats = useMemo(
    () => Object.fromEntries(Object.keys(NODE_INFO).map((id) => [id, recentThreat(events, id)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, Math.floor(now / 2000)],
  )
  const threatFx = useMemo(
    () => threatState(s.nodes, s.series, events, now / 1000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.nodes, s.series, events, Math.floor(now / 1000)],
  )
  // which alarm should be sounding right now (highest priority wins)
  const alarm = useMemo(() => {
    const t = Object.values(threatFx)
    const nowS = now / 1000
    const active = {
      intrusion: t.some((x) => x.intruder),
      cyber: !!drill || events.some((e) => e.category === 'cyber' && e.severity === 'critical' && nowS - e.ts < 8),
      gas: t.some((x) => x.gas > 0.02),
      heat: t.some((x) => x.heat > 0.02),
    }
    return ALARM_PRIORITY.find((k) => active[k]) ?? null
  }, [threatFx, drill, events, now])
  const [soundOn, setSoundOn] = useState(() => {
    try { return localStorage.getItem('argus.sound') === 'on' } catch { return false }
  })
  const toggleSound = () => {
    const next = !soundOn
    if (next) unlockAudio()            // needs this click: browsers block audio until a user gesture
    setSoundOn(next)
    try { localStorage.setItem('argus.sound', next ? 'on' : 'off') } catch { /* private mode */ }
  }
  // a saved "on" still needs one click on the page to unlock audio after a reload
  useEffect(() => {
    if (!soundOn) return
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [soundOn])
  useAlarmSound(alarm, soundOn)
  const nodes = Object.values(s.nodes)
  const online = nodes.filter((n) => n.status === 'online').length

  return (
    <div className="console">
      <header className="topbar">
        <span className="wordmark">ARGUS</span>
        <span className="site">{SITE.name}, {SITE.region}</span>
        <span className={`fleet ${online < nodes.length ? 'is-degraded' : ''}`}>{t('top.reporting', { online, total: nodes.length })}</span>
        <span className={`link link-${s.link}`}>{s.link === 'live' ? t('top.live') : t('top.reconnecting')}</span>
        <button className={`btn btn-quiet sound${soundOn ? ' is-on' : ''}`} aria-pressed={soundOn} onClick={toggleSound}>
          {soundOn ? (alarm ? t('top.alarm') : t('top.soundOn')) : t('top.soundOff')}
        </button>
        <time className="clock">{new Date(now).toLocaleTimeString(locale())}</time>
        <button className="btn btn-quiet" onClick={() => { session.clear(); location.reload() }}>{t('top.signOut')}</button>
        <LangSwitch />
      </header>

      <main className="grid">
        <section className="twin" aria-label={t('map.label')}>
          <Situation events={events} now={now} />
          <DrillBanner drill={drill} />
          <SiteTwin nodes={s.nodes} threats={threats} threatFx={threatFx} events={events} drill={drill} selected={selected} onSelect={setSelected} />
          <ul className="legend" aria-label={t('map.legend')}>
            <li><i className="dot dot-online" />{t('legend.online')}</li>
            <li><i className="dot dot-down" />{t('legend.down')}</li>
            <li><i className="dot dot-environmental" />{t('legend.environmental')}</li>
            <li><i className="dot dot-intrusion" />{t('legend.intrusion')}</li>
            <li><i className="dot dot-cyber" />{t('legend.cyber')}</li>
            <li><i className="dot dot-packet" />{t('legend.packet')}</li>
          </ul>
        </section>
        <Timeline events={events} allEvents={s.events} onSelectNode={setSelected} />
        <NodePanel id={selected} node={s.nodes[selected]} series={s.series[selected]} traffic={s.traffic[selected]} />
        <Controls id={selected} node={s.nodes[selected]} onSelect={setSelected} drill={drill} onStartDrill={startDrill} onStopDrill={stopDrill} onAllClear={() => setClearedAt(Date.now() / 1000)} />
        <CameraFeed nodes={s.nodes} threats={threats} threatFx={threatFx} events={events} drill={drill} />
      </main>
      <p className="sr-only" aria-live="polite">{selected ? t('sr.showing', { node: nodeLabel(selected) }) : ''}</p>
    </div>
  )
}

export default function App() {
  useLang()   // re-render everything when the language changes
  const [authed, setAuthed] = useState(Boolean(session.token))
  return authed ? <Console /> : <Login onDone={() => setAuthed(true)} />
}
