// The 3D site twin: AetherCorp outpost K-7 at night. Nodes are light beacons, every message they send
// flies to the comms mast as a packet, and a shield dome ripples when a cyber attack is detected.
import { memo, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { FENCE, NODE_INFO, STRUCTURES } from '../site.js'

// in-scene palette (the viewport is a night scene; brighter steps of the UI's category hues)
const C = {
  sky: '#0A141C', terrain: '#15262F', pad: '#1B2E39', contour: '#3E7391', grid: '#24414F',
  wall: '#4C6373', roof: '#62798A', edge: '#9CCBE8', window: '#FFC870', panel: '#2A5A8C',
  turbine: '#C9D6DF', packet: '#8BE9FF',
  online: '#3DDC97', silent: '#E05A6A', unknown: '#8A99A6',
  environmental: '#F5B524', intrusion: '#FF4D8D', cyber: '#6F8BFF',
}
const MAST = STRUCTURES.find((s) => s.kind === 'mast')
const HUB = new THREE.Vector3(MAST.pos[0], MAST.h + 0.4, MAST.pos[2])   // packets fly to the mast top
const REDUCED = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ------------------------------------------------------------------ terrain
const SIZE = 150, SEG = 150
function height(x, z) {
  const h = 2.6 * Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.06 - 0.4)
    + 1.6 * Math.sin((x + z) * 0.045 + 2) + 0.8 * Math.cos(x * 0.19 - z * 0.12)
    + 4.5 * Math.max(0, (Math.hypot(x, z) - 45) / 30)                       // hills rise towards the horizon
  const pad = Math.min(1, Math.max(0, (Math.hypot(x, z) - 26) / 14))      // flat site pad in the middle
  return h * pad - 0.05
}

function contourSegments() {
  const N = 120, step = SIZE / N, pts = [], grid = []
  for (let i = 0; i <= N; i++) {
    grid.push([])
    for (let j = 0; j <= N; j++) grid[i].push(height(-SIZE / 2 + i * step, -SIZE / 2 + j * step))
  }
  for (let level = -2; level <= 10; level += 0.6) {
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const c = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
      const p = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]
      const cross = []
      for (let k = 0; k < 4; k++) {
        const a = c[k], b = c[(k + 1) % 4]
        if ((a < level) !== (b < level)) {
          const t = (level - a) / (b - a)
          const [x0, z0] = p[k], [x1, z1] = p[(k + 1) % 4]
          cross.push([-SIZE / 2 + (x0 + (x1 - x0) * t) * step, level + 0.04, -SIZE / 2 + (z0 + (z1 - z0) * t) * step])
        }
      }
      if (cross.length >= 2) pts.push(...cross[0], ...cross[1])
      if (cross.length === 4) pts.push(...cross[2], ...cross[3])
    }
  }
  return new Float32Array(pts)
}

const Terrain = memo(function Terrain() {
  const ground = useMemo(() => {
    const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)))
    g.computeVertexNormals()
    return g
  }, [])
  const contours = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(contourSegments(), 3))
    return g
  }, [])
  return (
    <group>
      <mesh geometry={ground} receiveShadow>
        <meshStandardMaterial color={C.terrain} roughness={0.95} metalness={0} />
      </mesh>
      <lineSegments geometry={contours}>
        <lineBasicMaterial color={C.contour} transparent opacity={0.45} />
      </lineSegments>
      <gridHelper args={[52, 26, C.grid, C.grid]} position={[0, 0.02, 0]} />
    </group>
  )
})

