// Threat effects in the 3D scene: gas cloud, heat zone, walking intruder.
// Everything is a pure function of (threat state, wall clock), so the main map and the CCTV view,
// which are two separate canvases, always show the same thing at the same moment.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { NODE_INFO } from '../site.js'
import { REDUCED, height } from './common.js'

export const FX = { gas: '#5BE37A', hazard: '#FFD23F', heat: '#FF4A2E', ember: '#FFA040', intruder: '#FF4D8D' }

let soft = null
function softTexture() {           // round soft sprite, built once
  if (soft) return soft
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  r.addColorStop(0, 'rgba(255,255,255,1)')
  r.addColorStop(0.4, 'rgba(255,255,255,0.45)')
  r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 64, 64)
  soft = new THREE.CanvasTexture(c)
  return soft
}

// ------------------------------------------------------------------ particles (gas + embers)
function Particles({ origin, level, count, life, color, size, spread, rise, wind, opacity }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    return g
  }, [count])
  const parts = useMemo(() => Array.from({ length: count }, () => ({ age: Math.random() * life, seed: Math.random() })), [count, life])
  const mat = useRef()
  useFrame((_, dt) => {
    const arr = geo.attributes.position.array
    const active = Math.floor(count * level)
    for (let i = 0; i < count; i++) {
      const p = parts[i]
      if (!REDUCED) p.age += dt
      if (p.age > life) { p.age = 0; p.seed = Math.random() }
      const t = p.age / life
      if (i >= active) { arr[i * 3 + 1] = -500; continue }
      const a = p.seed * Math.PI * 2 + t * 1.5
      const r = (0.4 + t * spread) * (0.5 + p.seed)
      arr[i * 3] = origin[0] + Math.cos(a) * r + t * wind
      arr[i * 3 + 1] = origin[1] + t * rise
      arr[i * 3 + 2] = origin[2] + Math.sin(a) * r + t * wind * 0.4
    }
    geo.attributes.position.needsUpdate = true
    if (mat.current) mat.current.opacity = opacity * (0.5 + 0.5 * level)
  })
  return (
    <points geometry={geo} frustumCulled={false}>
      <pointsMaterial ref={mat} map={softTexture()} color={color} size={size} sizeAttenuation transparent
                      depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </points>
  )
}

