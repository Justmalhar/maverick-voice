import type { DictationKey } from '../../shared/types'

// Features explainer for the three voice modes. Static, monochrome black glass.
// Key badges use the `.kbd-3d` token. The dictation key is dynamic (reflecting
// the active binding); the instruction key defaults to Right Shift.

function dictationKeyLabel(key: DictationKey): string {
  switch (key) {
    case 'fn':
      return 'Fn'
    case 'right-option':
      return 'Right Opt'
    case 'right-ctrl':
      return 'Right Ctrl'
    case 'right-alt':
      return 'Right Alt'
    default:
      return 'Fn'
  }
}

interface VoiceProps {
  /** Active dictation key, reflected in the feature key badges. Defaults to 'fn'. */
  dictationKey?: DictationKey
}

export default function Voice({ dictationKey = 'fn' }: VoiceProps = {}) {
  const dictLabel = dictationKeyLabel(dictationKey)

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-display text-[24px] font-bold text-mv-text-primary tracking-tight">
          Features
        </h2>
        <p className="text-[11px] text-mv-text-muted mt-1.5">
          Three ways to turn your voice into text — hold or tap a key, speak, and it appears.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <FeatureCard
          icon={<DictationIcon />}
          title="Pure Dictation"
          description="Hold or tap your dictation key and speak. Your words are transcribed and pasted at the cursor verbatim — no AI rewriting, no quotes, just clean text."
        >
          <KeyRow>
            <kbd className="kbd-3d">{dictLabel}</kbd>
            <span className="text-[11px] text-mv-text-muted">speak, release / tap again</span>
          </KeyRow>
        </FeatureCard>

        <FeatureCard
          icon={<InstructionIcon />}
          title="AI Instruction"
          description="Select text anywhere, then trigger the instruction key and speak a command — 'make this formal', 'translate to Spanish', 'fix the grammar'. The AI transforms your selection and pastes the result."
        >
          <KeyRow>
            <kbd className="kbd-3d">Right Shift</kbd>
            <span className="text-[11px] text-mv-text-muted">speak a command</span>
          </KeyRow>
        </FeatureCard>

        <FeatureCard
          icon={<ChainIcon />}
          title="Dictate-to-Instruct"
          description="Chain the two: dictate raw content, then immediately follow with an instruction. Maverick Voice stitches the dictation and the command together so the AI shapes exactly what you just said."
        >
          <KeyRow>
            <kbd className="kbd-3d">{dictLabel}</kbd>
            <span className="text-[11px] text-mv-text-muted">then</span>
            <kbd className="kbd-3d">Right Shift</kbd>
          </KeyRow>
        </FeatureCard>
      </div>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  description,
  children
}: {
  icon: React.ReactNode
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <div className="mv-glass-card px-5 py-5">
      <div className="flex items-start gap-4">
        <span className="w-10 h-10 rounded-mv-md bg-mv-white-04 border border-mv-border flex items-center justify-center text-mv-text-secondary shrink-0">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-bold text-mv-text-primary tracking-tight">
            {title}
          </h3>
          <p className="text-[12px] text-mv-text-secondary leading-relaxed mt-1.5">
            {description}
          </p>
          {children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </div>
  )
}

function KeyRow({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 flex-wrap">{children}</div>
}

/* ─── Icons ─── */

function DictationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" />
      <line x1="8" y1="12" x2="8" y2="14.5" />
    </svg>
  )
}

function InstructionIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5l1.6 3.6 3.9.4-2.9 2.6.9 3.8L8 12.4 4.5 12.5l.9-3.8L2.5 6.1l3.9-.4L8 1.5z" />
    </svg>
  )
}

function ChainIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 9.5a2.5 2.5 0 0 1 0-3.5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5l-.75.75" />
      <path d="M9.5 6.5a2.5 2.5 0 0 1 0 3.5L8 11.5a2.5 2.5 0 0 1-3.5-3.5l.75-.75" />
    </svg>
  )
}
