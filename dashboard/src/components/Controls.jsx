// Operator actions on one node. Every command is signed by the server with the node's key.
import { useState } from 'react'
import { sendCommand, session } from '../api.js'
import { NODE_INFO } from '../site.js'

const SCENARIOS = [
  { id: 'normal', label: 'Normal' },
  { id: 'gas_leak', label: 'Gas leak' },
  { id: 'overheat', label: 'Overheat' },
  { id: 'intruder', label: 'Intruder' },
  { id: 'sensor_fault', label: 'Sensor fault' },
]

export default function Controls({ id, node, drill, onStartDrill, onStopDrill }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const [text, setText] = useState('')
  if (!id) return null
  const operator = session.role === 'operator'
  const act = node?.actuators || {}

  async function send(action, value, done) {
    setBusy(true); setNote(null)
    try {
      await sendCommand(id, action, value)
      setNote({ ok: true, text: done })
    } catch (e) {
      setNote({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel controls" aria-label="Node controls">
      <header className="panel-head"><h2>Controls</h2></header>
      {!operator && <p className="hint">Viewer accounts can watch but not act. Sign in as an operator to send commands.</p>}
      <fieldset disabled={!operator || busy}>
        <div className="control-row">
          <span className="control-name">Siren</span>
          <button className={act.buzzer ? 'btn btn-danger' : 'btn'} onClick={() => send('buzzer', !act.buzzer, act.buzzer ? 'Siren off' : 'Siren on')}>
            {act.buzzer ? 'Stop siren' : 'Sound siren'}
          </button>
        </div>
        <div className="control-row">
          <span className="control-name">Status light</span>
          <div className="seg" role="group" aria-label="Status light">
            {[['green', 'Green'], ['orange', 'Orange'], ['red', 'Red'], ['off', 'Off']].map(([c, label]) => (
              <button key={c} className={`seg-btn led-${c}`} aria-pressed={act.led === c} onClick={() => send('led', c, `Light set to ${c}`)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <form className="control-row" onSubmit={(e) => { e.preventDefault(); send('display', text, 'Message shown on the screen') }}>
          <label className="control-name" htmlFor="oled-text">Screen message</label>
          <input id="oled-text" maxLength={21} value={text} onChange={(e) => setText(e.target.value)} placeholder="Evacuate north gate" />
          <button className="btn" type="submit">Show</button>
        </form>
        {NODE_INFO[id]?.simulated ? (
          <div className="control-row scenario">
            <span className="control-name">Demo scenario</span>
            <div className="seg" role="group" aria-label="Demo scenario">
              {SCENARIOS.map((s) => (
                <button key={s.id} className="seg-btn" onClick={() => send('scenario', s.id, `Scenario: ${s.label}`)}>{s.label}</button>
              ))}
            </div>
          </div>
        ) : (
          <p className="hint">This node runs real firmware: change its temperature, gas and motion with the sensor controls in Wokwi.</p>
        )}
      </fieldset>
      <div className="control-row drill-row">
        <span className="control-name">Cyber drill</span>
        <button className={drill ? 'btn btn-danger' : 'btn'} onClick={drill ? onStopDrill : onStartDrill}>
          {drill ? 'Stop drill' : 'Start drill'}
        </button>
        <span className="hint">Animation only, for the demo</span>
      </div>
      {note && <p className={note.ok ? 'note' : 'note note-error'} role="status">{note.text}</p>}
    </section>
  )
}
