import { useOpenPLCStore } from '@root/renderer/store'
import { extractSearchQuery } from '@root/renderer/store/slices/search/utils'
import { cn } from '@root/utils'
import type { ChangeEvent, ComponentPropsWithRef, UIEvent } from 'react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

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
  scrollableIndicatorClassName?: string
}

const HighlightedTextArea = forwardRef<HTMLTextAreaElement, HighlightedTextAreaProps>(
  (
    {
      textAreaClassName,
      highlightClassName,
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
    const formattedVariableValue = searchQuery ? extractSearchQuery(textAreaValue, searchQuery) : textAreaValue

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
    }, [textAreaValue])

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
      <div className='[&::-webkit-text-size-adjust]:none relative h-full w-full' aria-label={props['aria-label']}>
        <div
          className={cn(
            'pointer-events-none absolute -z-10 w-full overflow-y-scroll [&::-webkit-scrollbar]:hidden',
            'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            highlightClassName,
          )}
          ref={highlightDivRef}
        >
          <div
            className={cn('w-full whitespace-pre-wrap break-words text-transparent')}
            dangerouslySetInnerHTML={{ __html: formattedVariableValue }}
          />
        </div>
        <textarea
          value={textAreaValue}
          onChange={onChangeHandler}
          placeholder={placeholder ?? '???'}
          className={cn(
            'absolute w-full resize-none bg-transparent outline-none [&::-webkit-scrollbar]:hidden',
            'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
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
            if (canSubmit && handleSubmit) handleSubmit()
            props.onBlur?.(e)
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
        <div
          className={cn(
            'pointer-events-none absolute -right-2 top-1/2 hidden -translate-y-1/2 text-cp-sm',
            scrollableIndicatorClassName,
          )}
          ref={scrollableIndicatorRef}
        >
          ↕
        </div>
      </div>
    )
  },
)

export { HighlightedTextArea }
