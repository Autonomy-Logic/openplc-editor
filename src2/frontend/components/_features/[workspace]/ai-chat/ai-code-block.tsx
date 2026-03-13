import * as monaco from 'monaco-editor'
import { useCallback, useEffect, useRef, useState } from 'react'

type AICodeBlockProps = {
  code: string
  language?: string
  onInsertAtCursor?: (code: string) => void
}

export const AICodeBlock = ({ code, language, onInsertAtCursor }: AICodeBlockProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return

    const lang = language ?? 'st'
    monaco.editor
      .colorize(code, lang, { tabSize: 2 })
      .then((html) => {
        if (containerRef.current) {
          containerRef.current.innerHTML = html
        }
      })
      .catch(() => {
        if (containerRef.current) {
          containerRef.current.textContent = code
        }
      })
  }, [code, language])

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  return (
    <div className='group relative my-1 rounded-md border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900'>
      <div className='flex items-center justify-between px-3 py-1 text-[10px] text-neutral-500 dark:text-neutral-400'>
        <span>{language ?? 'st'}</span>
        <div className='flex gap-1'>
          <button
            onClick={() => void handleCopy()}
            className='rounded px-1.5 py-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700'
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          {onInsertAtCursor && (
            <button
              onClick={() => onInsertAtCursor(code)}
              className='rounded px-1.5 py-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700'
            >
              Insert
            </button>
          )}
        </div>
      </div>
      <div ref={containerRef} className='overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed' />
    </div>
  )
}
