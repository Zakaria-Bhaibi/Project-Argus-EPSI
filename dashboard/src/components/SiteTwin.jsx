// The 3D site twin, drawn like a survey plan: contour lines, outlined structures, nodes as pins.
import { memo, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { FENCE, NODE_INFO, STRUCTURES } from '../site.js'

const INK = '#1B2A35'
const CATEGORY = { environmental: '#B07A00', intrusion: '#C2185B', cyber: '#2A4BD7' }
const STATUS = { online: '#2E7D5B', silent: '#8C2F39', offline: '#8C2F39', unknown: '#7D8B95' }

// ---- terrain: smooth hills with the plant pad flattened in the middle --------------------
const SIZE = 64, N = 96
function height(x, z) {
  const h = 2.2 * Math.sin(x * 0.09 + 1.3) * Math.cos(z * 0.07 - 0.4)
    + 1.4 * Math.sin((x + z) * 0.05 + 2) + 0.7 * Math.cos(x * 0.21 - z * 0.13)
  const pad = Math.min(1, Math.max(0, (Math.hypot(x, z) - 16) / 12))   // 0 inside the site
  return h * pad - 0.6
}

// marching squares -> line segments for each contour level
function contourSegments() {
  const step = SIZE / N, pts = []
  const grid = []
  for (let i = 0; i <= N; i++) {
    grid.push([])
    for (let j = 0; j <= N; j++) grid[i].push(height(-SIZE / 2 + i * step, -SIZE / 2 + j * step))
  }
  for (let level = -3; level <= 4; level += 0.5) {
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const c = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
      const p = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]
      const cross = []
      for (let k = 0; k < 4; k++) {
        const a = c[k], b = c[(k + 1) % 4]
        if ((a < level) !== (b < level)) {
          const t = (level - a) / (b - a)
          const [x0, z0] = p[k], [x1, z1] = p[(k + 1) % 4]
          cross.push([-SIZE / 2 + (x0 + (x1 - x0) * t) * step, level, -SIZE / 2 + (z0 + (z1 - z0) * t) * step])
        }
      }
      if (cross.length >= 2) pts.push(...cross[0], ...cross[1])
      if (cross.length === 4) pts.push(...cross[2], ...cross[3])
    }
  }
  return new Float32Array(pts)
}

const Terrain = memo(function Terrain() {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(contourSegments(), 3))
    return g
  }, [])
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color={INK} transparent opacity={0.28} />
    </lineSegments>
  )
})

function Outlined({ geometry, position }) {
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry, 25), [geometry])
  return (
    <group position={position}>
      <mesh geometry={geometry}><meshBasicMaterial color="#F6F8F9" /></mesh>
      <lineSegments geometry={edges}><lineBasicMaterial color={INK} /></lineSegments>
    </group>
  )
}

// static scene parts are memoised: the twin re-renders on every telemetry message
const Structures = memo(function Structures() {
  const parts = useMemo(() => STRUCTURES.map((s) => {
    if (s.kind === 'box') return { g: new THREE.BoxGeometry(...s.size), y: s.size[1] / 2, s }
    if (s.kind === 'tank') return { g: new THREE.CylinderGeometry(s.r, s.r, s.h, 28), y: s.h / 2, s }
    return { g: new THREE.CylinderGeometry(0.08, 0.25, s.h, 6), y: s.h / 2, s }
  }), [])
  return parts.map(({ g, y, s }, i) => <Outlined key={i} geometry={g} position={[s.pos[0], y, s.pos[2]]} />)
})

const Fence = memo(function Fence() {
  const fence = useMemo(() => {
    const pts = [...FENCE, FENCE[0]].map(([x, z]) => new THREE.Vector3(x, 0.05, z))
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: INK, dashSize: 0.8, gapSize: 0.5 }))
    line.computeLineDistances()  // required for dashes
    return line
  }, [])
  return <primitive object={fence} />
})

// Expanding ring: the only ambient motion on the page, and only while a threat is active.
function AlertRing({ color }) {
  const ref = useRef()
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime % 1.6) / 1.6
    ref.current.scale.setScalar(1 + t * 4)
    ref.current.material.opacity = 0.9 * (1 - t)
  })
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position-y={0.06}>
      <ringGeometry args={[0.9, 1.05, 48]} />
      <meshBasicMaterial color={color} transparent />
    </mesh>
  )
}

function Pin({ id, node, threat, selected, onSelect }) {
  const info = NODE_INFO[id]
  if (!info) return null
  const color = threat ? CATEGORY[threat.category] : STATUS[node?.status ?? 'unknown']
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return (
    <group position={info.pos}>
      <mesh position-y={1.6}><cylinderGeometry args={[0.05, 0.05, 3.2, 6]} /><meshBasicMaterial color={INK} /></mesh>
      <mesh position-y={3.4} onClick={(e) => { e.stopPropagation(); onSelect(id) }}
            onPointerOver={() => (document.body.style.cursor = 'pointer')}
            onPointerOut={() => (document.body.style.cursor = '')}>
        <sphereGeometry args={[selected ? 1.1 : 0.85, 24, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {threat && !reduced && <AlertRing color={color} />}
    </group>
  )
}

// Labels are plain DOM over the canvas, moved every frame from the 3D camera projection.
// (drei <Html> makes one React root per label, which drops labels under React 19.)
const LABEL_HEIGHT = 4.8
function LabelTracker({ refs }) {
  const { camera, size } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    for (const [id, info] of Object.entries(NODE_INFO)) {
      const el = refs.current[id]
      if (!el) continue
      v.set(info.pos[0], LABEL_HEIGHT, info.pos[2]).project(camera)
      const visible = v.z < 1
      el.style.visibility = visible ? 'visible' : 'hidden'
      el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`
    }
  })
  return null
}

export default function SiteTwin({ nodes, threats, selected, onSelect }) {
  const labelRefs = useRef({})
  return (
    <>
    <div className="pin-labels">
      {Object.entries(NODE_INFO).map(([id, info]) => {
        const node = nodes[id]
        return (
          <button key={id} ref={(el) => { labelRefs.current[id] = el }}
                  className={`pin-label${selected === id ? ' is-selected' : ''}`} onClick={() => onSelect(id)}>
            <span className="pin-name">{info.label}</span>
            <span className="pin-value">
              {node?.last ? `${node.last.temp_c.toFixed(1)}°  ${Math.round(node.last.gas_ppm)} ppm` : 'no data'}
            </span>
          </button>
        )
      })}
    </div>
    <Canvas camera={{ position: [4, 40, 34], fov: 36 }} dpr={[1, 2]} onPointerMissed={() => onSelect(null)}>
      <Terrain />
      <Fence />
      <Structures />
      {Object.keys(NODE_INFO).map((id) => (
        <Pin key={id} id={id} node={nodes[id]} threat={threats[id]} selected={selected === id} onSelect={onSelect} />
      ))}
      <OrbitControls enablePan={false} minDistance={25} maxDistance={90} maxPolarAngle={1.25} target={[0, 0, 0]} />
      <LabelTracker refs={labelRefs} />
    </Canvas>
    </>
  )
}