// ------------------------------------------------------------------ structures
function Building({ size, pos, windows = 0, roof = true }) {
  const [w, h, d] = size
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), [w, h, d])
  return (
    <group position={[pos[0], 0, pos[2]]}>
      <mesh position-y={h / 2} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={C.wall} roughness={0.8} />
      </mesh>
      <lineSegments geometry={edges} position-y={h / 2}>
        <lineBasicMaterial color={C.edge} transparent opacity={0.35} />
      </lineSegments>
      {roof && (
        <mesh position-y={h + 0.12} castShadow>
          <boxGeometry args={[w + 0.3, 0.24, d + 0.3]} />
          <meshStandardMaterial color={C.roof} roughness={0.6} metalness={0.3} />
        </mesh>
      )}
      {Array.from({ length: windows }, (_, i) => (
        <mesh key={i} position={[-w / 2 + (i + 0.5) * (w / windows), h * 0.62, d / 2 + 0.01]}>
          <planeGeometry args={[Math.min(0.9, (w / windows) * 0.55), 0.45]} />
          <meshBasicMaterial color={C.window} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

function Tank({ pos, r, h }) {
  return (
    <group position={[pos[0], 0, pos[2]]}>
      <mesh position-y={h / 2} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, h, 40]} />
        <meshStandardMaterial color="#B7C4CD" roughness={0.35} metalness={0.45} />
      </mesh>
      <mesh position-y={h} castShadow>
        <sphereGeometry args={[r, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#C9D4DB" roughness={0.35} metalness={0.45} />
      </mesh>
      <mesh position-y={h * 0.3} rotation-x={Math.PI / 2}>
        <torusGeometry args={[r + 0.02, 0.06, 8, 48]} />
        <meshBasicMaterial color={C.environmental} toneMapped={false} />
      </mesh>
    </group>
  )
}

function Mast({ pos, h }) {
  const light = useRef()
  useFrame(({ clock }) => {
    if (light.current) light.current.material.color.setScalar(Math.sin(clock.elapsedTime * 3) > 0.6 ? 3 : 0.3)
  })
  return (
    <group position={[pos[0], 0, pos[2]]}>
      <mesh position-y={h / 2} castShadow>
        <cylinderGeometry args={[0.08, 0.3, h, 6]} />
        <meshStandardMaterial color="#8DA0AD" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position-y={h * 0.75} rotation-z={0.5}>
        <cylinderGeometry args={[0.7, 0.7, 0.1, 24]} />
        <meshStandardMaterial color="#B8C6D0" metalness={0.5} roughness={0.3} />
      </mesh>
      <mesh ref={light} position-y={h + 0.4}>
        <sphereGeometry args={[0.22, 16, 12]} />
        <meshBasicMaterial color="#ff3b3b" toneMapped={false} />
      </mesh>
    </group>
  )
}

function WindTurbine({ pos, scale = 1, phase = 0 }) {
  const rotor = useRef()
  const y = height(pos[0], pos[1])
  useFrame((_, dt) => { if (rotor.current && !REDUCED) rotor.current.rotation.z += dt * 0.9 })
  return (
    <group position={[pos[0], y, pos[1]]} scale={scale} rotation-y={-0.6}>
      <mesh position-y={7} castShadow>
        <cylinderGeometry args={[0.18, 0.38, 14, 12]} />
        <meshStandardMaterial color={C.turbine} roughness={0.5} />
      </mesh>
      <mesh position={[0, 14.1, -0.3]} castShadow>
        <boxGeometry args={[0.7, 0.7, 1.8]} />
        <meshStandardMaterial color={C.turbine} roughness={0.5} />
      </mesh>
      <group ref={rotor} position={[0, 14.1, 0.65]} rotation-z={phase}>
        {[0, 1, 2].map((i) => (
          <group key={i} rotation-z={(i * Math.PI * 2) / 3}>
            <mesh position-y={5.5} castShadow>
              <boxGeometry args={[0.32, 11, 0.08]} />
              <meshStandardMaterial color={C.turbine} roughness={0.5} />
            </mesh>
          </group>
        ))}
        <mesh rotation-x={Math.PI / 2}>
          <coneGeometry args={[0.3, 0.7, 12]} />
          <meshStandardMaterial color={C.turbine} />
        </mesh>
      </group>
      <mesh position-y={14.6}>
        <sphereGeometry args={[0.1, 8, 8]} />
        <meshBasicMaterial color="#ff3b3b" toneMapped={false} />
      </mesh>
    </group>
  )
}

function SolarField({ origin, rows = 4, cols = 6 }) {
  const ref = useRef()
  const count = rows * cols
  useEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.55, 0, 0))
    let i = 0
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      m.compose(new THREE.Vector3(origin[0] + c * 2.3, 0.75, origin[1] + r * 2.6), q, new THREE.Vector3(1, 1, 1))
      ref.current.setMatrixAt(i++, m)
    }
    ref.current.instanceMatrix.needsUpdate = true
  }, [origin, rows, cols])
  return (
    <instancedMesh ref={ref} args={[null, null, count]} castShadow receiveShadow>
      <boxGeometry args={[2, 0.06, 1.5]} />
      <meshStandardMaterial color={C.panel} roughness={0.15} metalness={0.8} emissive="#0b2440" />
    </instancedMesh>
  )
}

