// Thin client for the ARGUS API. The JWT lives in memory + sessionStorage (cleared with the tab).
import { apiError, t } from './i18n.js'

const BASE = '/api/v1'
let token = sessionStorage.getItem('argus.token')

export const session = {
  get token() { return token },
  get role() { return sessionStorage.getItem('argus.role') },
  clear() { token = null; sessionStorage.clear() },
}

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  if (res.status === 401 && path !== '/auth/login') { session.clear(); location.reload() }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = Array.isArray(body.detail) ? body.detail.map((d) => d.msg).join(', ') : body.detail
    throw new Error(apiError(detail) || t('error.request', { status: res.status }))
  }
  return body
}

export async function login(username, password) {
  const r = await call('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
  token = r.token
  sessionStorage.setItem('argus.token', r.token)
  sessionStorage.setItem('argus.role', r.role)
  return r
}

export const getEvents = () => call('/events?limit=200')
export const getTelemetry = (node, minutes = 10) => call(`/telemetry?node=${encodeURIComponent(node)}&minutes=${minutes}`)
export const sendCommand = (node, action, value) =>
  call(`/nodes/${encodeURIComponent(node)}/commands`, { method: 'POST', body: JSON.stringify({ action, value }) })

// Live feed with automatic reconnection.
export function connectLive(onMessage, onState) {
  let ws, closed = false, retry = 1000
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}${BASE}/ws?token=${encodeURIComponent(token)}`)
    ws.onopen = () => { retry = 1000; onState('live') }
    ws.onmessage = (e) => onMessage(JSON.parse(e.data))
    ws.onclose = (e) => {
      if (e.code === 4401) { session.clear(); location.reload(); return }
      onState('reconnecting')
      if (!closed) setTimeout(open, (retry = Math.min(retry * 2, 10000)))
    }
  }
  open()
  return () => { closed = true; ws && ws.close() }
}
