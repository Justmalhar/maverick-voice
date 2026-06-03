import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import WidgetApp from './widget/WidgetApp'
import './styles.css'

// windowManager loads the HUD window at `index.html#/widget`; the main window
// loads `index.html` with no hash. Route on the hash so a single bundle serves
// both surfaces.
const hash = window.location.hash

function RootApp() {
  if (hash === '#/widget') return <WidgetApp />
  return <App />
}

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <RootApp />
  </StrictMode>
)
