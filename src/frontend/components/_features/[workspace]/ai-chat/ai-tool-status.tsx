import type { ToolResult } from '../../../../services/ai/tools'

/**
 * Per-tool status entry retained on the slice for downstream gating (e.g. the
 * Keep / Undo bar in the chat panel). No longer rendered as a per-tool
 * activity log — the UI shows a single quiet "AI is working..." row instead.
 */
type ToolStatusEntry = {
  toolId: string
  toolName: string
  status: 'running' | 'success' | 'error'
  result?: ToolResult
}

export const AIToolStatus = () => (
  <div
    className='flex w-fit items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-[11.5px] text-neutral-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-400'
    role='status'
    aria-live='polite'
  >
    <span
      className='block h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent'
      aria-hidden
    />
    <span>AI is working&hellip;</span>
  </div>
)

export type { ToolStatusEntry }
