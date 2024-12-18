import { useOpenPLCStore } from '@root/renderer/store'
import { extractSearchQuery } from '@root/renderer/store/slices/search/utils'
import { cn } from '@root/utils'
import type { ComponentPropsWithRef, UIEvent } from 'react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

type HighlightedTextAreaProps = ComponentPropsWithRef<'textarea'> & {
  textAreaValue: string
  setTextAreaValue: (value: string) => void
  handleSubmit?: () => void
  inputHeight?: {
    scrollLimiter: number
    height: number
  }
}

const HighlightedTextArea = forwardRef<HTMLTextAreaElement, HighlightedTextAreaProps>(
  (
    { className, textAreaValue, setTextAreaValue, handleSubmit, inputHeight, ..._props }: HighlightedTextAreaProps,
    ref,
  ) => {
    const { searchQuery } = useOpenPLCStore()

    const inputRef = useRef<HTMLTextAreaElement>(null)
    const scrollableIndicatorRef = useRef<HTMLDivElement>(null)
    const [inputFocus, setInputFocus] = useState<boolean>(true)

    const highlightDivRef = useRef<HTMLDivElement>(null)
    const [scrollValue, setScrollValue] = useState<number>(0)
    const formattedVariableValue = searchQuery ? extractSearchQuery(textAreaValue, searchQuery) : textAreaValue

    // @ts-expect-error - not all properties are used
    useImperativeHandle(ref, () => {
      return {
        focus: () => {
          inputRef.current?.focus()
        },
        blur: () => {
          inputRef.current?.blur()
        },
        scrollHeight: textAreaValue.length === 0 ? 0 : inputRef.current?.scrollHeight,
      }
    }, [textAreaValue, inputRef])

    useEffect(() => {
      if (inputRef?.current && highlightDivRef.current) {
        // height
        inputRef.current.style.height = 'auto'
        inputRef.current.style.height = inputHeight
          ? `${inputRef.current.scrollHeight < inputHeight.scrollLimiter ? inputRef.current.scrollHeight : inputHeight.height}px`
          : `${inputRef.current.scrollHeight}px`
        highlightDivRef.current.style.height = 'auto'
        highlightDivRef.current.style.height = inputRef.current.style.height

        // scrollable indicator
        if (scrollableIndicatorRef.current && inputHeight) {
          scrollableIndicatorRef.current.style.display =
            inputRef.current.scrollHeight > inputHeight.scrollLimiter ? 'block' : 'none'
          scrollableIndicatorRef.current.style.top = `${(inputHeight.height - 14) / 2}px`
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
              className={cn(
                'w-full whitespace-pre-wrap break-words text-center text-xs leading-3 text-transparent',
                className,
              )}
              dangerouslySetInnerHTML={{ __html: formattedVariableValue }}
            />
          </div>
          <textarea
            value={textAreaValue}
            onChange={(e) => setTextAreaValue(e.target.value)}
            placeholder='???'
            className={cn(
              'absolute w-full resize-none bg-transparent text-center text-xs leading-3 outline-none [&::-webkit-scrollbar]:hidden',
              className,
            )}
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
            ref={inputRef}
            rows={1}
            spellCheck={false}
          />
        </div>
        <div className={cn('pointer-events-none absolute -right-2 hidden text-cp-sm')} ref={scrollableIndicatorRef}>
          ↕
        </div>
      </div>
    )
  },
)

export { HighlightedTextArea }
