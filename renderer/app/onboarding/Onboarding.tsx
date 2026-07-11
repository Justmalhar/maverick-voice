import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { KeyCapability, PermissionsReport } from '../../../shared/types'
import { IS_LINUX, IS_MAC, IS_WIN, LoadingDots } from '../../ui'
import {
  HowItWorksStep,
  MicStep,
  PrivacyStep,
  ProviderKeysStep,
  ReadyStep,
  ShortcutsStep,
  SystemPermissionsStep,
  WelcomeStep
} from './steps'

type StepId =
  | 'welcome'
  | 'how-it-works'
  | 'privacy'
  | 'provider-keys'
  | 'mic'
  | 'system-permissions'
  | 'shortcuts'
  | 'ready'

const STEP_ORDER: StepId[] = [
  'welcome',
  'how-it-works',
  'privacy',
  'provider-keys',
  'mic',
  'system-permissions',
  'shortcuts',
  'ready'
]

/** win32 auto-skips (accessibility/inputMonitoring auto-granted there); darwin
 * skips once both are granted; linux skips unless on Wayland (X11 + xdotool
 * needs no extra grant — the Wayland case gets a notice-only step instead). */
function skipSystemPermissions(report: PermissionsReport): boolean {
  if (IS_WIN) return true
  if (IS_MAC) return report.accessibility && report.inputMonitoring
  if (IS_LINUX) return report.linux?.sessionType !== 'wayland'
  return true
}

export default function Onboarding({ onComplete }: { onComplete: () => void }): ReactNode {
  const [report, setReport] = useState<PermissionsReport | null>(null)
  const [capability, setCapability] = useState<KeyCapability | null>(null)
  const [stepIndex, setStepIndex] = useState(0)

  function refreshReport(): void {
    window.electronAPI.permissionsPreflight().then(setReport).catch(() => {})
  }

  useEffect(() => {
    refreshReport()
    window.electronAPI.getKeyCapability().then(setCapability).catch(() => {})
    window.addEventListener('focus', refreshReport)
    return () => window.removeEventListener('focus', refreshReport)
  }, [])

  const activeSteps = useMemo<StepId[]>(() => {
    if (!report) return STEP_ORDER
    return STEP_ORDER.filter((id) => id !== 'system-permissions' || !skipSystemPermissions(report))
  }, [report])

  useEffect(() => {
    if (stepIndex > activeSteps.length - 1) setStepIndex(Math.max(0, activeSteps.length - 1))
  }, [activeSteps, stepIndex])

  if (!report || !capability) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-page">
        <LoadingDots label="Preparing setup" />
      </div>
    )
  }

  const stepId = activeSteps[stepIndex]
  const isFirst = stepIndex === 0
  const isLast = stepIndex === activeSteps.length - 1

  function next(): void {
    if (isLast) onComplete()
    else setStepIndex((i) => i + 1)
  }
  function back(): void {
    if (!isFirst) setStepIndex((i) => i - 1)
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface-page text-ink">
      <div className="flex gap-1.5 px-10 pt-10" aria-hidden="true">
        {activeSteps.map((id, i) => (
          <div key={id} className="h-[3px] flex-1 origin-left overflow-hidden rounded-full bg-surface-veil">
            <div
              className={`h-full origin-left rounded-full bg-ink-strong transition-transform duration-500 ease-out ${
                i <= stepIndex ? 'scale-x-100' : 'scale-x-0'
              }`}
            />
          </div>
        ))}
      </div>
      <p className="px-10 pt-4 text-[11px] font-medium text-ink-muted">
        {stepIndex + 1} of {activeSteps.length}
      </p>

      <div className="flex min-h-[420px] flex-1 justify-center overflow-y-auto overflow-x-hidden px-10 py-6">
        {stepId === 'welcome' && <WelcomeStep />}
        {stepId === 'how-it-works' && <HowItWorksStep />}
        {stepId === 'privacy' && <PrivacyStep />}
        {stepId === 'provider-keys' && <ProviderKeysStep />}
        {stepId === 'mic' && <MicStep report={report} onChange={refreshReport} />}
        {stepId === 'system-permissions' && <SystemPermissionsStep report={report} onChange={refreshReport} />}
        {stepId === 'shortcuts' && <ShortcutsStep capability={capability} />}
        {stepId === 'ready' && <ReadyStep capability={capability} />}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-stroke px-10 py-5">
        <div className="flex flex-1 justify-start">
          <button
            type="button"
            onClick={back}
            className={`btn-raised rounded-full px-6 py-3 text-[13px] ${isFirst ? 'invisible pointer-events-none' : ''}`}
            aria-hidden={isFirst}
            tabIndex={isFirst ? -1 : 0}
          >
            Back
          </button>
        </div>

        <div className="flex flex-1 justify-end">
          <button
            type="button"
            onClick={next}
            className="btn-raised rounded-full px-8 py-3 text-[13px] font-semibold text-ink-strong"
          >
            {isLast ? 'Get started' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
