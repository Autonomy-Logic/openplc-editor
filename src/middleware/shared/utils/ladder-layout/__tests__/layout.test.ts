/**
 * The compact LD layout: label-aware columns, location lines, block header and pin rows, parallel stacking, trailing
 * outputs, segments, and the stored geometry `applyRungLayout` writes.
 * @jest-environment node
 * @vitest-environment node
 */
import {
  ldPouNames,
  loadCorpusProject,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/corpus'
import {
  corpusLabelSource,
  corpusRungName,
  loadedRungs,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/relayout'
import {
  boolVariable,
  labelSource,
  type SeriesElement,
  seriesRung,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/rung-builder'
import { MAX_REDUCIBLE_ELEMENTS } from '@root/frontend/utils/PLC/xml-parser/language/series-parallel'
import type { PLCVariable, RungLadderState } from '@root/middleware/shared/ports/types'
import type { Node } from '@xyflow/react'

import { EMPTY_LABEL_SOURCE, type LadderLabelSource } from '../labels'
import { applyRungLayout, layoutRung, rungLayoutDiffers } from '../layout'
import { textWidthPx } from '../measure'
import { LADDER_STYLE, LADDER_TYPOGRAPHY } from '../style'
import type { LabelBox, NodeGeometry, RungLayout } from '../types'

const S = LADDER_STYLE
const NAME_PX = LADDER_TYPOGRAPHY.nameSizePx
const LOC_PX = LADDER_TYPOGRAPHY.locationSizePx
const FORMAL_PX = LADDER_TYPOGRAPHY.pinFormalSizePx

/** Width of a contact or coil column: the widest of name, location and glyph, plus a gap each side. */
const column = (name: string, location = ''): number =>
  Math.max(textWidthPx(name, NAME_PX), textWidthPx(location, LOC_PX), S.sym) + 2 * S.gap
/** Height above the main wire of a contact or coil: half glyph, label gap, location line, name line. */
const CC_TOP = S.symH / 2 + S.labGap + LOC_PX * 1.3 + NAME_PX * 1.25
/** Height below the main wire of a contact or coil (prototype `mCC`). */
const CC_BOTTOM = S.symH / 2 + 3
/** First pin row, measured from the top of a block box. */
const FIRST_ROW = S.blkHead + S.P / 2
/** Pin row pitch when the row's pin variable shows a location. */
const LOCATED_ROW = Math.ceil(NAME_PX * 1.2 + LOC_PX * 1.3 + 3)
/** Height of the instance-name line above a block. */
const INSTANCE_H = NAME_PX * 1.35
/** Left or right label column of a block whose widest pin variable text is `width` px. */
const sideColumn = (width: number): number => width + S.stub + 5

const ELEMENT_TYPES: ReadonlySet<string> = new Set(['contact', 'coil', 'block'])
const EPS = 1e-6

function geometry(layout: RungLayout, id: string): NodeGeometry {
  const found = layout.nodes.get(id)
  if (found === undefined) throw new Error(`layout of ${layout.rungId} has no geometry for ${id}`)
  return found
}

const centreX = (g: NodeGeometry): number => g.position.x + g.width / 2

function handle(g: NodeGeometry, id: string): { x: number; y: number } {
  const found = g.handles.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`no handle ${id}`)
  return { x: found.x, y: found.y }
}

function labels(layout: RungLayout, id: string): readonly LabelBox[] {
  return layout.labels.get(id) ?? []
}

function label(layout: RungLayout, id: string, role: LabelBox['role']): LabelBox {
  const found = labels(layout, id).find((candidate) => candidate.role === role && candidate.text !== '')
  if (found === undefined) throw new Error(`${id} has no ${role} label`)
  return found
}

/** Every non-empty label of the rung with the role and text given, whichever node carries it. */
function labelsWith(layout: RungLayout, role: LabelBox['role'], text: string): LabelBox[] {
  return [...layout.labels.values()].flat().filter((candidate) => candidate.role === role && candidate.text === text)
}

interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * The box a label's text covers, in the rung's canvas coordinates: its advance width from `textWidthPx`, placed by its
 * anchor, from 0.8 em above the baseline `y` to 0.2 em below it.
 */
function textRect(box: LabelBox): Rect {
  const width = textWidthPx(box.text, box.sizePx)
  const left = box.anchor === 'start' ? box.x : box.anchor === 'middle' ? box.x - width / 2 : box.x - width
  return { left, right: left + width, top: box.y - 0.8 * box.sizePx, bottom: box.y + 0.2 * box.sizePx }
}

function nodeRect(g: NodeGeometry): Rect {
  return { left: g.position.x, right: g.position.x + g.width, top: g.position.y, bottom: g.position.y + g.height }
}

const overlap = (a: Rect, b: Rect): boolean =>
  a.left < b.right - EPS && b.left < a.right - EPS && a.top < b.bottom - EPS && b.top < a.bottom - EPS

/** Every collision in a laid-out rung: element box with element box, label with label, label with another element. */
function collisions(rung: RungLadderState, layout: RungLayout): string[] {
  const elements = rung.nodes.filter((node) => ELEMENT_TYPES.has(node.type ?? ''))
  const boxes = elements.map((node) => ({ id: node.id, rect: nodeRect(geometry(layout, node.id)) }))
  const texts = [...layout.labels.entries()].flatMap(([id, list]) =>
    list.filter((box) => box.text !== '').map((box) => ({ id, box, rect: textRect(box) })),
  )
  const found: string[] = []
  boxes.forEach((a, i) =>
    boxes.slice(i + 1).forEach((b) => {
      if (overlap(a.rect, b.rect)) found.push(`box ${a.id} overlaps box ${b.id}`)
    }),
  )
  texts.forEach((a, i) =>
    texts.slice(i + 1).forEach((b) => {
      if (overlap(a.rect, b.rect))
        found.push(`label "${a.box.text}" (${a.id}) overlaps label "${b.box.text}" (${b.id})`)
    }),
  )
  for (const text of texts) {
    for (const box of boxes) {
      if (box.id !== text.id && overlap(text.rect, box.rect))
        found.push(`label "${text.box.text}" overlaps box ${box.id}`)
    }
  }
  return found
}

function nodeByName(rung: RungLadderState, name: string): Node {
  const found = rung.nodes.find((node) => {
    const variable: unknown = node.data.variable
    return (
      ELEMENT_TYPES.has(node.type ?? '') &&
      typeof variable === 'object' &&
      variable !== null &&
      'name' in variable &&
      variable.name === name
    )
  })
  if (found === undefined) throw new Error(`rung ${rung.id} has no element named ${name}`)
  return found
}

const contact = (id: string, name = id): SeriesElement => ({ kind: 'contact', id, name })
const coil = (id: string, name = id): SeriesElement => ({ kind: 'coil', id, name })
const ton = (id: string, instance: string, pins: Record<string, string>, typeName?: string): SeriesElement => ({
  kind: 'block',
  id,
  template: 'TON',
  instance,
  pins,
  ...(typeName === undefined ? {} : { typeName }),
})
const ctu = (id: string, instance: string, pins: Record<string, string>): SeriesElement => ({
  kind: 'block',
  id,
  template: 'CTU',
  instance,
  pins,
})

/** Ids of the contacts, coils and blocks among `ids`, in the order given. */
function elementIds(rung: RungLadderState, ids: readonly string[]): string[] {
  const elements = new Set(rung.nodes.filter((node) => ELEMENT_TYPES.has(node.type ?? '')).map((node) => node.id))
  return ids.filter((id) => elements.has(id))
}

const BDD20 = seriesRung('rung_bdd20', [
  contact('A'),
  contact('B'),
  contact('C'),
  ton('T1', 'Timer1', { PT: 'Preset', ET: 'Elapsed' }),
])
const SERIES = seriesRung('rung_series', [contact('A'), contact('B'), contact('C'), coil('M', 'Motor')])

describe('contacts and coils use the compact geometry (BDD-20, AC06)', () => {
  const layout = layoutRung(SERIES, EMPTY_LABEL_SOURCE)

  it('makes each contact and coil node the 22 x 14 glyph box, centred on the main wire', () => {
    for (const id of ['A', 'B', 'C', 'M']) {
      const g = geometry(layout, id)
      expect({ id, width: g.width, height: g.height, wireY: g.position.y + S.symH / 2 }).toEqual({
        id,
        width: 22,
        height: 14,
        wireY: layout.mainWireY,
      })
    }
  })

  it('keeps the input and output handles on the left and right box edges at the main wire', () => {
    for (const id of ['A', 'M']) {
      const g = geometry(layout, id)
      expect({ input: handle(g, 'input'), output: handle(g, 'output') }).toEqual({
        input: { x: 0, y: 7 },
        output: { x: 22, y: 7 },
      })
    }
  })

  it('places serial contacts with short names 24 px apart, glyph edge to glyph edge', () => {
    const [a, b, c] = ['A', 'B', 'C'].map((id) => geometry(layout, id))
    expect(b.position.x - (a.position.x + a.width)).toBeCloseTo(24, 6)
    expect(c.position.x - (b.position.x + b.width)).toBeCloseTo(24, 6)
  })

  it('sizes each column from its name: max(name, location, 22) + 2 * 12, glyphs centred in their columns', () => {
    const rung = seriesRung('rung_cols', [contact('a', 'Alpha'), contact('b', 'Bravo_12'), coil('c', 'Charlie')])
    const wide = layoutRung(rung, EMPTY_LABEL_SOURCE)
    const [a, b, c] = ['a', 'b', 'c'].map((id) => geometry(wide, id))
    expect(centreX(b) - centreX(a)).toBeCloseTo((column('Alpha') + column('Bravo_12')) / 2, 6)
    expect(centreX(c) - centreX(b)).toBeCloseTo((column('Bravo_12') + column('Charlie')) / 2, 6)
  })

  it('leaves 24 px between the labels of serial elements whose names are wider than the glyph', () => {
    const rung = seriesRung('rung_gap', [contact('a', 'Alpha'), contact('b', 'Bravo_12'), coil('c', 'Charlie')])
    const wide = layoutRung(rung, EMPTY_LABEL_SOURCE)
    const [a, b, c] = ['a', 'b', 'c'].map((id) => textRect(label(wide, id, 'name')))
    expect(b.left - a.right).toBeCloseTo(24, 6)
    expect(c.left - b.right).toBeCloseTo(24, 6)
  })

  it('centres each name over its glyph at 12 px, weight 400', () => {
    for (const id of ['A', 'M']) {
      const name = label(layout, id, 'name')
      expect({ x: name.x, anchor: name.anchor, sizePx: name.sizePx, weight: name.weight }).toEqual({
        x: centreX(geometry(layout, id)),
        anchor: 'middle',
        sizePx: 12,
        weight: 400,
      })
    }
  })

  it('puts the main wire padT below the tallest top extent and sizes the rung from both extents and paddings', () => {
    expect(layout.mainWireY).toBeCloseTo(S.padT + CC_TOP, 6)
    expect(layout.size.height).toBeCloseTo(S.padT + CC_TOP + CC_BOTTOM + S.padB, 6)
  })

  it('starts the left rail at x 0 and ends the natural width at the right rail', () => {
    const left = geometry(layout, 'left-rail-rung_series')
    const right = geometry(layout, 'right-rail-rung_series')
    const motor = geometry(layout, 'M')
    expect(left.position.x).toBe(0)
    expect(right.position.x + right.width).toBeCloseTo(layout.size.width, 6)
    expect(right.position.x).toBeGreaterThanOrEqual(centreX(motor) + column('Motor') / 2 - EPS)
  })
})

describe('location lines (BDD-16, AC05)', () => {
  const rung = seriesRung('rung_bdd16', [
    contact('start', 'Start'),
    contact('stop', 'Stop'),
    coil('motor', 'Motor'),
    ctu('timer', 'Timer1', { R: 'Start', PV: '10', CV: 'Count' }),
  ])
  const src = labelSource([
    boolVariable('Start', '%IX0.0'),
    boolVariable('Stop'),
    boolVariable('Motor', '%QX0.0'),
    boolVariable('Count'),
  ])
  const located = layoutRung(rung, src)

  it('reserves the location line on every contact and coil, so locations move no contact, coil or main wire', () => {
    const bare = layoutRung(rung, EMPTY_LABEL_SOURCE)
    expect(located.mainWireY).toBeCloseTo(bare.mainWireY, 6)
    for (const id of ['start', 'stop', 'motor']) expect(geometry(located, id)).toEqual(geometry(bare, id))
  })

  it('draws a contact or coil location at 10 px on the line between its name and its glyph', () => {
    for (const [id, text] of [
      ['start', '%IX0.0'],
      ['motor', '%QX0.0'],
    ] as const) {
      const name = label(located, id, 'name')
      const location = label(located, id, 'location')
      const glyphTop = geometry(located, id).position.y
      expect({ text: location.text, sizePx: location.sizePx, x: location.x }).toEqual({ text, sizePx: 10, x: name.x })
      expect(textRect(name).bottom).toBeLessThanOrEqual(textRect(location).top + EPS)
      expect(textRect(location).bottom).toBeLessThanOrEqual(glyphTop + EPS)
    }
  })

  it('gives "Stop" no location text and keeps the names "Start", "Stop" and "Motor" on one baseline', () => {
    expect(labels(located, 'stop').filter((box) => box.role === 'location' && box.text !== '')).toEqual([])
    const baselines = ['start', 'stop', 'motor'].map((id) => label(located, id, 'name').y)
    expect(new Set(baselines).size).toBe(1)
  })

  it('widens a column to a location wider than its name', () => {
    const narrow = seriesRung('rung_wideloc', [contact('x', 'X'), contact('y', 'Y')])
    const layout = layoutRung(narrow, labelSource([boolVariable('X', '%IX100.7'), boolVariable('Y')]))
    expect(centreX(geometry(layout, 'y')) - centreX(geometry(layout, 'x'))).toBeCloseTo(
      (column('X', '%IX100.7') + column('Y')) / 2,
      6,
    )
  })

  it('draws an alias verbatim and takes a VAR_EXTERNAL location from the resource global of that name', () => {
    const twoContacts = seriesRung('rung_alias', [contact('a', 'Run'), contact('e', 'Ext')])
    const layout = layoutRung(
      twoContacts,
      labelSource(
        [boolVariable('Run', 'Conveyor_Main_Run'), boolVariable('Ext', '', 'external')],
        [boolVariable('Ext', '%QX2.3', 'global')],
      ),
    )
    expect(label(layout, 'a', 'location').text).toBe('Conveyor_Main_Run')
    expect(label(layout, 'e', 'location').text).toBe('%QX2.3')
  })

  it('draws a pin variable name at 12 px on its pin wire and its location at 10 px on the line below', () => {
    const [name] = labelsWith(located, 'pinVariable', 'Start')
    expect(labels(located, 'timer:R').map((box) => [box.role, box.text])).toEqual([
      ['pinVariable', 'Start'],
      ['location', '%IX0.0'],
    ])
    const [location] = labelsWith(located, 'location', '%IX0.0').filter(
      (box) => box !== label(located, 'start', 'location'),
    )
    const block = geometry(located, 'timer')
    const rowY = block.position.y + handle(block, 'R').y
    expect(name.sizePx).toBe(12)
    expect({ sizePx: location.sizePx, x: location.x, anchor: location.anchor }).toEqual({
      sizePx: 10,
      x: name.x,
      anchor: name.anchor,
    })
    expect(textRect(name).top).toBeLessThan(rowY)
    expect(textRect(name).bottom).toBeGreaterThan(rowY)
    expect(textRect(location).top).toBeGreaterThanOrEqual(textRect(name).bottom - EPS)
    expect(textRect(name).right).toBeLessThanOrEqual(block.position.x + EPS)
  })

  it('grows a pin row whose pin variable shows a location, on either side, to ceil(12*1.2 + 10*1.3 + 3)', () => {
    const rowsOf = (layout: RungLayout): number[] => {
      const g = geometry(layout, 'timer')
      return ['CU', 'R', 'PV'].map((pin) => handle(g, pin).y)
    }
    const plain = rowsOf(layoutRung(rung, EMPTY_LABEL_SOURCE))
    const inputLocated = rowsOf(located)
    const outputLocated = rowsOf(layoutRung(rung, labelSource([boolVariable('Count', '%QW4')])))
    expect([plain[1] - plain[0], plain[2] - plain[1]]).toEqual([18, 18])
    expect([inputLocated[1] - inputLocated[0], inputLocated[2] - inputLocated[1]]).toEqual([18, LOCATED_ROW])
    expect([outputLocated[1] - outputLocated[0], outputLocated[2] - outputLocated[1]]).toEqual([18, LOCATED_ROW])
    expect(plain[0]).toBe(FIRST_ROW)
  })

  it('grows the block box with its rows: header, first half row, rows, last half row or located row, bottom pad', () => {
    expect(geometry(layoutRung(rung, EMPTY_LABEL_SOURCE), 'timer').height).toBeCloseTo(
      S.blkHead + S.P / 2 + 2 * S.P + S.P / 2 + S.blkBot,
      6,
    )
    expect(geometry(located, 'timer').height).toBeCloseTo(
      S.blkHead + S.P / 2 + S.P + LOCATED_ROW + S.P / 2 + S.blkBot,
      6,
    )
    const lastRow = seriesRung('rung_lastrow', [ctu('c', 'C0', { R: 'Reset', PV: 'Limit', CV: 'Count' })])
    const lastRowLocated = layoutRung(lastRow, labelSource([boolVariable('Limit', '%MW1')]))
    expect(geometry(lastRowLocated, 'c').height).toBeCloseTo(
      S.blkHead + S.P / 2 + 2 * S.P + (LOCATED_ROW - S.P / 2) + S.blkBot,
      6,
    )
  })

  it('lays out no label over another label or element', () => {
    expect(collisions(rung, located)).toEqual([])
  })
})

describe('blocks use the compact geometry (BDD-20, AC06)', () => {
  const layout = layoutRung(BDD20, EMPTY_LABEL_SOURCE)
  const block = geometry(layout, 'T1')
  const tonInner = Math.max(
    2 * S.blkPad + textWidthPx('IN', FORMAL_PX) + S.blkMid + textWidthPx('ET', FORMAL_PX),
    textWidthPx('TON', NAME_PX) + 2 * S.blkPad + 10,
  )

  it('sizes the TON box from its formal names and its two pin rows', () => {
    expect(block.width).toBeCloseTo(tonInner, 6)
    expect(block.height).toBeCloseTo(S.blkHead + S.P / 2 + S.P + S.P / 2 + S.blkBot, 6)
  })

  it('puts the first pin row blkHead + P/2 below the box top, on the main wire, and the next row 18 px below', () => {
    expect({
      IN: handle(block, 'IN'),
      PT: handle(block, 'PT'),
      Q: handle(block, 'Q'),
      ET: handle(block, 'ET'),
    }).toEqual({
      IN: { x: 0, y: FIRST_ROW },
      PT: { x: 0, y: FIRST_ROW + 18 },
      Q: { x: block.width, y: FIRST_ROW },
      ET: { x: block.width, y: FIRST_ROW + 18 },
    })
    expect(block.position.y + FIRST_ROW).toBeCloseTo(layout.mainWireY, 6)
  })

  it('places the box after the previous column, the block gap and the left label column', () => {
    const c = geometry(layout, 'C')
    const previousColumnEnd = centreX(c) + column('C') / 2
    expect(block.position.x - previousColumnEnd).toBeCloseTo(S.gapBlk + sideColumn(textWidthPx('Preset', NAME_PX)), 6)
  })

  it('counts the instance line in the top extent of the rung', () => {
    expect(layout.mainWireY).toBeCloseTo(S.padT + INSTANCE_H + FIRST_ROW, 6)
  })

  it('writes the type "TON" in the header band at 12 px, weight 600', () => {
    const type = label(layout, 'T1', 'blockType')
    expect({ text: type.text, sizePx: type.sizePx, weight: type.weight }).toEqual({
      text: 'TON',
      sizePx: 12,
      weight: 600,
    })
    const rect = textRect(type)
    expect(rect.top).toBeGreaterThanOrEqual(block.position.y - EPS)
    expect(rect.bottom).toBeLessThanOrEqual(block.position.y + S.blkHead + EPS)
  })

  it('writes the instance "Timer1" above the box at 12 px, weight 400', () => {
    const instance = label(layout, 'T1', 'instance')
    expect({ text: instance.text, sizePx: instance.sizePx, weight: instance.weight }).toEqual({
      text: 'Timer1',
      sizePx: 12,
      weight: 400,
    })
    expect(textRect(instance).bottom).toBeLessThanOrEqual(block.position.y + EPS)
  })

  it('writes the formal pin names at 11 px and the pin variables on each side of the box', () => {
    const formals = labels(layout, 'T1').filter((box) => box.role === 'pinFormal')
    expect(formals.map((box) => [box.text, box.sizePx]).sort()).toEqual([
      ['ET', 11],
      ['IN', 11],
      ['PT', 11],
      ['Q', 11],
    ])
    const [preset] = labelsWith(layout, 'pinVariable', 'Preset')
    const [elapsed] = labelsWith(layout, 'pinVariable', 'Elapsed')
    expect(textRect(preset).right).toBeLessThanOrEqual(block.position.x + EPS)
    expect(textRect(elapsed).left).toBeGreaterThanOrEqual(block.position.x + block.width - EPS)
  })

  it('uses only the weights 400 and 600', () => {
    const weights = [...layout.labels.values()].flat().map((box) => box.weight)
    expect([...new Set(weights)].sort()).toEqual([400, 600])
  })

  it('lays out no label over another label or element', () => {
    expect(collisions(BDD20, layout)).toEqual([])
  })
})

describe('a name stays whole on one line and its column widens to fit (BDD-15, AC05)', () => {
  const LONG_CONTACT = 'Conveyor_Infeed_Photoeye_Blocked_Longer_Than_Limit'
  const LONG_COIL = 'Conveyor_Infeed_Reject_Gate_Solenoid_Output_Main'
  const LONG_INSTANCE = 'Infeed_Reject_Gate_Delay_Timer_Instance'
  const LONG_TYPE = 'Conveyor_Speed_Controller_With_Ramp'
  const LONG_PIN = 'Infeed_Reject_Gate_Delay_Preset_Time'
  const WIDE = 'ポンプ_起動'

  it(`contact ${LONG_CONTACT} (50 characters)`, () => {
    const rung = seriesRung('rung_long_contact', [contact('a', LONG_CONTACT), contact('b', 'B')])
    const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
    expect(label(layout, 'a', 'name').text).toBe(LONG_CONTACT)
    expect(centreX(geometry(layout, 'b')) - centreX(geometry(layout, 'a'))).toBeCloseTo(
      (column(LONG_CONTACT) + column('B')) / 2,
      6,
    )
    expect(collisions(rung, layout)).toEqual([])
  })

  it(`coil ${LONG_COIL} (48 characters)`, () => {
    const rung = seriesRung('rung_long_coil', [contact('a', 'A'), coil('q', LONG_COIL)])
    const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
    expect(label(layout, 'q', 'name').text).toBe(LONG_COIL)
    expect(centreX(geometry(layout, 'q')) - centreX(geometry(layout, 'a'))).toBeCloseTo(
      (column('A') + column(LONG_COIL)) / 2,
      6,
    )
    expect(collisions(rung, layout)).toEqual([])
  })

  it(`block instance ${LONG_INSTANCE} (39 characters)`, () => {
    const rung = seriesRung('rung_long_instance', [
      contact('a', 'A'),
      ton('t', LONG_INSTANCE, { PT: 'P', ET: 'E' }),
      coil('q', 'Q'),
    ])
    const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
    const instance = textRect(label(layout, 't', 'instance'))
    expect(label(layout, 't', 'instance').text).toBe(LONG_INSTANCE)
    const room = geometry(layout, 'q').position.x - (geometry(layout, 'a').position.x + S.sym)
    expect(room).toBeGreaterThanOrEqual(textWidthPx(LONG_INSTANCE, NAME_PX))
    expect(instance.right - instance.left).toBeCloseTo(textWidthPx(LONG_INSTANCE, NAME_PX), 6)
    expect(collisions(rung, layout)).toEqual([])
  })

  it(`block type, user function block ${LONG_TYPE}`, () => {
    const rung = seriesRung('rung_long_type', [contact('a', 'A'), ton('t', 'T0', { PT: 'P', ET: 'E' }, LONG_TYPE)])
    const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
    expect(label(layout, 't', 'blockType').text).toBe(LONG_TYPE)
    expect(geometry(layout, 't').width).toBeCloseTo(textWidthPx(LONG_TYPE, NAME_PX) + 2 * S.blkPad + 10, 6)
    expect(collisions(rung, layout)).toEqual([])
  })

  it(`block pin variable ${LONG_PIN} (36 characters)`, () => {
    const rung = seriesRung('rung_long_pin', [contact('a', 'A'), ton('t', 'T0', { PT: LONG_PIN, ET: 'E' })])
    const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
    expect(labelsWith(layout, 'pinVariable', LONG_PIN)).toHaveLength(1)
    const previousColumnEnd = centreX(geometry(layout, 'a')) + column('A') / 2
    expect(geometry(layout, 't').position.x - previousColumnEnd).toBeCloseTo(
      S.gapBlk + sideColumn(textWidthPx(LONG_PIN, NAME_PX)),
      6,
    )
    expect(collisions(rung, layout)).toEqual([])
  })

  it(`contact ${WIDE}, each East Asian wide character taking the room of two characters`, () => {
    const rung = seriesRung('rung_wide', [contact('a', WIDE), contact('b', 'B')])
    const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
    expect(label(layout, 'a', 'name').text).toBe(WIDE)
    expect(centreX(geometry(layout, 'b')) - centreX(geometry(layout, 'a'))).toBeCloseTo((11 * 7.2 + 24 + 46) / 2, 6)
    expect(collisions(rung, layout)).toEqual([])
  })
})

describe('parallel groups', () => {
  const basic = loadCorpusProject('ld-corpus-basic')

  it('stacks branches 12 px apart and pads the group 8 px each side (B10 rung 3: aux_c | aux_d, then TOF0)', () => {
    const rung = loadedRungs(basic, 'Aux')[2]
    const layout = layoutRung(rung, corpusLabelSource(basic, 'Aux'))
    const c = geometry(layout, nodeByName(rung, 'aux_c').id)
    const d = geometry(layout, nodeByName(rung, 'aux_d').id)
    const tof = geometry(layout, nodeByName(rung, 'TOF0').id)
    const groupWidth = Math.max(column('aux_c'), column('aux_d')) + 2 * S.parPad
    expect(d.position.x).toBeCloseTo(c.position.x, 6)
    expect(d.position.y - c.position.y).toBeCloseTo(CC_BOTTOM + S.branchGap + CC_TOP, 6)
    const groupStart = centreX(c) - S.parPad - column('aux_c') / 2
    expect(tof.position.x - groupStart).toBeCloseTo(groupWidth + S.gapBlk + sideColumn(textWidthPx('T#2s', NAME_PX)), 6)
  })

  it('stacks a trailing group of coils 12 px apart, its first branch 8 px into the group (B06)', () => {
    const rung = loadedRungs(basic, 'Main')[2]
    const layout = layoutRung(rung, corpusLabelSource(basic, 'Main'))
    const [run, lamp1, lamp2, lamp3] = ['b06_run', 'b06_lamp1', 'b06_lamp2', 'b06_lamp3'].map((name) =>
      geometry(layout, nodeByName(rung, name).id),
    )
    expect(lamp2.position.y - lamp1.position.y).toBeCloseTo(CC_BOTTOM + S.branchGap + CC_TOP, 6)
    expect(lamp3.position.y - lamp2.position.y).toBeCloseTo(CC_BOTTOM + S.branchGap + CC_TOP, 6)
    expect(centreX(lamp1) - centreX(run)).toBeCloseTo(column('b06_run') / 2 + S.parPad + column('b06_lamp1') / 2, 6)
  })
})

describe('trailingOutputIds names the outputs right-justified later (BDD-19)', () => {
  const basic = loadCorpusProject('ld-corpus-basic')
  const hard = loadCorpusProject('ld-corpus-hard')
  const trailing = (rung: RungLadderState, src: LadderLabelSource = EMPTY_LABEL_SOURCE): string[] =>
    elementIds(rung, layoutRung(rung, src).trailingOutputIds)

  it('contact Start, coil Motor: coil Motor', () => {
    expect(trailing(seriesRung('r1', [contact('s', 'Start'), coil('m', 'Motor')]))).toEqual(['m'])
  })

  it('contact Start, coils Motor and Lamp in series: both coils, left to right', () => {
    expect(trailing(seriesRung('r2', [contact('s', 'Start'), coil('m', 'Motor'), coil('l', 'Lamp')]))).toEqual([
      'm',
      'l',
    ])
  })

  it('contact Start, a parallel group of coils (B06): the whole group, its parallel nodes included', () => {
    const rung = loadedRungs(basic, 'Main')[2]
    const coils = ['b06_lamp1', 'b06_lamp2', 'b06_lamp3'].map((name) => nodeByName(rung, name).id)
    const parallels = rung.nodes.filter((node) => node.type === 'parallel').map((node) => node.id)
    expect([...trailing(rung)].sort()).toEqual([...coils].sort())
    expect([...layoutRung(rung, EMPTY_LABEL_SOURCE).trailingOutputIds].sort()).toEqual([...coils, ...parallels].sort())
  })

  it('contact Start, TON Timer1: nothing, the block stays in flow', () => {
    expect(trailing(seriesRung('r4', [contact('s', 'Start'), ton('t', 'Timer1', { PT: 'P', ET: 'E' })]))).toEqual([])
  })

  it('contact, a parallel group holding coils and TON, TOF and CTU (H06): nothing, the group stays in flow', () => {
    expect(trailing(loadedRungs(hard, 'Parallel')[1])).toEqual([])
  })

  it('a block followed by a coil (B08): the coil only', () => {
    const rung = loadedRungs(basic, 'Blocks')[3]
    expect(trailing(rung)).toEqual([nodeByName(rung, 'b08_q').id])
  })
})

describe('segments are the top-level elements of the main series', () => {
  const basic = loadCorpusProject('ld-corpus-basic')
  const segmentElements = (rung: RungLadderState, layout: RungLayout): string[][] =>
    layout.segments.map((segment) => elementIds(rung, segment.nodeIds))

  it('gives each series element its own segment, left to right, without overlap', () => {
    const rung = seriesRung('rung_seg', [
      contact('s', 'Start'),
      ton('t', 'Timer1', { PT: 'P', ET: 'E' }),
      coil('m', 'Motor'),
    ])
    const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
    expect(segmentElements(rung, layout)).toEqual([['s'], ['t'], ['m']])
    layout.segments.forEach((segment, index) => {
      const next = layout.segments[index + 1]
      if (next !== undefined) expect(segment.x + segment.width).toBeLessThanOrEqual(next.x + EPS)
      for (const id of elementIds(rung, segment.nodeIds)) {
        const box = nodeRect(geometry(layout, id))
        expect(box.left).toBeGreaterThanOrEqual(segment.x - EPS)
        expect(box.right).toBeLessThanOrEqual(segment.x + segment.width + EPS)
      }
    })
  })

  it('makes a parallel group one segment and ends with the trailing outputs (B06)', () => {
    const rung = loadedRungs(basic, 'Main')[2]
    const layout = layoutRung(rung, corpusLabelSource(basic, 'Main'))
    const ids = (names: string[]) => names.map((name) => nodeByName(rung, name).id).sort()
    const segments = segmentElements(rung, layout).map((segment) => [...segment].sort())
    expect(segments).toEqual([ids(['b06_run']), ids(['b06_lamp1', 'b06_lamp2', 'b06_lamp3'])])
    expect(segments[segments.length - 1]).toEqual([...elementIds(rung, layout.trailingOutputIds)].sort())
  })

  it(`makes a rung of more than ${MAX_REDUCIBLE_ELEMENTS} elements one segment`, () => {
    const many: SeriesElement[] = Array.from({ length: MAX_REDUCIBLE_ELEMENTS + 1 }, (_, index) => contact(`k${index}`))
    const rung = seriesRung('rung_many', [...many, coil('q', 'Q')])
    const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
    expect(layout.segments).toHaveLength(1)
    expect([...elementIds(rung, layout.segments[0].nodeIds)].sort()).toEqual(
      [
        ...elementIds(
          rung,
          rung.nodes.map((n) => n.id),
        ),
      ].sort(),
    )
  })
})

/** A plain copy of a layout, its maps as entry arrays, so a later change to the layout shows up in a comparison. */
function layoutSnapshot(layout: RungLayout): unknown {
  return JSON.parse(JSON.stringify({ ...layout, nodes: [...layout.nodes], labels: [...layout.labels] }))
}

describe('determinism', () => {
  const hard = loadCorpusProject('ld-corpus-hard')

  it('gives the same layout for the same rung and source on every call', () => {
    const rung = loadedRungs(hard, 'Parallel')[2]
    const src = corpusLabelSource(hard, 'Parallel')
    expect(layoutRung(structuredClone(rung), src)).toEqual(layoutRung(rung, src))
    expect(layoutRung(rung, src)).toEqual(layoutRung(rung, src))
  })

  it('changes neither the rung nor the layout it is given', () => {
    const rung = loadedRungs(hard, 'Counters')[1]
    const before = structuredClone(rung)
    const layout = layoutRung(rung, corpusLabelSource(hard, 'Counters'))
    const layoutBefore = layoutSnapshot(layout)
    applyRungLayout(rung, layout)
    expect(rung).toEqual(before)
    expect(layoutSnapshot(layout)).toEqual(layoutBefore)
  })
})

const HANDLE_KEYS = ['handles', 'inputHandles', 'outputHandles'] as const
const CONNECTOR_KEYS = [
  'inputConnector',
  'outputConnector',
  'parallelInputConnector',
  'parallelOutputConnector',
] as const
const HANDLE_POSITION_FIELDS: ReadonlySet<string> = new Set(['glbPosition', 'relPosition', 'style', 'x', 'y'])

function withoutHandlePosition(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !HANDLE_POSITION_FIELDS.has(key)))
}

