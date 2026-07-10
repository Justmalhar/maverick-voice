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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <Suspense fallback={null}>{isWidget ? <WidgetApp /> : <App />}</Suspense>
    </ThemeProvider>
  </StrictMode>
)
