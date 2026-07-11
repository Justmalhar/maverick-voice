import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import { ThemeProvider } from './theme/ThemeProvider'
import WidgetApp from './widget/WidgetApp'
import './styles.css'

const isWidget = window.location.hash.startsWith('#/widget')
if (isWidget) {
  document.documentElement.classList.add('widget-body')
  document.body.classList.add('widget-body')
}

// Forward uncaught renderer errors into the daily log file (main process).
// Messages only — transcript/key content never reaches these handlers.
const surface = isWidget ? 'widget' : 'dashboard'
window.addEventListener('error', (e) => {
  window.electronAPI?.writeLog('error', `${surface}: ${e.message} (${e.filename}:${e.lineno})`)
})
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason instanceof Error ? e.reason.message : String(e.reason)
  window.electronAPI?.writeLog('error', `${surface}: unhandled rejection: ${reason}`)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>{isWidget ? <WidgetApp /> : <App />}</ThemeProvider>
  </StrictMode>
)
