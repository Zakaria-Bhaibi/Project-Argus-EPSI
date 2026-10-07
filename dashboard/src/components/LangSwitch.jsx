// EN / FR toggle, shown on the login card and in the top bar.
import { setLang, t, useLang } from '../i18n.js'

export default function LangSwitch() {
  const lang = useLang()
  return (
    <div className="seg lang" role="group" aria-label={t('lang.label')}>
      {[['en', 'EN', 'English'], ['fr', 'FR', 'Français']].map(([id, short, name]) => (
        <button key={id} className="seg-btn" lang={id} title={name} aria-label={name} aria-pressed={lang === id}
                onClick={() => setLang(id)}>
          {short}
        </button>
      ))}
    </div>
  )
}
