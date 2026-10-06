import { useState } from 'react'
import { login } from '../api.js'
import { SITE } from '../site.js'

export default function Login({ onDone }) {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true); setError(null)
    try {
      await login(f.get('username'), f.get('password'))
      onDone()
    } catch (err) {
      setError(err.message === 'invalid credentials' ? 'Wrong username or password.' : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <form onSubmit={submit} className="login-card">
        <h1 className="wordmark">ARGUS</h1>
        <p className="login-sub">{SITE.name} supervision console</p>
        <label>Username<input name="username" autoComplete="username" required autoFocus /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        {error && <p className="note note-error" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  )
}
