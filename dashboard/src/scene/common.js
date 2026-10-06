// Shared by the 3D scene, its effects and the CCTV view.
// in-scene palette (the viewport is a night scene; brighter steps of the UI's category hues)
export const C = {
  sky: '#0A141C', terrain: '#15262F', pad: '#1B2E39', contour: '#3E7391', grid: '#24414F',
  wall: '#4C6373', roof: '#62798A', edge: '#9CCBE8', window: '#FFC870', panel: '#2A5A8C',
  turbine: '#C9D6DF', packet: '#8BE9FF',
  online: '#3DDC97', silent: '#E05A6A', unknown: '#8A99A6',
  environmental: '#F5B524', intrusion: '#FF4D8D', cyber: '#6F8BFF',
}
export const REDUCED = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ------------------------------------------------------------------ terrain height
export const SIZE = 150, SEG = 150
export function height(x, z) {
  const h = 2.6 * Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.06 - 0.4)
    + 1.6 * Math.sin((x + z) * 0.045 + 2) + 0.8 * Math.cos(x * 0.19 - z * 0.12)
    + 4.5 * Math.max(0, (Math.hypot(x, z) - 45) / 30)                       // hills rise towards the horizon
  const pad = Math.min(1, Math.max(0, (Math.hypot(x, z) - 26) / 14))      // flat site pad in the middle
  return h * pad - 0.05
}

