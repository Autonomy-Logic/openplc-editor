import {
  aliasTooltip,
  type LabelBox,
  LADDER_TYPOGRAPHY,
  type LadderLabelSource,
  type LadderPalette,
  resolveLocationLabel,
  textWidthPx,
} from '@root/middleware/shared/utils/ladder-layout'
import { type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode, useRef } from 'react'

import { useOpenPLCStore } from '../../../../store'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../tooltip'

const OVERLAY_STYLE: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  overflow: 'visible',
  pointerEvents: 'none',
}

/** Horizontal room an editing field keeps around its text, in px. */
const FIELD_PADDING = 8

/** Props of one drawn ladder label. */
export interface LadderTextProps {
  label: LabelBox
  text?: string
  fill: string
  testId?: string
  fontWeight?: number
  /** Draws the text only while the pointer is over it. */
  hoverOnly?: boolean
  onClick?: (event: MouseEvent<SVGTextElement>) => void
}

/** The SVG attributes that draw `label`'s text in the ladder typography. */
function textAttributes(label: LabelBox, fill: string, fontWeight: number | undefined) {
  return {
    x: label.x,
    y: label.y,
    fill,
    fontFamily: LADDER_TYPOGRAPHY.family,
    fontSize: label.sizePx,
    fontWeight: fontWeight ?? label.weight,
    textAnchor: label.anchor,
  }
}

/** An SVG layer at the node origin that draws outside the node box. */
export function LadderTextLayer({ children }: { children: ReactNode }) {
  return (
    <svg width={1} height={1} style={OVERLAY_STYLE}>
      {children}
    </svg>
  )
}

/** The [start, end) code-unit ranges of every case-insensitive occurrence of `query` in `text`. */
export function searchMatchRanges(text: string, query: string): Array<[number, number]> {
  if (query === '') return []
  const ranges: Array<[number, number]> = []
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    ranges.push([at, at + needle.length])
  }
  return ranges
}

/** Rectangles behind the project-search matches in `text` drawn on `label`. */
function SearchHighlights({ label, text }: { label: LabelBox; text: string }) {
  const searchQuery = useOpenPLCStore((state) => state.searchQuery)
  const ranges = searchMatchRanges(text, searchQuery)
  if (ranges.length === 0) return null
  const left = anchoredLeft(label, textWidthPx(text, label.sizePx))
  return (
    <>
      {ranges.map(([start, end]) => (
        <rect
          key={start}
          data-testid='ld-search-highlight'
          className='fill-brand-light dark:fill-brand-medium-dark'
          rx={2}
          x={left + textWidthPx(text.slice(0, start), label.sizePx)}
          y={label.y - label.sizePx * 0.85}
          width={textWidthPx(text.slice(start, end), label.sizePx)}
          height={label.sizePx * 1.1}
        />
      ))}
    </>
  )
}

/** One label drawn as SVG text content at its baseline, in node coordinates; never as markup. */
export function LadderText({ label, text, fill, testId, fontWeight, hoverOnly = false, onClick }: LadderTextProps) {
  return (
    <LadderTextLayer>
      {!hoverOnly && <SearchHighlights label={label} text={text ?? label.text} />}
      <text
        {...textAttributes(label, fill, fontWeight)}
        className={hoverOnly ? 'opacity-0 hover:opacity-100' : undefined}
        data-testid={testId}
        onClick={onClick}
        style={{ whiteSpace: 'pre', pointerEvents: onClick ? 'auto' : 'none', cursor: onClick ? 'text' : undefined }}
      >
        {text ?? label.text}
      </text>
    </LadderTextLayer>
  )
}

/** A location label: the address or alias text, and for an alias the tooltip `"<alias> -> <address>"`. */
export function LadderLocationText({
  label,
  variableName,
  labelSource,
  fill,
  testId,
}: {
  label: LabelBox
  variableName: string
  labelSource: LadderLabelSource
  fill: string
  testId: string
}) {
  const getAliasIndex = useOpenPLCStore((state) => state.projectActions.getAliasIndex)
  const location = resolveLocationLabel(variableName, labelSource)
  if (location.kind !== 'alias') return <LadderText label={label} fill={fill} testId={testId} />

  return (
    <LadderTextLayer>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <text
              {...textAttributes(label, fill, undefined)}
              data-testid={testId}
              style={{ whiteSpace: 'pre', pointerEvents: 'auto' }}
            >
              {label.text}
            </text>
          </TooltipTrigger>
          <TooltipContent side='top' className='p-1 text-xs' arrow={false}>
            {aliasTooltip(location, getAliasIndex())}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </LadderTextLayer>
  )
}

