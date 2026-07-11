import { useState, type ReactNode } from 'react'
import { PageHeader, Segmented, type SegmentedOption } from '../ui'
import Dictionary from './Dictionary'
import Replacements from './Replacements'
import Rules from './Rules'
import Snippets from './Snippets'

type SubTab = 'words' | 'swaps' | 'snippets' | 'rules'

const SUB_TABS: SegmentedOption<SubTab>[] = [
  { value: 'words', label: 'Words' },
  { value: 'swaps', label: 'Swaps' },
  { value: 'snippets', label: 'Snippets' },
  { value: 'rules', label: 'AI Rules' }
]

/**
 * Personalization — groups Dictionary (Words), Replacements (Swaps),
 * Snippets, and Rules (AI Rules) behind one sidebar item with a segmented
 * sub-nav (IA-1/IA-3, UI-OVERHAUL-PLAN.md). All four pages stay mounted;
 * switching sub-tabs only toggles `hidden` so no page re-fetches or replays
 * its entry animation (the same no-remount rule App.tsx applies to its own
 * tabs — v1 C5).
 */
export default function Personalization(): ReactNode {
  const [tab, setTab] = useState<SubTab>('words')

  return (
    <div>
      <PageHeader
        title="Personalization"
        subtitle="Teach the app how to hear and shape your words."
      />

      <div className="mb-6">
        <Segmented aria-label="Personalization section" options={SUB_TABS} value={tab} onChange={setTab} />
      </div>

      <section hidden={tab !== 'words'}>
        <Dictionary />
      </section>
      <section hidden={tab !== 'swaps'}>
        <Replacements />
      </section>
      <section hidden={tab !== 'snippets'}>
        <Snippets />
      </section>
      <section hidden={tab !== 'rules'}>
        <Rules />
      </section>
    </div>
  )
}