/** A node without what applyRungLayout may change: position, size (with xyflow's `measured` copy) and handle positions. */
function nonGeometry(node: Node): unknown {
  const rest: Record<string, unknown> = { ...node }
  for (const key of ['position', 'width', 'height', 'measured']) delete rest[key]
  const data: Record<string, unknown> = { ...node.data }
  for (const key of HANDLE_KEYS) {
    const list: unknown = data[key]
    if (Array.isArray(list)) data[key] = list.map(withoutHandlePosition)
  }
  for (const key of CONNECTOR_KEYS) if (key in data) data[key] = withoutHandlePosition(data[key])
  return { ...rest, data }
}

/** Every handle position a node's data holds for handle `id`, as `relPosition`. */
function relPositions(node: Node, id: string): unknown[] {
  const data: Record<string, unknown> = node.data
  const all: unknown[] = [
    ...HANDLE_KEYS.flatMap((key) => {
      const list: unknown = data[key]
      return Array.isArray(list) ? list : []
    }),
    ...CONNECTOR_KEYS.map((key) => data[key]),
  ]
  return all
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null && 'id' in entry && entry.id === id,
    )
    .map((entry) => entry.relPosition)
}

describe('applyRungLayout', () => {
  const basic = loadCorpusProject('ld-corpus-basic')
  const hard = loadCorpusProject('ld-corpus-hard')
  const cases: readonly [string, RungLadderState, LadderLabelSource][] = [
    ['B04 (handle branches)', loadedRungs(basic, 'Blocks')[1], corpusLabelSource(basic, 'Blocks')],
    ['H09 (blocks across parallel)', loadedRungs(hard, 'Parallel')[2], corpusLabelSource(hard, 'Parallel')],
    [
      'BDD-16 (locations)',
      seriesRung('rung_apply', [contact('s', 'Start'), ctu('c', 'C0', { R: 'Start', PV: '3', CV: 'N' })]),
      labelSource([boolVariable('Start', '%IX0.0')]),
    ],
  ]

  for (const [name, rung, src] of cases) {
    it(`${name}: keeps node ids, node and edge order, edges and every other field`, () => {
      const applied = applyRungLayout(rung, layoutRung(rung, src))
      expect(applied.nodes.map((node) => node.id)).toEqual(rung.nodes.map((node) => node.id))
      expect(applied.edges).toEqual(rung.edges)
      expect(applied.nodes.map(nonGeometry)).toEqual(rung.nodes.map(nonGeometry))
      const rungFields = (value: RungLadderState): Record<string, unknown> => {
        const fields: Record<string, unknown> = { ...value }
        for (const key of ['nodes', 'edges', 'defaultBounds', 'reactFlowViewport']) delete fields[key]
        return fields
      }
      expect(rungFields(applied)).toEqual(rungFields(rung))
    })

    it(`${name}: stores the layout's positions, sizes, handle positions and natural size`, () => {
      const layout = layoutRung(rung, src)
      const applied = applyRungLayout(rung, layout)
      for (const node of applied.nodes) {
        const g = geometry(layout, node.id)
        expect({ id: node.id, position: node.position, width: node.width, height: node.height }).toEqual({
          id: node.id,
          position: g.position,
          width: g.width,
          height: g.height,
        })
        for (const h of g.handles) {
          for (const rel of relPositions(node, h.id))
            expect({ node: node.id, handle: h.id, rel }).toEqual({
              node: node.id,
              handle: h.id,
              rel: { x: h.x, y: h.y },
            })
        }
      }
      expect(applied.defaultBounds).toEqual([layout.size.width, layout.size.height])
      expect(applied.reactFlowViewport).toEqual([layout.size.width, layout.size.height])
    })
  }
})

