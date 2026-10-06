import { createRoot } from 'react-dom/client'
import '@fontsource/barlow-semi-condensed/500.css'
import '@fontsource/barlow-semi-condensed/700.css'
import '@fontsource/source-sans-3/400.css'
import '@fontsource/source-sans-3/600.css'
import './styles.css'
import App from './App.jsx'

// No StrictMode: its double mount races drei's <Html> labels (each one is its own React root)
// under React 19 and drops a label in dev.
createRoot(document.getElementById('root')).render(<App />)