/** Props of an editable one-line ladder name. */
export interface LadderNameFieldProps {
  label: LabelBox
  text: string
  testId: string
  palette: LadderPalette
  fill: string
  placeholder?: string
  /** Shows the placeholder of an empty name only while the pointer is over it. */
  placeholderOnHover?: boolean
  fontWeight?: number
  editable: boolean
  editing: boolean
  onEditingChange: (editing: boolean) => void
  value: string
  onValueChange: (value: string) => void
  onCommit: (value: string) => void
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void
  onBlur?: () => void
  /** Returns true when it handled the key and the field must close without committing. */
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => boolean
  onKeyUp?: () => void
  /** Drawn under the field while it is open, such as the autocomplete. */
  children?: ReactNode
}

/** The left edge of a box of `width` placed on `label`'s anchor. */
function anchoredLeft(label: LabelBox, width: number): number {
  switch (label.anchor) {
    case 'start':
      return label.x
    case 'middle':
      return label.x - width / 2
    case 'end':
      return label.x - width
    default: {
      const unreachable: never = label.anchor
      return unreachable
    }
  }
}

/**
 * A ladder name: its text, and once clicked a single-line field that widens with the typed text. Blur and Enter
 * commit; there is no wrap and no length cap.
 */
export function LadderNameField({
  label,
  text,
  testId,
  palette,
  fill,
  placeholder = '???',
  placeholderOnHover = false,
  fontWeight,
  editable,
  editing,
  onEditingChange,
  value,
  onValueChange,
  onCommit,
  onFocus,
  onBlur,
  onKeyDown,
  onKeyUp,
  children,
}: LadderNameFieldProps) {
  const skipCommit = useRef(false)
  const shown = text === '' ? placeholder : text
  const width = Math.max(textWidthPx(value, label.sizePx), textWidthPx(placeholder, label.sizePx)) + FIELD_PADDING
  const height = Math.ceil(label.sizePx * 1.4)

  const open = () => {
    if (!editable) return
    onValueChange(text)
    onEditingChange(true)
  }

  return (
    <>
      {editing ? (
        <input
          className='nodrag nopan absolute z-10 rounded-[2px] px-[3px] outline-none'
          data-testid={`${testId}-field`}
          autoFocus
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          style={{
            left: anchoredLeft(label, width),
            top: label.y - label.sizePx,
            width: `${width}px`,
            height,
            boxSizing: 'border-box',
            fontFamily: LADDER_TYPOGRAPHY.family,
            fontSize: label.sizePx,
            fontWeight: fontWeight ?? label.weight,
            textAlign: label.anchor === 'middle' ? 'center' : label.anchor === 'end' ? 'right' : 'left',
            color: palette.text,
            background: palette.bg,
            boxShadow: `0 0 0 1px ${palette.brand}`,
          }}
          onChange={(event) => onValueChange(event.target.value)}
          onFocus={(event) => {
            event.target.select()
            onFocus?.(event)
          }}
          onBlur={() => {
            onEditingChange(false)
            onBlur?.()
            if (!skipCommit.current) onCommit(value)
            skipCommit.current = false
          }}
          onKeyDown={(event) => {
            if (onKeyDown?.(event) === true) {
              skipCommit.current = true
              event.currentTarget.blur()
              return
            }
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          onKeyUp={onKeyUp}
        />
      ) : (
        <LadderText
          label={label}
          text={shown}
          fill={text === '' ? palette.muted : fill}
          fontWeight={fontWeight}
          hoverOnly={placeholderOnHover && text === ''}
          testId={testId}
          onClick={editable ? open : undefined}
        />
      )}
      {children !== undefined && (
        <div className='absolute' style={{ left: label.x, top: label.y + label.sizePx * 0.4 }}>
          {children}
        </div>
      )}
    </>
  )
}

/** The box around a node's glyph and its labels, in node coordinates, for the selection outline. */
export function labelsBounds(
  labels: readonly LabelBox[],
  box: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  let left = 0
  let top = 0
  let right = box.width
  let bottom = box.height
  for (const label of labels) {
    const width = textWidthPx(label.text, label.sizePx)
    const x = anchoredLeft(label, width)
    left = Math.min(left, x)
    right = Math.max(right, x + width)
    top = Math.min(top, label.y - label.sizePx)
    bottom = Math.max(bottom, label.y + label.sizePx * 0.3)
  }
  return { left, top, width: right - left, height: bottom - top }
}