describe('rungLayoutDiffers', () => {
  const rung = seriesRung('rung_differs', [contact('a', 'Alpha'), coil('m', 'Motor')])
  const layout = layoutRung(rung, EMPTY_LABEL_SOURCE)
  const applied = applyRungLayout(rung, layout)
  const moveNode = (dx: number): RungLadderState => ({
    ...applied,
    nodes: applied.nodes.map((node) =>
      node.id === 'a' ? { ...node, position: { ...node.position, x: node.position.x + dx } } : node,
    ),
  })
  const resizeNode = (dw: number): RungLadderState => ({
    ...applied,
    nodes: applied.nodes.map((node) => (node.id === 'a' ? { ...node, width: (node.width ?? 0) + dw } : node)),
  })
  const shiftHandle = (dy: number): RungLadderState => ({
    ...applied,
    nodes: applied.nodes.map((node) => {
      if (node.id !== 'a') return node
      const shift = (entry: unknown): unknown => {
        if (typeof entry !== 'object' || entry === null || !('id' in entry) || entry.id !== 'output') return entry
        const record: Record<string, unknown> = { ...entry }
        for (const key of ['glbPosition', 'relPosition']) {
          const point: unknown = record[key]
          if (
            typeof point === 'object' &&
            point !== null &&
            'x' in point &&
            'y' in point &&
            typeof point.y === 'number'
          ) {
            record[key] = { ...point, y: point.y + dy }
          }
        }
        return record
      }
      const data: Record<string, unknown> = { ...node.data }
      for (const key of HANDLE_KEYS) {
        const list: unknown = data[key]
        if (Array.isArray(list)) data[key] = list.map(shift)
      }
      for (const key of CONNECTOR_KEYS) if (key in data) data[key] = shift(data[key])
      return { ...node, data }
    }),
  })
  const savedHeight = (dh: number): RungLadderState => ({
    ...applied,
    reactFlowViewport: [applied.reactFlowViewport[0], applied.reactFlowViewport[1] + dh],
  })
  const bounds = (dw: number): RungLadderState => ({
    ...applied,
    defaultBounds: [applied.defaultBounds[0] + dw, applied.defaultBounds[1]],
  })

  it('is false for the rung applyRungLayout stored', () => {
    expect(rungLayoutDiffers(applied, layout)).toBe(false)
  })

  it('is true for the rung as it was before the layout', () => {
    expect(rungLayoutDiffers(rung, layout)).toBe(true)
  })

  it('tolerates a node moved 0.4 px and flags one moved 0.6 px', () => {
    expect([rungLayoutDiffers(moveNode(0.4), layout), rungLayoutDiffers(moveNode(0.6), layout)]).toEqual([false, true])
  })

  it('tolerates a saved height 0.4 px off and flags one 0.6 px off', () => {
    expect([rungLayoutDiffers(savedHeight(0.4), layout), rungLayoutDiffers(savedHeight(-0.6), layout)]).toEqual([
      false,
      true,
    ])
  })

  it('flags a width, a handle position or a defaultBounds 0.6 px off, and tolerates 0.4 px', () => {
    expect([resizeNode(0.4), shiftHandle(0.4), bounds(0.4)].map((r) => rungLayoutDiffers(r, layout))).toEqual([
      false,
      false,
      false,
    ])
    expect([resizeNode(0.6), shiftHandle(0.6), bounds(0.6)].map((r) => rungLayoutDiffers(r, layout))).toEqual([
      true,
      true,
      true,
    ])
  })

  it('takes the tolerance it is given', () => {
    expect(rungLayoutDiffers(moveNode(0.6), layout, 1)).toBe(false)
    expect(rungLayoutDiffers(moveNode(0.2), layout, 0.1)).toBe(true)
  })
})

