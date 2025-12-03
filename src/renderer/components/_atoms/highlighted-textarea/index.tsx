import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import type { ChangeEvent, ComponentPropsWithRef, UIEvent } from 'react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

import { HighlightedText } from '../highlighted-text'

type HighlightedTextAreaProps = ComponentPropsWithRef<'textarea'> & {
  textAreaValue: string
  setTextAreaValue: (value: string) => void
  handleSubmit?: () => void
  submitWith?: {
    enter: boolean
  }
  inputHeight?: {
    scrollLimiter: number
    height: number
  }
  textAreaClassName?: string
  highlightClassName?: string
  scrollableIndicator?: boolean
  scrollableIndicatorClassName?: string
}

const HighlightedTextArea = forwardRef<HTMLTextAreaElement, HighlightedTextAreaProps>(
  (
    {
      textAreaClassName,
      highlightClassName,
      scrollableIndicator = true,
      scrollableIndicatorClassName,
      placeholder,
      textAreaValue,
      setTextAreaValue,
      handleSubmit,
      submitWith = {
        enter: true,
      },
      inputHeight,
      ...props
    }: HighlightedTextAreaProps,
    ref,
  ) => {
    const { searchQuery } = useOpenPLCStore()

    const inputRef = useRef<HTMLTextAreaElement>(null)
    const scrollableIndicatorRef = useRef<HTMLDivElement>(null)
    const highlightDivRef = useRef<HTMLDivElement>(null)

    const [inputFocus, setInputFocus] = useState<boolean>(false)
    const [canSubmit, setCanSubmit] = useState<boolean>(true)
    const [scrollValue, setScrollValue] = useState<number>(0)

    // @ts-expect-error - not all properties are used
    useImperativeHandle(ref, () => {
      return {
        focus: () => {
          inputRef.current?.focus()
          setInputFocus(true)
        },
        isFocused: inputFocus,
        blur: ({ submit }: { submit?: boolean }) => {
          if (submit !== undefined) {
            setCanSubmit(submit)
          }
          setInputFocus(false)
        },
        scrollHeight: textAreaValue.length === 0 ? 0 : inputRef.current?.scrollHeight,
      }
    }, [textAreaValue, inputRef, inputFocus])

    useEffect(() => {
      if (!inputFocus) inputRef.current?.blur()
    }, [inputFocus])

    useEffect(() => {
      if (inputRef?.current && highlightDivRef.current) {
        // height
        inputRef.current.style.height = 'auto'
        inputRef.current.style.height =
          inputHeight !== undefined
            ? `${inputRef.current.scrollHeight < inputHeight.scrollLimiter ? inputRef.current.scrollHeight : inputHeight.height}px`
            : `${inputRef.current.scrollHeight}px`
        highlightDivRef.current.style.height = 'auto'
        highlightDivRef.current.style.height = inputRef.current.style.height

        // scrollable indicator
        if (scrollableIndicatorRef.current && inputHeight) {
          scrollableIndicatorRef.current.style.display =
            inputRef.current.scrollHeight > inputHeight.scrollLimiter ? 'block' : 'none'
        }
      }
    }, [textAreaValue, inputHeight])

    useEffect(() => {
      if (highlightDivRef.current) {
        highlightDivRef.current.scrollTop = scrollValue
      }
    }, [scrollValue])

    const onChangeHandler = (e: ChangeEvent<HTMLTextAreaElement>) => {
      setTextAreaValue(e.target.value)
      if (props.onChange) props.onChange(e)
    }

    const onScrollHandler = (e: UIEvent<HTMLTextAreaElement>) => {
      setScrollValue(e.currentTarget.scrollTop)
    }

    return (
      <div
        className='[&::-webkit-text-size-adjust]:none relative h-full w-full'
        aria-label={props['aria-label'] ?? 'HighlightedTextArea'}
      >
        <div
          className={cn(
            'pointer-events-none absolute -z-10 w-full overflow-y-scroll',
            'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            scrollableIndicator ? '[&::-webkit-scrollbar]:hidden' : '',
            highlightClassName,
          )}
          ref={highlightDivRef}
        >
          <HighlightedText
            text={textAreaValue}
            searchQuery={searchQuery}
            className={cn('w-full whitespace-pre-wrap break-words text-transparent')}
          />
        </div>
        <textarea
          value={textAreaValue}
          onChange={onChangeHandler}
          placeholder={placeholder ?? '???'}
          className={cn(
            'absolute w-full resize-none bg-transparent outline-none',
            'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            scrollableIndicator ? '[&::-webkit-scrollbar]:hidden' : '',
            textAreaClassName,
          )}
          onFocus={(e) => {
            setInputFocus(true)
            props.onFocus?.(e)
          }}
          onBlur={(e) => {
            if (inputRef.current && highlightDivRef.current) {
              inputRef.current.scrollTop = 0
              highlightDivRef.current.scrollTop = 0
            }
            props.onBlur?.(e)
            if (canSubmit && handleSubmit) handleSubmit()
            setCanSubmit(true)
          }}
          onScroll={(e) => onScrollHandler(e)}
          onKeyDown={(e) => {
            if (props.onKeyDown) {
              props.onKeyDown(e)
            }
            if (submitWith.enter && e.key === 'Enter') {
              setInputFocus(false)
            }
          }}
          onKeyUp={props.onKeyUp}
          ref={inputRef}
          rows={1}
          spellCheck={false}
        />
        {scrollableIndicator && (
          <div
            className={cn(
              'pointer-events-none absolute top-1/2 hidden -translate-y-1/2 text-cp-sm',
              scrollableIndicatorClassName ? scrollableIndicatorClassName : '-right-2',
            )}
            ref={scrollableIndicatorRef}
          >
            ↕
          </div>
        )}
      </div>
    )
  },
)

export { HighlightedTextArea }
