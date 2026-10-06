// Virtual CCTV: a PTZ camera on the comms mast filming the same 3D site as the main map.
// Idle, it sweeps the site; when an intrusion is detected it slews to the intruder and frames them
// with a detection box. The box only exists because the system detected someone (PIR or camera event).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FENCE, STRUCTURES } from '../site.js'
import { REDUCED } from '../scene/common.js'
import { World } from '../scene/World.jsx'
import { intruderPose } from '../scene/effects.jsx'

const MAST = STRUCTURES.find((s) => s.kind === 'mast')
const EYE = new THREE.Vector3(MAST.pos[0] + 0.6, MAST.h * 0.72, MAST.pos[2] + 0.6)

function insideFence(x, z) {   // point-in-polygon on the site fence
  let inside = false
  for (let i = 0, j = FENCE.length - 1; i < FENCE.length; j = i++) {
    const [xi, zi] = FENCE[i], [xj, zj] = FENCE[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function Ptz({ target, box }) {
  const { camera, size } = useThree()
  const tmp = useMemo(() => ({ look: new THREE.Vector3(0, 0, 0), want: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3() }), [])
  useFrame(({ clock }, dt) => {
    camera.position.copy(EYE)
    const now = Date.now() / 1000
    const p = target ? intruderPose(target.id, target.since, now) : null
    if (p) tmp.want.set(p.x, p.y + 1.1, p.z)
    else {
      const a = REDUCED ? 0.6 : clock.elapsedTime * 0.12          // slow patrol sweep
      tmp.want.set(EYE.x + Math.cos(a) * 22, 0, EYE.z + Math.sin(a) * 22)
    }
    tmp.look.lerp(tmp.want, REDUCED ? 1 : Math.min(1, dt * 2.5))   // motorised slew
    camera.lookAt(tmp.look)

    const el = box.current
    if (!el) return
    if (!p) { el.style.display = 'none'; return }
    // project feet and head to screen to frame the person
    tmp.a.set(p.x, p.y, p.z).project(camera)
    tmp.b.set(p.x, p.y + 2.5, p.z).project(camera)
    if (tmp.a.z > 1) { el.style.display = 'none'; return }
    const x = ((tmp.a.x + 1) / 2) * size.width, yFeet = ((1 - tmp.a.y) / 2) * size.height
    const yHead = ((1 - tmp.b.y) / 2) * size.height
    const h = Math.max(18, yFeet - yHead), w = h * 0.45
    el.style.display = 'block'
    el.style.transform = `translate(${x - w / 2}px, ${yHead}px)`
    el.style.width = `${w}px`
    el.style.height = `${h}px`
    el.dataset.zone = insideFence(p.x, p.z) ? 'restricted' : 'perimeter'
  })
  return null
}

function useClock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i) }, [])
  return t
}

export default function CameraFeed({ nodes, threats, threatFx, events }) {
  const box = useRef()
  const time = useClock()
  // the most recent intrusion episode anywhere on site is what the PTZ follows
  const target = Object.entries(threatFx)
    .filter(([, t]) => t.intruder)
    .map(([id, t]) => ({ id, ...t.intruder }))
    .sort((a, b) => b.since - a.since)[0] || null
  const lastCyberTs = events.find((e) => e.category === 'cyber')?.ts
  const conf = target?.confidence ?? 0.94

  return (
    <section className="panel camera" aria-label="Site camera">
      <header className="panel-head"><h2>Mast camera</h2></header>
      <div className="cctv">
        <Canvas camera={{ fov: 42, near: 0.5, far: 200 }} dpr={1} gl={{ antialias: true }}>
          <World nodes={nodes} threats={threats} threatFx={threatFx} lastCyberTs={lastCyberTs}
                 selected={null} onSelect={() => {}} shadows={false} />
          <Ptz target={target} box={box} />
        </Canvas>
        <div className="cctv-overlay" aria-hidden="true">
          <span className="cctv-rec">● REC</span>
          <span className="cctv-id">CAM-01 MAST PTZ</span>
          <span className="cctv-time">{time.toLocaleDateString()} {time.toLocaleTimeString()}</span>
          <span className="cctv-mode">{target ? 'TRACKING' : 'PATROL'}</span>
          <div ref={box} className="cctv-box"><span>person {conf.toFixed(2)}</span></div>
        </div>
        <p className="sr-only" aria-live="polite">{target ? 'Camera tracking a detected intruder' : 'Camera patrolling'}</p>
      </div>
    </section>
  )
}
