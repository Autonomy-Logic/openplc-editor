import { useState } from 'react'

import type { ToolCall } from './ai-chat-turns'

type AIChatToolSummaryProps = {
  toolCalls: ToolCall[]
}

type GroupKey =
  | 'create_pou'
  | 'delete_pou'
  | 'update_pou_body'
  | 'create_variable'
  | 'update_variable'
  | 'delete_variable'
  | 'create_datatype'
  | 'update_datatype'
  | 'delete_datatype'
  | 'read_project_state'

const SUCCESS_GROUP_TITLE: Record<GroupKey, { singular: string; plural: string }> = {
  create_pou: { singular: 'POU created', plural: 'POUs created' },
  delete_pou: { singular: 'POU deleted', plural: 'POUs deleted' },
  update_pou_body: { singular: 'Body updated', plural: 'Bodies updated' },
  create_variable: { singular: 'Variable added', plural: 'Variables added' },
  update_variable: { singular: 'Variable updated', plural: 'Variables updated' },
  delete_variable: { singular: 'Variable deleted', plural: 'Variables deleted' },
  create_datatype: { singular: 'Data type created', plural: 'Data types created' },
  update_datatype: { singular: 'Data type updated', plural: 'Data types updated' },
  delete_datatype: { singular: 'Data type deleted', plural: 'Data types deleted' },
  read_project_state: { singular: 'Project inspection', plural: 'Project inspections' },
}

const GROUP_ORDER: GroupKey[] = [
  'create_pou',
  'delete_pou',
  'update_pou_body',
  'create_variable',
  'update_variable',
  'delete_variable',
  'create_datatype',
  'update_datatype',
  'delete_datatype',
  'read_project_state',
]

/**
 * Pull the user-meaningful target name (e.g. `TrafficLight_FB`) and an
 * optional detail (e.g. `BOOL`) out of a tool's input payload. Falls back to
 * the tool name itself when the schema doesn't expose anything friendlier.
 */
function describeToolCall(name: string, input: unknown): { target: string; detail: string | null } {
  const i = (input ?? {}) as Record<string, unknown>
  const s = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)
  switch (name) {
    case 'create_pou':
      return { target: s(i.name) ?? '?', detail: s(i.type) ?? null }
    case 'delete_pou':
    case 'update_pou_body':
      return { target: s(i.pouName) ?? '?', detail: null }
    case 'create_variable':
      return { target: s(i.name) ?? '?', detail: s(i.type) ?? null }
    case 'update_variable':
      return { target: s(i.newName) ?? s(i.currentName) ?? '?', detail: s(i.type) ?? null }
    case 'delete_variable':
      return { target: s(i.variableName) ?? '?', detail: null }
    case 'create_datatype':
      return { target: s(i.name) ?? '?', detail: s(i.derivation) ?? null }
    case 'update_datatype':
      return { target: s(i.newName) ?? s(i.name) ?? '?', detail: null }
    case 'delete_datatype':
      return { target: s(i.name) ?? '?', detail: null }
    case 'read_project_state':
      return { target: 'project state', detail: null }
    default:
      return { target: name, detail: null }
  }
}