const Fence = memo(function Fence() {
  const { posts, wire } = useMemo(() => {
    const pts = [...FENCE, FENCE[0]]
    const posts = []
    for (let i = 0; i < FENCE.length; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1]
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 3)
      for (let k = 0; k < n; k++) posts.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n])
    }
    const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, 1.6, z))),
      new THREE.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.6 }))
    return { posts, wire }
  }, [])
  const ref = useRef()
  useEffect(() => {
    const m = new THREE.Matrix4()
    posts.forEach(([x, z], i) => { m.makeTranslation(x, 0.8, z); ref.current.setMatrixAt(i, m) })
    ref.current.instanceMatrix.needsUpdate = true
  }, [posts])
  return (
    <group>
      <instancedMesh ref={ref} args={[null, null, posts.length]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 1.6, 6]} />
        <meshStandardMaterial color="#7D8F9C" metalness={0.6} roughness={0.5} />
      </instancedMesh>
      <primitive object={wire} />
    </group>
  )
})

const Site = memo(function Site() {
  return (
    <group>
      {STRUCTURES.map((s, i) => {
        if (s.kind === 'box') return <Building key={i} size={s.size} pos={s.pos} windows={s.windows ?? 0} />
        if (s.kind === 'tank') return <Tank key={i} pos={s.pos} r={s.r} h={s.h} />
        return <Mast key={i} pos={s.pos} h={s.h} />
      })}
      <SolarField origin={[-19, 21]} rows={3} cols={7} />
      <WindTurbine pos={[-46, -40]} scale={0.8} />
      <WindTurbine pos={[-24, -54]} scale={0.85} phase={1} />
      <WindTurbine pos={[34, -50]} scale={0.8} phase={2} />
      <WindTurbine pos={[56, -18]} scale={0.75} phase={0.5} />
      <Fence />
    </group>
  )
})

// ------------------------------------------------------------------ nodes
function AlertRing({ color }) {
  const ref = useRef()
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime % 1.6) / 1.6
    ref.current.scale.setScalar(1 + t * 5)
    ref.current.material.opacity = 0.95 * (1 - t)
  })
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position-y={0.08}>
      <ringGeometry args={[0.9, 1.1, 64]} />
      <meshBasicMaterial color={color} transparent toneMapped={false} />
    </mesh>
  )
}

function Beacon({ id, node, threat, selected, onSelect }) {
  const info = NODE_INFO[id]
  const head = useRef()
  const color = threat ? C[threat.category] : C[node?.status ?? 'unknown'] ?? C.unknown
  useFrame(({ clock }) => {
    if (head.current) head.current.scale.setScalar(1 + (threat && !REDUCED ? 0.25 * Math.sin(clock.elapsedTime * 6) : 0))
  })
  const click = (e) => { e.stopPropagation(); onSelect(id) }
  return (
    <group position={info.pos}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.06}>
        <ringGeometry args={[selected ? 1.3 : 1.0, selected ? 1.55 : 1.2, 64]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.9} />
      </mesh>
      <mesh position-y={4} onClick={click}
            onPointerOver={() => (document.body.style.cursor = 'pointer')}
            onPointerOut={() => (document.body.style.cursor = '')}>
        <cylinderGeometry args={[0.16, 0.16, 8, 12, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} toneMapped={false}
                           blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={head} position-y={8.2} onClick={click}>
        <sphereGeometry args={[selected ? 0.7 : 0.5, 24, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <pointLight position-y={2} color={color} intensity={threat ? 18 : 6} distance={9} decay={2} />
      {threat && !REDUCED && <AlertRing color={color} />}
    </group>
  )
}

// One packet per telemetry message: node -> comms mast along an arc. Instanced, no React churn.
const MAX_PACKETS = 48
function Packets({ nodes }) {
  const ref = useRef()
  const live = useRef([])
  const seen = useRef({})
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), v: new THREE.Vector3(), a: new THREE.Vector3(), c: new THREE.Vector3() }), [])

  useEffect(() => {
    for (const [id, n] of Object.entries(nodes)) {
      const ts = n?.last?.ts
      if (!ts || seen.current[id] === ts || !NODE_INFO[id]) continue
      seen.current[id] = ts
      if (live.current.length < MAX_PACKETS) live.current.push({ id, t: 0 })
    }
  }, [nodes])

  useFrame((_, dt) => {
    const { m, v, a, c } = tmp
    let i = 0
    live.current = live.current.filter((p) => (p.t += dt / 1.1) < 1)
    for (const p of live.current) {
      const [x, , z] = NODE_INFO[p.id].pos
      a.set(x, 8.2, z)
      c.set((x + HUB.x) / 2, Math.max(a.y, HUB.y) + 5, (z + HUB.z) / 2)
      const t = p.t, u = 1 - t                       // quadratic bezier a -> c -> hub
      v.set(u * u * a.x + 2 * u * t * c.x + t * t * HUB.x, u * u * a.y + 2 * u * t * c.y + t * t * HUB.y,
            u * u * a.z + 2 * u * t * c.z + t * t * HUB.z)
      m.makeTranslation(v.x, v.y, v.z)
      ref.current.setMatrixAt(i++, m)
    }
    ref.current.count = i
    ref.current.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={ref} args={[null, null, MAX_PACKETS]} frustumCulled={false}>
      <sphereGeometry args={[0.22, 12, 8]} />
      <meshBasicMaterial color={C.packet} toneMapped={false} />
    </instancedMesh>
  )
}

