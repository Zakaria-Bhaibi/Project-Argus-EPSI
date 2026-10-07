import { useState } from 'react'
import { login } from '../api.js'
import { SITE } from '../site.js'
import { t } from '../i18n.js'
import LangSwitch from './LangSwitch.jsx'

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
      setError(err.message === 'invalid credentials' ? t('login.wrong') : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <form onSubmit={submit} className="login-card">
        <LangSwitch />
        <h1 className="wordmark">ARGUS</h1>
        <p className="login-sub">{t('login.sub', { site: SITE.name })}</p>
        <label>{t('login.username')}<input name="username" autoComplete="username" required autoFocus /></label>
        <label>{t('login.password')}<input name="password" type="password" autoComplete="current-password" required /></label>
        {error && <p className="note note-error" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? t('login.busy') : t('login.submit')}</button>
      </form>
    </main>
  )
}