function PulseRing({ pos, color, radius, speed = 1.4 }) {
  const ref = useRef()
  useFrame(({ clock }) => {
    const t = REDUCED ? 0.4 : (clock.elapsedTime * speed) % 1
    ref.current.scale.setScalar(radius * (0.6 + 0.4 * t))
    ref.current.material.opacity = 0.9 * (1 - t * 0.7)
  })
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position={[pos[0], 0.1, pos[2]]}>
      <ringGeometry args={[0.92, 1, 64]} />
      <meshBasicMaterial color={color} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

// ------------------------------------------------------------------ gas leak: green smoke + yellow hazard
export function GasCloud({ id, level }) {
  const pos = NODE_INFO[id].pos
  return (
    <group>
      <Particles origin={[pos[0], 1.2, pos[2]]} level={0.25 + 0.75 * level} count={180} life={5} color={FX.gas}
                 size={3.4} spread={2 + 5 * level} rise={6 + 6 * level} wind={4} opacity={0.5} />
      <PulseRing pos={pos} color={FX.hazard} radius={3 + 6 * level} />
      <pointLight position={[pos[0], 2.5, pos[2]]} color={FX.gas} intensity={8 + 30 * level} distance={14} decay={2} />
    </group>
  )
}

// ------------------------------------------------------------------ overheat: red zone + embers
const heatShader = {
  uniforms: { uTime: { value: 0 }, uLevel: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uLevel;
    void main(){
      float d = distance(vUv, vec2(0.5)) * 2.0;
      float a = smoothstep(1.0, 0.0, d);
      float pulse = 0.75 + 0.25 * sin(uTime * 3.0 - d * 6.0);
      vec3 col = mix(vec3(1.0, 0.55, 0.12), vec3(1.0, 0.1, 0.06), smoothstep(0.7, 0.0, d));
      gl_FragColor = vec4(col * 1.8, a * a * (0.35 + 0.65 * uLevel) * pulse);
    }`,
}

export function HeatZone({ id, level }) {
  const pos = NODE_INFO[id].pos
  const mat = useRef()
  useFrame(({ clock }) => {
    mat.current.uniforms.uTime.value = REDUCED ? 0 : clock.elapsedTime
    mat.current.uniforms.uLevel.value = level
  })
  const r = 3 + 9 * level
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[pos[0], 0.12, pos[2]]} scale={[r, r, 1]}>
        <circleGeometry args={[1, 64]} />
        <shaderMaterial ref={mat} args={[heatShader]} transparent depthWrite={false}
                        blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <Particles origin={[pos[0], 0.3, pos[2]]} level={0.3 + 0.7 * level} count={90} life={3} color={FX.ember}
                 size={0.9} spread={r * 0.6} rise={7} wind={0.4} opacity={0.9} />
      <pointLight position={[pos[0], 2, pos[2]]} color={FX.heat} intensity={10 + 50 * level} distance={16} decay={2} />
    </group>
  )
}

// ------------------------------------------------------------------ intruder
const WALK_SPEED = 1.3   // m/s

/** Deterministic walk: from outside the fence to 2.5 m from the node, starting at the first detection. */
export function intruderPose(id, sinceS, nowS) {
  const [x, , z] = NODE_INFO[id].pos
  const len = Math.hypot(x, z) || 1
  const dx = x / len || 0, dz = len > 1 ? z / len : 1
  const sx = x + dx * 26 + dz * 6, sz = z + dz * 26 - dx * 6
  const ex = x + dx * 2.5, ez = z + dz * 2.5
  const dist = Math.hypot(ex - sx, ez - sz)
  const walked = Math.max(0, nowS - sinceS) * WALK_SPEED
  const k = Math.min(1, walked / dist)
  const px = sx + (ex - sx) * k, pz = sz + (ez - sz) * k
  return { x: px, z: pz, y: height(px, pz), heading: Math.atan2(ex - sx, ez - sz), walking: k < 1, phase: walked * 4.2 }
}

const SKIN = new THREE.MeshStandardMaterial({ color: '#2E3438', roughness: 0.8 })
const GLOW = new THREE.MeshBasicMaterial({ color: FX.intruder, side: THREE.BackSide, toneMapped: false })

function Part({ geo, pos, outline = 1.12 }) {
  return (
    <group position={pos}>
      <mesh geometry={geo} material={SKIN} castShadow />
      <mesh geometry={geo} material={GLOW} scale={outline} />
    </group>
  )
}

export function Intruder({ id, since }) {
  const root = useRef(), legL = useRef(), legR = useRef(), armL = useRef(), armR = useRef(), cone = useRef()
  const geo = useMemo(() => ({
    torso: new THREE.CapsuleGeometry(0.33, 0.8, 4, 12),
    head: new THREE.SphereGeometry(0.26, 16, 12),
    limb: new THREE.BoxGeometry(0.2, 0.85, 0.2).translate(0, -0.42, 0),
    cone: new THREE.CylinderGeometry(0.06, 1.5, 1, 24, 1, true).translate(0, -0.5, 0),
  }), [])
  const tmp = useMemo(() => ({ head: new THREE.Vector3(), dir: new THREE.Vector3(), down: new THREE.Vector3(0, -1, 0) }), [])
  const beacon = NODE_INFO[id].pos

  useFrame(() => {
    const p = intruderPose(id, since, Date.now() / 1000)
    root.current.position.set(p.x, p.y, p.z)
    root.current.rotation.y = p.heading
    const swing = p.walking && !REDUCED ? Math.sin(p.phase) * 0.6 : 0
    legL.current.rotation.x = swing
    legR.current.rotation.x = -swing
    armL.current.rotation.x = -swing * 0.8
    armR.current.rotation.x = swing * 0.8
    // searchlight from the node's beacon onto the intruder
    tmp.head.set(beacon[0], 8.2, beacon[2])
    tmp.dir.set(p.x, p.y + 1, p.z).sub(tmp.head)
    cone.current.position.copy(tmp.head)
    cone.current.scale.set(1, tmp.dir.length(), 1)
    cone.current.quaternion.setFromUnitVectors(tmp.down, tmp.dir.normalize())
  })

  return (
    <group>
      <group ref={root}>
        <Part geo={geo.torso} pos={[0, 1.35, 0]} />
        <Part geo={geo.head} pos={[0, 2.2, 0]} />
        <group ref={legL} position={[-0.17, 0.9, 0]}><Part geo={geo.limb} pos={[0, 0, 0]} outline={1.18} /></group>
        <group ref={legR} position={[0.17, 0.9, 0]}><Part geo={geo.limb} pos={[0, 0, 0]} outline={1.18} /></group>
        <group ref={armL} position={[-0.45, 1.75, 0]}><Part geo={geo.limb} pos={[0, 0, 0]} outline={1.18} /></group>
        <group ref={armR} position={[0.45, 1.75, 0]}><Part geo={geo.limb} pos={[0, 0, 0]} outline={1.18} /></group>
      </group>
      <mesh ref={cone} geometry={geo.cone}>
        <meshBasicMaterial color={FX.intruder} transparent opacity={0.16} blending={THREE.AdditiveBlending}
                           depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** All active effects for a threat state. Used by both canvases. */
export function ThreatEffects({ threats }) {
  return Object.entries(threats).map(([id, t]) => (
    <group key={id}>
      {t.gas > 0.02 && <GasCloud id={id} level={t.gas} />}
      {t.heat > 0.02 && <HeatZone id={id} level={t.heat} />}
      {t.intruder && <Intruder id={id} since={t.intruder.since} />}
    </group>
  ))
}
