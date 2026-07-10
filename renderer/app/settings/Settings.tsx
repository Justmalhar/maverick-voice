import type { ReactNode } from 'react'
import { PageHeader } from '../../ui'
import AdvancedSection from './AdvancedSection'
import AppearanceSection from './AppearanceSection'
import AudioSection from './AudioSection'
import BehaviorSection from './BehaviorSection'
import HelpSection from './HelpSection'
import PermissionsSection from './PermissionsSection'
import PrivacySection from './PrivacySection'
import LlmProviderSection from './LlmProviderSection'
import ShortcutsSection from './ShortcutsSection'
import SttProviderSection from './SttProviderSection'

/** Thin composer — each section owns its own IPC + local state (INTERFACES.md). */
export default function Settings({ onReplayOnboarding }: { onReplayOnboarding: () => void }): ReactNode {
  return (
    <div>
      <PageHeader title="Settings" />
      <SttProviderSection />
      <LlmProviderSection />
      <ShortcutsSection />
      <AudioSection />
      <BehaviorSection />
      <AppearanceSection />
      <PermissionsSection />
      <AdvancedSection />
      <PrivacySection />
      <HelpSection onReplayOnboarding={onReplayOnboarding} />
    </div>
  )
}