// Shield dome: ripples for a few seconds after each cyber event.
function ShieldDome({ lastCyberTs }) {
  const ref = useRef()
  useFrame(() => {
    const age = Date.now() / 1000 - (lastCyberTs || 0)
    const on = age >= 0 && age < 6
    ref.current.visible = on
    if (on) {
      const k = age / 6
      ref.current.material.opacity = 0.32 * (1 - k)
      ref.current.scale.setScalar(1 + (REDUCED ? 0 : 0.04 * Math.sin(age * 9)))
    }
  })
  return (
    <mesh ref={ref} visible={false}>
      <sphereGeometry args={[30, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
      <meshBasicMaterial color={C.cyber} wireframe transparent toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

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

// Labels are plain DOM over the canvas, moved every frame from the 3D camera projection.
// (drei <Html> makes one React root per label, which drops labels under React 19.)
const LABEL_HEIGHT = 10
function LabelTracker({ refs }) {
  const { camera, size } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    for (const [id, info] of Object.entries(NODE_INFO)) {
      const el = refs.current[id]
      if (!el) continue
      v.set(info.pos[0], LABEL_HEIGHT, info.pos[2]).project(camera)
      el.style.visibility = v.z < 1 ? 'visible' : 'hidden'
      el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`
    }
  })
  return null
}

export default function SiteTwin({ nodes, threats, events, selected, onSelect }) {
  const labelRefs = useRef({})
  const lastCyberTs = events.find((e) => e.category === 'cyber')?.ts
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
      <Canvas shadows camera={{ position: [70, 60, 90], fov: 40 }} dpr={[1, 1.75]}
              gl={{ antialias: true, powerPreference: 'high-performance' }} onPointerMissed={() => onSelect(null)}>
        <color attach="background" args={[C.sky]} />
        <fog attach="fog" args={[C.sky, 70, 165]} />
        <hemisphereLight args={['#6B8CA8', '#16242E', 0.9]} />
        <ambientLight intensity={0.3} />
        <directionalLight position={[-35, 45, 25]} intensity={2.2} color="#B9D0E3" castShadow
                          shadow-mapSize={[2048, 2048]} shadow-camera-left={-45} shadow-camera-right={45}
                          shadow-camera-top={45} shadow-camera-bottom={-45} shadow-bias={-0.0005} />
        <Terrain />
        <Site />
        {Object.keys(NODE_INFO).map((id) => (
          <Beacon key={id} id={id} node={nodes[id]} threat={threats[id]} selected={selected === id} onSelect={onSelect} />
        ))}
        <Packets nodes={nodes} />
        <ShieldDome lastCyberTs={lastCyberTs} />
        <CameraIntro />
        <OrbitControls enablePan={false} minDistance={25} maxDistance={110} maxPolarAngle={1.3} target={[0, 0, 0]}
                       enableDamping dampingFactor={0.08} />
        <LabelTracker refs={labelRefs} />
        <EffectComposer multisampling={4}>
          <Bloom intensity={0.9} luminanceThreshold={0.55} luminanceSmoothing={0.2} mipmapBlur />
          <Vignette offset={0.25} darkness={0.55} />
        </EffectComposer>
      </Canvas>
    </>
  )
}
