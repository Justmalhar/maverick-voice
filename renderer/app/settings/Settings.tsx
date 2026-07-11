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

/**
 * Anchor targets for the section nav below — must match each section's
 * `SectionCard` `id` (already set with `scroll-mt-6`, SET-1/A11Y-2) and
 * stay in the same order the sections render in.
 */
const SECTION_NAV: { id: string; label: string }[] = [
  { id: 'stt-provider', label: 'Speech to text' },
  { id: 'llm-provider', label: 'AI model' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'audio', label: 'Audio' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'help', label: 'Help' }
]

/** Thin composer — each section owns its own IPC + local state (INTERFACES.md). */
export default function Settings({ onReplayOnboarding }: { onReplayOnboarding: () => void }): ReactNode {
  return (
    <div>
      <PageHeader title="Settings" />

      {/* Sticky jump-nav to the 10 sections below (SET-1/A11Y-2) — plain
          anchor links, no section rewrites; scroll targets already exist
          via SectionCard's id + scroll-mt-6. */}
      <nav
        aria-label="Settings sections"
        className="sticky top-0 z-10 mb-6 flex flex-wrap gap-1 border-b border-stroke bg-surface-page py-2"
      >
        {SECTION_NAV.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-full px-3 py-1.5 text-[11px] font-medium text-ink-muted transition-colors hover:bg-surface-veil hover:text-ink"
          >
            {s.label}
          </a>
        ))}
      </nav>

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
