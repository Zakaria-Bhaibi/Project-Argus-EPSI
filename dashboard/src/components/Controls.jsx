// Operator actions. Two parts:
//  - "Simulate an incident": site-wide demo buttons (each drives one simulated node, or the visual cyber drill)
//  - the selected node's actuators (siren, light, screen), with confirmation from the node itself.
// Every command is signed by the server with the node's key.
import { useEffect, useState } from 'react'
import { sendCommand, session } from '../api.js'
import { nodeLabel } from '../site.js'
import { t } from '../i18n.js'

const SIMULATED = ['sentinel-01', 'sentinel-02', 'sentinel-03', 'sentinel-04']
const INCIDENTS = [
  { id: 'gas', node: 'sentinel-02', scenario: 'gas_leak' },
  { id: 'heat', node: 'sentinel-04', scenario: 'overheat' },
  { id: 'intruder', node: 'sentinel-01', scenario: 'intruder' },
]
const CONFIRM_TIMEOUT_MS = 6000

export default function Controls({ id, node, onSelect, drill, onStartDrill, onStopDrill, onAllClear }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)       // { ok, text }
  const [pending, setPending] = useState(null) // { action, value, node } waiting for the node's ack
  const [active, setActive] = useState({})     // incident id -> true while running (this browser)
  const [text, setText] = useState('')
  const operator = session.role === 'operator'
  const act = node?.actuators || {}
  const online = node?.status === 'online'

  // new node selected: clear the per-node form state
  useEffect(() => { setText(''); setPending(null) }, [id])

  // the node confirms an actuator command by sending an "ack" event, which updates node.actuators
  useEffect(() => {
    if (!pending || pending.node !== id) return
    if (act[pending.action] === pending.value) {
      setNote({ ok: true, text: t('note.confirmed', { node: nodeLabel(id) }) })
      setPending(null)
    }
  }, [act, pending, id])
  useEffect(() => {
    if (!pending) return
    const t = setTimeout(() => {
      setNote({ ok: false, text: t('note.noConfirm', { node: nodeLabel(pending.node) }) })
      setPending(null)
    }, CONFIRM_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [pending])

  async function actuate(action, value) {
    setBusy(true); setNote(null)
    try {
      await sendCommand(id, action, value)
      setPending({ action, value: action === 'display' ? 'ok' : value, node: id })
      setNote({ ok: true, text: t('note.sent', { node: nodeLabel(id) }) })
    } catch (e) {
      setNote({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  async function incident(inc) {
    setBusy(true); setNote(null)
    try {
      await sendCommand(inc.node, 'scenario', inc.scenario)
      setActive((a) => ({ ...a, [inc.id]: true }))
      setNote({ ok: true, text: t('note.started', { incident: t(`inc.${inc.id}`), node: nodeLabel(inc.node) }) })
      onSelect(inc.node)
    } catch (e) {
      setNote({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  async function allClear() {
    setBusy(true); setNote(null)
    try {
      await Promise.all(SIMULATED.flatMap((n) => [
        sendCommand(n, 'scenario', 'normal'), sendCommand(n, 'buzzer', false), sendCommand(n, 'led', 'green'),
      ].map((p) => p.catch(() => null))))
      setActive({})
      if (drill) onStopDrill()
      onAllClear()
      setNote({ ok: true, text: t('note.allClear') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel controls" aria-label={t('controls.title')}>
      <header className="panel-head"><h2>{t('controls.title')}</h2></header>
      {!operator && <p className="hint">{t('controls.viewer')}</p>}

      <fieldset className="simulate" disabled={!operator || busy}>
        <legend>{t('controls.simulate')}</legend>
        <div className="seg" role="group" aria-label={t('controls.simulate')}>
          {INCIDENTS.map((inc) => (
            <button key={inc.id} className={`seg-btn inc-${inc.id}`} aria-pressed={!!active[inc.id]} onClick={() => incident(inc)}>
              {t(`inc.${inc.id}`)}
            </button>
          ))}
          <button className="seg-btn inc-cyber" aria-pressed={!!drill} onClick={drill ? onStopDrill : onStartDrill}>
            {drill ? t('inc.stopCyber') : t('inc.cyber')}
          </button>
          <button className="seg-btn inc-clear" onClick={allClear}>{t('inc.clear')}</button>
        </div>
      </fieldset>

      <fieldset disabled={!operator || busy || !online}>
        <legend>{id ? nodeLabel(id) : t('controls.noNode')}</legend>
        {id && !online && (
          <p className="hint hint-warn">
            {t(node?.status === 'silent' ? 'controls.notReporting' : 'controls.offline', { node: nodeLabel(id) })}
            {id === 'sentinel-hero' && t('controls.startWokwi')}
          </p>
        )}
        <div className="control-row">
          <span className="control-name">{t('controls.siren')}</span>
          <button className={act.buzzer ? 'btn btn-danger' : 'btn'} onClick={() => actuate('buzzer', !act.buzzer)}>
            {act.buzzer ? t('controls.stopSiren') : t('controls.soundSiren')}
          </button>
        </div>
        <div className="control-row">
          <span className="control-name">{t('controls.light')}</span>
          <div className="seg" role="group" aria-label={t('controls.light')}>
            {['green', 'orange', 'red', 'off'].map((c) => (
              <button key={c} className={`seg-btn led-${c}`} aria-pressed={act.led === c} onClick={() => actuate('led', c)}>
                {t(`led.${c}`)}
              </button>
            ))}
          </div>
        </div>
        <form className="control-row" onSubmit={(e) => { e.preventDefault(); actuate('display', text) }}>
          <label className="control-name" htmlFor="oled-text">{t('controls.screen')}</label>
          <input id="oled-text" maxLength={21} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('controls.screenPlaceholder')} />
          <button className="btn" type="submit">{t('controls.show')}</button>
        </form>
      </fieldset>
      {note && <p className={note.ok ? 'note' : 'note note-error'} role="status">{note.text}</p>}
    </section>
  )
}
