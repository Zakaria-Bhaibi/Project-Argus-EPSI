// The 3D site twin (main map): the shared World plus camera intro, DOM labels, hazard badges and bloom.
import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { NODE_INFO, nodeLabel } from '../site.js'
import { t as tr } from '../i18n.js'   // `t` is the threat state in this file
import { REDUCED } from '../scene/common.js'
import { World } from '../scene/World.jsx'
import { intruderPose } from '../scene/effects.jsx'

// ------------------------------------------------------------------ camera
const CAM_END = new THREE.Vector3(4, 52, 50)
function CameraIntro() {
  const { camera } = useThree()
  const t = useRef(REDUCED ? 1 : 0)
  useFrame((_, dt) => {
    if (t.current >= 1) return
    t.current = Math.min(1, t.current + dt / 2.8)
    const k = 1 - Math.pow(1 - t.current, 3)
    camera.position.lerpVectors(new THREE.Vector3(70, 60, 90), CAM_END, k)
    camera.lookAt(0, 0, 0)
  })
  return null
}

// Labels and hazard badges are plain DOM over the canvas, moved every frame from the 3D camera projection.
// (drei <Html> makes one React root per label, which drops labels under React 19.)
const LABEL_HEIGHT = 10
function LabelTracker({ labels, badges, threatFx }) {
  const { camera, size } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])
  const place = (el, x, y, z) => {
    v.set(x, y, z).project(camera)
    el.style.visibility = v.z < 1 ? 'visible' : 'hidden'
    el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`
  }
  useFrame(() => {
    for (const [id, info] of Object.entries(NODE_INFO)) {
      const el = labels.current[id]
      if (el) place(el, info.pos[0], LABEL_HEIGHT, info.pos[2])
      const hz = badges.current[`hazard:${id}`]
      if (hz) place(hz, info.pos[0], LABEL_HEIGHT + 4.2, info.pos[2])
      const it = badges.current[`intruder:${id}`], t = threatFx[id]?.intruder
      if (it && t) {
        const p = intruderPose(id, t.since, Date.now() / 1000)
        place(it, p.x, p.y + 3.4, p.z)
      }
    }
  })
  return null
}

function hazards(t) {
  const out = []
  if (t.gas > 0.02) out.push({ kind: 'gas', text: tr('hazard.gas', { ppm: Math.round(t.gasPpm) }), icon: '⚠' })
  if (t.heat > 0.02) out.push({ kind: 'heat', text: tr('hazard.heat', { temp: t.tempC.toFixed(1) }), icon: '▲' })
  return out
}

export default function SiteTwin({ nodes, threats, threatFx, events, drill, selected, onSelect }) {
  const labelRefs = useRef({})
  const badgeRefs = useRef({})
  const lastCyberTs = events.find((e) => e.category === 'cyber')?.ts
  return (
    <>
      <div className="pin-labels">
        {Object.keys(NODE_INFO).map((id) => {
          const node = nodes[id]
          const t = threatFx[id]
          const hz = t ? hazards(t) : []
          const gas = node?.last?.gas_ppm
          return (
            <div key={id}>
              <button ref={(el) => { labelRefs.current[id] = el }}
                      className={`pin-label${selected === id ? ' is-selected' : ''}`} onClick={() => onSelect(id)}>
                <span className="pin-name">{nodeLabel(id)}</span>
                <span className="pin-value">
                  {node?.last ? `${node.last.temp_c.toFixed(1)}°  ${gas == null ? tr('pin.gasWarming') : `${Math.round(gas)} ppm`}` : tr('pin.noData')}
                </span>
              </button>
              {hz.length > 0 && (
                <div ref={(el) => { badgeRefs.current[`hazard:${id}`] = el }} className="hazard-stack" role="alert">
                  {hz.map((h) => <span key={h.kind} className={`hazard hazard-${h.kind}`}><b aria-hidden="true">{h.icon}</b>{h.text}</span>)}
                </div>
              )}
              {t?.intruder && (
                <div ref={(el) => { badgeRefs.current[`intruder:${id}`] = el }} className="hazard-stack" role="alert">
                  <span className="hazard hazard-intruder"><b aria-hidden="true">◆</b>{tr('hazard.intruder')}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <Canvas shadows camera={{ position: [70, 60, 90], fov: 40 }} dpr={[1, 1.75]}
              gl={{ antialias: true, powerPreference: 'high-performance' }} onPointerMissed={() => onSelect(null)}>
        <World nodes={nodes} threats={threats} threatFx={threatFx} lastCyberTs={lastCyberTs} drillStartedAt={drill?.startedAt}
               selected={selected} onSelect={onSelect} />
        <CameraIntro />
        <OrbitControls enablePan={false} minDistance={25} maxDistance={110} maxPolarAngle={1.3} target={[0, 0, 0]}
                       enableDamping dampingFactor={0.08} />
        <LabelTracker labels={labelRefs} badges={badgeRefs} threatFx={threatFx} />
        <EffectComposer multisampling={4}>
          <Bloom intensity={0.9} luminanceThreshold={0.55} luminanceSmoothing={0.2} mipmapBlur />
          <Vignette offset={0.25} darkness={0.55} />
        </EffectComposer>
      </Canvas>
    </>
  )
}
