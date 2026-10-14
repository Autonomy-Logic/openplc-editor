import { type KeyboardEvent, useEffect, useState } from 'react'

import type { MqttProjectIssue } from '../../../../../../utils/mqtt/project/validate'

export const inputClass =
  'h-[30px] w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption text-xs font-medium text-neutral-850 outline-none focus:border-brand-medium-dark disabled:opacity-50 dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

export const textareaClass =
  'w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-mono text-xs text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'

export const labelClass = 'font-caption text-xs font-medium text-neutral-950 dark:text-white'

export const hintClass = 'font-caption text-cp-xs text-neutral-600 dark:text-neutral-400'

export const buttonClass =
  'h-7 rounded-md border border-neutral-300 bg-white px-3 font-caption text-xs font-medium text-neutral-1000 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800'

export const primaryButtonClass =
  'h-7 rounded-md bg-brand px-3 font-caption text-xs font-medium text-white hover:bg-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50'

const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === 'Enter') event.currentTarget.blur()
}

interface TextFieldProps {
  id: string
  label: string
  value: string
  onCommit: (value: string) => void
  placeholder?: string
  hint?: string
}

/** Text input that writes to the model on blur or Enter, and only when the value changed. */
export const TextField = ({ id, label, value, onCommit, placeholder, hint }: TextFieldProps) => {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <div className='flex flex-col gap-1'>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        type='text'
        autoComplete='off'
        spellCheck={false}
        className={inputClass}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft)
        }}
        onKeyDown={commitOnEnter}
      />
      {hint !== undefined && <span className={hintClass}>{hint}</span>}
    </div>
  )
}

const WHOLE_NUMBER = /^-?\d{1,9}$/

interface IntegerFieldProps {
  id: string
  label: string
  value: number
  onCommit: (value: number) => void
  hint?: string
}

/** Integer input; text that is not a whole number stays local and is never written to the model. */
export const IntegerField = ({ id, label, value, onCommit, hint }: IntegerFieldProps) => {
  const [draft, setDraft] = useState(String(value))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    setDraft(String(value))
    setInvalid(false)
  }, [value])
  const errorId = `${id}-error`
  return (
    <div className='flex flex-col gap-1'>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        type='text'
        inputMode='numeric'
        autoComplete='off'
        className={inputClass}
        value={draft}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const text = draft.trim()
          if (!WHOLE_NUMBER.test(text)) {
            setInvalid(true)
            return
          }
          setInvalid(false)
          const next = Number(text)
          if (next !== value) onCommit(next)
        }}
        onKeyDown={commitOnEnter}
      />
      {invalid && (
        <span id={errorId} role='alert' className='font-caption text-cp-xs text-red-500'>
          Enter a whole number.
        </span>
      )}
      {hint !== undefined && <span className={hintClass}>{hint}</span>}
    </div>
  )
}

interface IssueListProps {
  issues: readonly MqttProjectIssue[]
  label: string
}

/** Issues rendered as plain text; names and messages are data, never markup. */
export const IssueList = ({ issues, label }: IssueListProps) => {
  if (issues.length === 0) return null
  return (
    <ul
      aria-label={label}
      className='flex flex-col gap-1 rounded-md border border-red-300 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/40'
    >
      {issues.map((issue) => (
        <li
          key={`${issue.code}:${issue.pointer}`}
          className='font-caption text-xs text-red-700 dark:text-red-300'
          data-issue-code={issue.code}
        >
          {issue.message}
          <span className='ml-1 text-cp-xs text-red-500 opacity-80'>
            ({issue.code}
            {issue.detail !== undefined ? `: ${issue.detail}` : ''})
          </span>
        </li>
      ))}
    </ul>
  )
}
