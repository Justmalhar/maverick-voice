import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import WidgetApp from './widget/WidgetApp'
import { initTheme } from './theme'
import './styles.css'

// windowManager loads the HUD window at `index.html#/widget`; the main window
// loads `index.html` with no hash. Route on the hash so a single bundle serves
// both surfaces.
const hash = window.location.hash
const isWidget = hash === '#/widget'

// Theme is a DASHBOARD-only concern: read the persisted preference, apply it to
// <html>, and attach the live OS-theme listener when set to 'system'. The HUD
// widget window forces its own data-theme='dark' (see WidgetApp) and must NOT
// follow the dashboard theme, so we skip initTheme entirely for that surface.
if (!isWidget) {
  initTheme()
}

function RootApp() {
  if (isWidget) return <WidgetApp />
  return <App />
}

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <RootApp />
  </StrictMode>
)
