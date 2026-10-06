import { useEffect, useMemo, useReducer, useState } from 'react'
import { connectLive, getEvents, getTelemetry, session } from './api.js'
import { initialState, recentThreat, reducer } from './state.js'
import { threatState } from './threats.js'
import { ALARM_PRIORITY, unlockAudio, useAlarmSound } from './sound.js'
import { NODE_INFO, SITE, nodeLabel } from './site.js'
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
  if (!open) return <p className="situation is-clear">All clear across the site</p>
  return (
    <p className={`situation cat-${open.category}`} role="alert">
      {open.message}
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
    () => Object.fromEntries(Object.keys(NODE_INFO).map((id) => [id, recentThreat(s.events, id)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.events, Math.floor(now / 2000)],
  )
  const threatFx = useMemo(
    () => threatState(s.nodes, s.series, s.events, now / 1000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.nodes, s.series, s.events, Math.floor(now / 1000)],
  )
  // which alarm should be sounding right now (highest priority wins)
  const alarm = useMemo(() => {
    const t = Object.values(threatFx)
    const nowS = now / 1000
    const active = {
      intrusion: t.some((x) => x.intruder),
      cyber: !!drill || s.events.some((e) => e.category === 'cyber' && e.severity === 'critical' && nowS - e.ts < 8),
      gas: t.some((x) => x.gas > 0.02),
      heat: t.some((x) => x.heat > 0.02),
    }
    return ALARM_PRIORITY.find((k) => active[k]) ?? null
  }, [threatFx, drill, s.events, now])
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
        <span className={`fleet ${online < nodes.length ? 'is-degraded' : ''}`}>{online} of {nodes.length} nodes reporting</span>
        <span className={`link link-${s.link}`}>{s.link === 'live' ? 'Live' : 'Reconnecting…'}</span>
        <button className={`btn btn-quiet sound${soundOn ? ' is-on' : ''}`} aria-pressed={soundOn} onClick={toggleSound}>
          {soundOn ? (alarm ? '🔊 Alarm sounding' : '🔊 Sound on') : '🔇 Sound off'}
        </button>
        <time className="clock">{new Date(now).toLocaleTimeString()}</time>
        <button className="btn btn-quiet" onClick={() => { session.clear(); location.reload() }}>Sign out</button>
      </header>

      <main className="grid">
        <section className="twin" aria-label="Site map">
          <Situation events={s.events} now={now} />
          <DrillBanner drill={drill} />
          <SiteTwin nodes={s.nodes} threats={threats} threatFx={threatFx} events={s.events} drill={drill} selected={selected} onSelect={setSelected} />
          <ul className="legend" aria-label="Map legend">
            <li><i className="dot dot-online" />Reporting</li>
            <li><i className="dot dot-down" />Silent</li>
            <li><i className="dot dot-environmental" />Environmental alert</li>
            <li><i className="dot dot-intrusion" />Intrusion alert</li>
            <li><i className="dot dot-cyber" />Cyber alert</li>
            <li><i className="dot dot-packet" />Message in flight</li>
          </ul>
        </section>
        <Timeline events={s.events} onSelectNode={setSelected} />
        <NodePanel id={selected} node={s.nodes[selected]} series={s.series[selected]} traffic={s.traffic[selected]} />
        <Controls id={selected} node={s.nodes[selected]} onSelect={setSelected} drill={drill} onStartDrill={startDrill} onStopDrill={stopDrill} />
        <CameraFeed nodes={s.nodes} threats={threats} threatFx={threatFx} events={s.events} drill={drill} />
      </main>
      <p className="sr-only" aria-live="polite">{selected ? `Showing ${nodeLabel(selected)}` : ''}</p>
    </div>
  )
}

export default function App() {
  const [authed, setAuthed] = useState(Boolean(session.token))
  return authed ? <Console /> : <Login onDone={() => setAuthed(true)} />
}
