import { useOpenPLCStore } from '@root/renderer/store'
import { extractSearchQuery } from '@root/renderer/store/slices/search/utils'
import { cn } from '@root/utils'
import type { ComponentPropsWithRef, UIEvent } from 'react'
import { forwardRef, useEffect, useRef, useState } from 'react'

type HighlightedTextAreaProps = ComponentPropsWithRef<'textarea'> & {
  textAreaValue: string
  setTextAreaValue: (value: string) => void
  handleSubmit?: () => void
  inputHeight?: {
    min: number
    max: number
  }
}

const HighlightedTextArea = forwardRef<HTMLTextAreaElement, HighlightedTextAreaProps>(
  ({ textAreaValue, setTextAreaValue, handleSubmit, inputHeight, ..._props }: HighlightedTextAreaProps, ref) => {
    const { searchQuery } = useOpenPLCStore()

    const inputRef = useRef<HTMLTextAreaElement>(null)
    const scrollableIndicatorRef = useRef<HTMLDivElement>(null)
    const [inputFocus, setInputFocus] = useState<boolean>(true)

    const highlightDivRef = useRef<HTMLDivElement>(null)
    const [scrollValue, setScrollValue] = useState<number>(0)
    const formattedVariableValue = searchQuery ? extractSearchQuery(textAreaValue, searchQuery) : textAreaValue

    useEffect(() => {
      if (inputRef.current && highlightDivRef.current) {
        // height
        inputRef.current.style.height = 'auto'
        inputRef.current.style.height = inputHeight
          ? `${inputRef.current.scrollHeight < inputHeight.max ? inputRef.current.scrollHeight : inputHeight.min}px`
          : `${inputRef.current.scrollHeight}px`
        highlightDivRef.current.style.height = 'auto'
        highlightDivRef.current.style.height = inputRef.current.style.height
        // scrollable indicator
        if (scrollableIndicatorRef.current) {
          scrollableIndicatorRef.current.style.display =
            inputHeight && inputRef.current.scrollHeight > 32 ? 'block' : 'none'
        }
      }
    }, [textAreaValue])

    useEffect(() => {
      if (highlightDivRef.current) {
        highlightDivRef.current.scrollTop = scrollValue
      }
    }, [scrollValue])

    const onScrollHandler = (e: UIEvent<HTMLTextAreaElement>) => {
      setScrollValue(e.currentTarget.scrollTop)
    }

    return (
      <div className='flex h-fit w-full items-center justify-center'>
        <div className='[&::-webkit-text-size-adjust]:none relative w-full'>
          <div
            className='-z-1 pointer-events-none absolute w-full overflow-y-scroll [&::-webkit-scrollbar]:hidden'
            ref={highlightDivRef}
          >
            <div
              className='w-full whitespace-pre-wrap break-words text-center text-xs leading-3 text-transparent'
              dangerouslySetInnerHTML={{ __html: formattedVariableValue }}
            />
          </div>
          <textarea
            value={textAreaValue}
            onChange={(e) => setTextAreaValue(e.target.value)}
            placeholder='???'
            className='absolute w-full resize-none bg-transparent text-center text-xs leading-3 outline-none [&::-webkit-scrollbar]:hidden'
            onFocus={() => setInputFocus(true)}
            onBlur={() => {
              if (inputRef.current && highlightDivRef.current) {
                inputRef.current.scrollTop = 0
                highlightDivRef.current.scrollTop = 0
              }
              inputFocus && handleSubmit && handleSubmit()
            }}
            onScroll={(e) => onScrollHandler(e)}
            onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.blur()}
            ref={ref}
            rows={1}
            spellCheck={false}
          />
        </div>
        <div className={cn('pointer-events-none absolute -right-3 text-cp-sm')} ref={scrollableIndicatorRef}>
          ↕
        </div>
      </div>
    )
  },
)

export { HighlightedTextArea }