describe('ld-corpus-hard: every rung laid out without overlap and without losing an element (H01-H10)', () => {
  const hard = loadCorpusProject('ld-corpus-hard')
  for (const pou of ldPouNames(hard)) {
    const src = corpusLabelSource(hard, pou)
    loadedRungs(hard, pou).forEach((rung, index) => {
      const name = corpusRungName('ld-corpus-hard', pou, index + 1)

      it(`${name} keeps every element`, () => {
        const layout = layoutRung(rung, src)
        expect(rung.nodes.map((node) => node.id).filter((id) => !layout.nodes.has(id))).toEqual([])
        expect(applyRungLayout(rung, layout).nodes.map((node) => node.id)).toEqual(rung.nodes.map((node) => node.id))
      })

      it(`${name} has no overlapping element or label`, () => {
        expect(collisions(rung, layoutRung(rung, src))).toEqual([])
      })
    })
  }
})

/** Locations every corpus variable could show, so the overlap check also covers grown rows and wide columns. */
function locatedEverywhere(variables: readonly PLCVariable[]): PLCVariable[] {
  return variables.map((variable, index) => ({ ...variable, location: `%IX${index}.${index % 8}` }))
}

describe('ld-corpus-hard with every variable located: still no overlap', () => {
  const hard = loadCorpusProject('ld-corpus-hard')
  for (const pou of ldPouNames(hard)) {
    const base = corpusLabelSource(hard, pou)
    const src = labelSource(locatedEverywhere(base.pouVariables), base.globalVariables)
    loadedRungs(hard, pou).forEach((rung, index) => {
      it(`${corpusRungName('ld-corpus-hard', pou, index + 1)} located`, () => {
        expect(collisions(rung, layoutRung(rung, src))).toEqual([])
      })
    })
  }
})
