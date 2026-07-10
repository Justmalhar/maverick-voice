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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>{isWidget ? <WidgetApp /> : <App />}</ThemeProvider>
  </StrictMode>
)
