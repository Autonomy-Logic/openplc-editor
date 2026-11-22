import { LADDER_TYPOGRAPHY, ladderSymbol, type LadderSymbolKind } from '@root/middleware/shared/utils/ladder-layout'

/** Stroke width of a contact or coil symbol, and of one drawn in the energized colour. */
const SYMBOL_STROKE = { normal: 1.4, on: 2 } as const

/** Rise of a symbol letter's baseline below the symbol's centre line, per px of its size. */
const LETTER_BASELINE = 0.36

/** How far inside a contact or coil box, from either side, the rung wire runs on to meet the symbol. */
export function ladderSymbolInset(kind: LadderSymbolKind): number {
  return ladderSymbol(kind).wireInset
}

/** A contact or coil symbol from its engine geometry, stroked in `stroke`; its S/R/P/N letter filled the same. */
export function LadderSymbolGlyph({
  kind,
  stroke,
  energized,
}: {
  kind: LadderSymbolKind
  stroke: string
  energized: boolean
}) {
  const symbol = ladderSymbol(kind)
  const strokeWidth = energized ? SYMBOL_STROKE.on : SYMBOL_STROKE.normal
  return (
    <svg width={symbol.width} height={symbol.height} style={{ display: 'block', overflow: 'visible' }}>
      {symbol.paths.map((d) => (
        <path key={d} d={d} stroke={stroke} strokeWidth={strokeWidth} fill='none' />
      ))}
      {symbol.lines.map((line) => (
        <line key={`${line.x1},${line.y1},${line.x2},${line.y2}`} {...line} stroke={stroke} strokeWidth={strokeWidth} />
      ))}
      {symbol.glyphText !== undefined && (
        <text
          x={symbol.width / 2}
          y={symbol.height / 2 + symbol.glyphText.sizePx * LETTER_BASELINE}
          fill={stroke}
          fontFamily={LADDER_TYPOGRAPHY.family}
          fontSize={symbol.glyphText.sizePx}
          fontWeight={700}
          textAnchor='middle'
          style={{ pointerEvents: 'none' }}
        >
          {symbol.glyphText.text}
        </text>
      )}
    </svg>
  )
}
