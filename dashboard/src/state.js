// Single reducer for everything the live feed pushes.
export const MAX_POINTS = 180   // 6 minutes at 2 s
export const MAX_EVENTS = 250

export const initialState = { nodes: {}, series: {}, events: [], traffic: {}, link: 'connecting' }

export function reducer(state, a) {
  switch (a.type) {
    case 'link':
      return { ...state, link: a.value }
    case 'events':
      return { ...state, events: a.events.slice(0, MAX_EVENTS) }
    case 'history':
      return { ...state, series: { ...state.series, [a.node]: a.points.slice(-MAX_POINTS) } }
    case 'msg':
      return onMessage(state, a.msg)
    default:
      return state
  }
}

function onMessage(state, m) {
  switch (m.kind) {
    case 'hello':
      return { ...state, nodes: Object.fromEntries(m.nodes.map((n) => [n.id, n])) }
    case 'node':
      return { ...state, nodes: { ...state.nodes, [m.node.id]: m.node } }
    case 'telemetry': {
      const point = { ts: m.ts, temp_c: m.temp_c, hum_pct: m.hum_pct, gas_ppm: m.gas_ppm, pir: m.pir, anomaly: m.anomaly }
      const prev = state.nodes[m.node] || { id: m.node, actuators: {} }
      return {
        ...state,
        nodes: { ...state.nodes, [m.node]: { ...prev, status: 'online', last: point, anomaly: m.anomaly } },
        series: { ...state.series, [m.node]: [...(state.series[m.node] || []), point].slice(-MAX_POINTS) },
      }
    }
    case 'event':
      if (state.events.some((e) => e.id === m.event.id)) return state
      return { ...state, events: [m.event, ...state.events].slice(0, MAX_EVENTS) }
    case 'traffic':
      return { ...state, traffic: { ...state.traffic, [m.node]: m } }
    default:
      return state
  }
}

// Last event per node in the past `windowS` seconds, used to light up the twin.
export function recentThreat(events, node, windowS = 20) {
  const now = Date.now() / 1000
  return events.find((e) => (e.data?.node === node || e.source === node) && e.category !== 'system' && now - e.ts < windowS)
}