export const AIChatToolSummary = ({ toolCalls }: AIChatToolSummaryProps) => {
  const [open, setOpen] = useState(false)

  const completed = toolCalls.filter((c) => c.status !== 'pending')
  if (completed.length === 0) return null

  const errors = completed.filter((c) => c.status === 'error')
  const successes = completed.filter((c) => c.status === 'success')
  const successesByGroup = new Map<GroupKey, ToolCall[]>()
  for (const call of successes) {
    const key = (GROUP_ORDER as readonly string[]).includes(call.name) ? (call.name as GroupKey) : null
    if (!key) continue
    const bucket = successesByGroup.get(key)
    if (bucket) bucket.push(call)
    else successesByGroup.set(key, [call])
  }

  return (
    <div className='space-y-2 pt-1'>
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className='inline-flex w-fit items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[12px] text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-white/10 dark:bg-white/[0.06] dark:text-neutral-200 dark:hover:bg-white/[0.09]'
      >
        <CheckIcon className='text-green-500' />
        <span>
          {successes.length} {successes.length === 1 ? 'change' : 'changes'}
        </span>
        {errors.length > 0 && (
          <>
            <Dot />
            <span className='rounded-md border border-red-500/25 bg-red-500/10 px-1.5 py-px text-[10.5px] font-semibold text-red-600 dark:text-red-300'>
              {errors.length} failed
            </span>
          </>
        )}
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className='overflow-hidden rounded-[10px] border border-neutral-200 bg-neutral-50/60 dark:border-white/[0.06] dark:bg-white/[0.025]'>
          {errors.length > 0 && (
            <ToolGroup title='Failed' count={errors.length} accent='error'>
              {errors.map((call) => (
                <ToolRow key={call.id} call={call} />
              ))}
            </ToolGroup>
          )}
          {GROUP_ORDER.map((key) => {
            const calls = successesByGroup.get(key)
            if (!calls || calls.length === 0) return null
            const title = calls.length === 1 ? SUCCESS_GROUP_TITLE[key].singular : SUCCESS_GROUP_TITLE[key].plural
            return (
              <ToolGroup key={key} title={title} count={calls.length} accent='success'>
                {calls.map((call) => (
                  <ToolRow key={call.id} call={call} />
                ))}
              </ToolGroup>
            )
          })}
        </div>
      )}
    </div>
  )
}

type ToolGroupProps = {
  title: string
  count: number
  accent: 'success' | 'error'
  children: React.ReactNode
}

const ToolGroup = ({ title, count, accent, children }: ToolGroupProps) => (
  <div className='border-b border-neutral-200/70 last:border-b-0 dark:border-white/5'>
    <div className='flex items-center gap-2 border-b border-neutral-200/70 bg-neutral-100/60 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-neutral-500 dark:border-white/5 dark:bg-white/[0.02] dark:text-neutral-400'>
      <span
        aria-hidden
        className={`block h-1 w-1 rounded-full ${accent === 'error' ? 'bg-red-500' : 'bg-green-500'}`}
      />
      <span>{title}</span>
      <span className='opacity-55'>·</span>
      <span className='opacity-70'>{count}</span>
    </div>
    <div>{children}</div>
  </div>
)

const ToolRow = ({ call }: { call: ToolCall }) => {
  const isErr = call.status === 'error'
  const { target, detail } = describeToolCall(call.name, call.input)
  return (
    <div className='flex items-center gap-2.5 border-b border-neutral-200/70 px-3 py-1.5 text-[11.5px] last:border-b-0 dark:border-white/5'>
      {isErr ? <CrossIcon className='shrink-0 text-red-500' /> : <CheckIcon className='shrink-0 text-green-500' />}
      <code
        className={`font-mono text-[11px] ${
          isErr ? 'text-red-600 dark:text-red-300' : 'text-neutral-700 dark:text-neutral-200'
        }`}
      >
        {target}
      </code>
      {detail && (
        <span
          className={`text-[11px] ${isErr ? 'text-red-500/80 dark:text-red-300/80' : 'text-neutral-500 dark:text-neutral-400'}`}
        >
          {detail}
        </span>
      )}
    </div>
  )
}

const CheckIcon = ({ className }: { className?: string }) => (
  <svg
    width='12'
    height='12'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2.2'
    strokeLinecap='round'
    strokeLinejoin='round'
    className={className}
    aria-hidden
  >
    <path d='m5 12 5 5 9-11' />
  </svg>
)

const CrossIcon = ({ className }: { className?: string }) => (
  <svg
    width='11'
    height='11'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2.2'
    strokeLinecap='round'
    strokeLinejoin='round'
    className={className}
    aria-hidden
  >
    <path d='M18 6 6 18M6 6l12 12' />
  </svg>
)

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    width='10'
    height='10'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
    className={`text-neutral-500 transition-transform dark:text-neutral-400 ${open ? 'rotate-180' : ''}`}
    aria-hidden
  >
    <path d='m6 9 6 6 6-6' />
  </svg>
)

const Dot = () => (
  <span
    aria-hidden
    className='inline-block h-[3px] w-[3px] rounded-full bg-current opacity-55'
    style={{ margin: '0 2px' }}
  />
)
