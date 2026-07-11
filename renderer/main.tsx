import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './theme/ThemeProvider'
import './styles.css'

const App = lazy(() => import('./app/App'))
const WidgetApp = lazy(() => import('./widget/WidgetApp'))

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
    <ThemeProvider>
      <Suspense fallback={null}>{isWidget ? <WidgetApp /> : <App />}</Suspense>
    </ThemeProvider>
  </StrictMode>
)
