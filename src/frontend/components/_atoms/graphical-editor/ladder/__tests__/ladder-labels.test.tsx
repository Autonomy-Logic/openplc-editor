import {
  boolVariable,
  type SeriesElement,
  seriesRung,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/rung-builder'
import type { OpenPLCStore } from '@root/frontend/store'
import { aliasTooltip, resolveLocationLabel } from '@root/middleware/shared/utils/ladder-layout/labels'
import { textWidthPx } from '@root/middleware/shared/utils/ladder-layout/measure'
import { LADDER_PALETTE, LADDER_TYPOGRAPHY } from '@root/middleware/shared/utils/ladder-layout/style'
import { act, fireEvent, screen } from '@testing-library/react'

import {
  drawnFont,
  fontFamilyKey,
  getTestId,
  installLadderScreen,
  labelSourceOf,
  ladderStore,
  nodeElement,
  queryTestId,
  renderLadder,
  settle,
  storedRungs,
  textColour,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/ladder-screen'

installLadderScreen()

const POU = 'main'
const LONG_CONTACT = 'Conveyor_Infeed_Photoeye_Blocked_Longer_Than_Limit'
const LONG_COIL = 'Conveyor_Infeed_Reject_Gate_Solenoid_Output_Main'
const LONG_TYPE = 'Conveyor_Speed_Controller_With_Ramp'
const WIDE = 'ポンプ_起動🚀'
const NAME_250 = 'Conveyor_Line_7_'.repeat(16).slice(0, 249) + 'X'
const INJECTION = '<img src=x onerror=alert(1)>'

const contact = (id: string, name: string): SeriesElement => ({ kind: 'contact', id, name })
const coil = (id: string, name: string): SeriesElement => ({ kind: 'coil', id, name })

const RUNGS = [
  seriesRung('rung_labels', [
    contact('start', 'Start'),
    contact('stop', 'Stop'),
    contact('pump', 'Pump'),
    contact('old', 'Old'),
    contact('wide', WIDE),
    { kind: 'block', id: 't', template: 'TON', instance: 'Timer1', pins: { PT: 'Preset', ET: 'Elapsed' } },
    coil('motor', LONG_COIL),
  ]),
  seriesRung('rung_long', [
    contact('long', LONG_CONTACT),
    contact('huge', NAME_250),
    { kind: 'block', id: 'u', template: 'TON', instance: 'T0', pins: { PT: 'T#1s', ET: 'E0' }, typeName: LONG_TYPE },
    coil('lamp', 'Lamp'),
  ]),
  seriesRung('rung_injection', [contact('html', INJECTION), coil('q', 'Q')]),
]

const VARIABLES = [
  boolVariable('Start', '%IX0.0'),
  boolVariable('Stop'),
  boolVariable('Pump', 'Pump_1'),
  boolVariable('Old', 'Old_IO'),
  boolVariable(LONG_COIL, '%QX0.0'),
  boolVariable('Preset', '%MW1'),
]

/** Publishes the alias Pump_1 from a Modbus remote device's second coil, so it resolves to %QX0.1. */
function publishPumpAlias(store: OpenPLCStore): void {
  const state = store.getState()
  const created = state.remoteDeviceActions.create({ name: 'Remote1', protocol: 'modbus-tcp' })
  if (!created.ok) throw new Error('could not create the remote device')
  state.projectActions.addIOGroup('Remote1', {
    id: 'coils',
    name: 'Coils',
    functionCode: '15',
    cycleTime: 100,
    offset: '0',
    length: 2,
    errorHandling: 'keep-last-value',
    ioPoints: [],
  })
  const points = store.getState().project.data.remoteDevices?.[0]?.modbusTcpConfig?.ioGroups[0]?.ioPoints ?? []
  const second = points[1]
  if (second === undefined) throw new Error('the coil group has no second point')
  store.getState().projectActions.updateIOPointAlias('Remote1', 'coils', second.id, 'Pump_1')
}

async function openLabels(): Promise<{ store: OpenPLCStore; container: HTMLElement }> {
  const store = ladderStore([{ name: POU, variables: VARIABLES, rungs: RUNGS }])
  publishPumpAlias(store)
  const { container } = await renderLadder(store, POU)
  return { store, container }
}

const text = (el: Element | null): string => el?.textContent ?? ''

/** The tooltip text shown for `el`: a native `title` on it or an ancestor in its node, else the tooltip opened by hovering it. */
function tooltipOf(el: Element): string | undefined {
  const titled = el.closest('[title]')
  if (titled !== null && titled.closest('.react-flow__node') !== null) return titled.getAttribute('title') ?? undefined
  vi.useFakeTimers()
  try {
    fireEvent.pointerMove(el)
    fireEvent.mouseEnter(el)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
  } finally {
    vi.useRealTimers()
  }
  const shown = screen.queryAllByRole('tooltip').map((tip) => tip.textContent ?? '')
  return shown.length > 0 ? shown[0] : undefined
}

describe('names are drawn whole on one line, as text from the layout (AC05, BDD-15)', () => {
  it.each([
    ['start', 'Start'],
    ['stop', 'Stop'],
    ['wide', WIDE],
    ['motor', LONG_COIL],
    ['long', LONG_CONTACT],
    ['huge', NAME_250],
  ])('contact or coil %s shows its full name', async (id, name) => {
    const { container } = await openLabels()
    const label = getTestId(container, `ld-name-${id}`)
    expect({ text: text(label), breaks: label.querySelectorAll('br').length }).toEqual({ text: name, breaks: 0 })
  })

  it('a block shows its type in the header and its instance name, whole', async () => {
    const { container } = await openLabels()
    expect({
      type: text(getTestId(container, 'ld-block-type-t')),
      instance: text(getTestId(container, 'ld-block-instance-t')),
      longType: text(getTestId(container, 'ld-block-type-u')),
    }).toEqual({ type: 'TON', instance: 'Timer1', longType: LONG_TYPE })
  })

  it('a block pin variable shows its name on its own node', async () => {
    const { container } = await openLabels()
    expect(text(getTestId(container, 'ld-name-t:PT'))).toBe('Preset')
  })

  it('no element holds a text field until its name is clicked', async () => {
    const { container } = await openLabels()
    const fields = Array.from(container.querySelectorAll('.react-flow__node textarea, .react-flow__node input'))
    expect(fields.map((field) => field.closest('.react-flow__node')?.getAttribute('data-id'))).toEqual([])
  })
})

describe('location lines (AC05, BDD-16)', () => {
  it('shows a literal address, an alias verbatim, and nothing for a variable without a location', async () => {
    const { container } = await openLabels()
    expect({
      start: text(getTestId(container, 'ld-location-start')),
      motor: text(getTestId(container, 'ld-location-motor')),
      pump: text(getTestId(container, 'ld-location-pump')),
      old: text(getTestId(container, 'ld-location-old')),
      stop: text(queryTestId(container, 'ld-location-stop')),
      pin: text(getTestId(container, 'ld-location-t:PT')),
    }).toEqual({ start: '%IX0.0', motor: '%QX0.0', pump: 'Pump_1', old: 'Old_IO', stop: '', pin: '%MW1' })
  })

  it("draws locations in the palette's loc colour, light and then dark", async () => {
    const { store, container } = await openLabels()
    const light = textColour(getTestId(container, 'ld-location-start'))
    act(() => store.getState().workspaceActions.switchAppTheme())
    await settle()
    const dark = textColour(getTestId(container, 'ld-location-start'))
    expect({ light, dark }).toEqual({ light: LADDER_PALETTE.light.loc, dark: LADDER_PALETTE.dark.loc })
  })
})

describe('ladder typography (AC05, BDD-14 unit part)', () => {
  const family = fontFamilyKey(LADDER_TYPOGRAPHY.family)
  const regular = (weight: number | undefined) => weight ?? LADDER_TYPOGRAPHY.regularWeight

  it('draws names and pin variables in JetBrains Mono at 12 px, regular', async () => {
    const { container } = await openLabels()
    const fonts = ['ld-name-start', 'ld-name-motor', 'ld-name-t:PT', 'ld-block-instance-t'].map((id) => {
      const font = drawnFont(getTestId(container, id))
      return { id, family: font.family, sizePx: font.sizePx, weight: regular(font.weight) }
    })
    for (const font of fonts) expect(font).toEqual({ id: font.id, family, sizePx: 12, weight: 400 })
  })

  it('draws locations in JetBrains Mono at 10 px', async () => {
    const { container } = await openLabels()
    for (const id of ['ld-location-start', 'ld-location-t:PT']) {
      const font = drawnFont(getTestId(container, id))
      expect({ id, family: font.family, sizePx: font.sizePx }).toEqual({ id, family, sizePx: 10 })
    }
  })

  it('draws the block type in JetBrains Mono semibold (600)', async () => {
    const { container } = await openLabels()
    const font = drawnFont(getTestId(container, 'ld-block-type-t'))
    expect({ family: font.family, weight: font.weight }).toEqual({ family, weight: 600 })
  })
})

describe('tooltips appear only on alias locations (AC05, AC15, BDD-17, BDD-18)', () => {
  it('an alias location shows "Pump_1 -> %QX0.1"', async () => {
    const { store, container } = await openLabels()
    const expected = aliasTooltip(
      resolveLocationLabel('Pump', labelSourceOf(store, POU)),
      store.getState().projectActions.getAliasIndex(),
    )
    expect(expected).toBe('Pump_1 -> %QX0.1')
    expect(tooltipOf(getTestId(container, 'ld-location-pump'))).toBe(expected)
  })

  it('an orphaned alias shows "Old_IO -> unresolved"', async () => {
    const { container } = await openLabels()
    expect(tooltipOf(getTestId(container, 'ld-location-old'))).toBe('Old_IO -> unresolved')
  })

  it.each([
    ['a 5-character contact name', 'ld-name-start'],
    ['a 50-character contact name', 'ld-name-long'],
    ['a 250-character contact name', 'ld-name-huge'],
    ['a literal location', 'ld-location-start'],
    ['a pin variable name', 'ld-name-t:PT'],
  ])('%s shows no tooltip', async (_target, id) => {
    const { container } = await openLabels()
    expect(tooltipOf(getTestId(container, id))).toBeUndefined()
  })
})

describe('no raw HTML rendering of LD text (SC1)', () => {
  it('draws a name that looks like HTML as literal text and creates no element from it', async () => {
    const { container } = await openLabels()
    const body = nodeElement(container, 'html').closest('[aria-label="Rung body"]')
    expect({
      text: text(getTestId(container, 'ld-name-html')),
      images: container.querySelectorAll('img').length,
      inBody: body?.querySelectorAll('img').length,
    }).toEqual({ text: INJECTION, images: 0, inBody: 0 })
  })
})

describe('name editing keeps its behaviour as a single-line field (BDD-15)', () => {
  const nodeNamed = (store: OpenPLCStore, id: string) =>
    storedRungs(store, POU)
      .flatMap((rung) => rung.nodes)
      .find((node) => node.id === id)

  /** The editable text field inside node `id`. */
  function fieldIn(container: HTMLElement, id: string): HTMLInputElement {
    const field = nodeElement(container, id).querySelector('input, textarea')
    if (!(field instanceof HTMLInputElement)) {
      throw new Error(`node ${id} holds ${field === null ? 'no field' : `a ${field.tagName}`}, not a single-line input`)
    }
    return field
  }

  const widthPx = (field: HTMLElement): number => Number.parseFloat(field.style.width)

  it('clicking a name opens a single-line field holding the name', async () => {
    const { container } = await openLabels()
    fireEvent.click(getTestId(container, 'ld-name-stop'))
    await settle()
    expect(fieldIn(container, 'stop').value).toBe('Stop')
  })

  it('the field widens with the typed text, as wide as textWidthPx at 12 px', async () => {
    const { container } = await openLabels()
    fireEvent.click(getTestId(container, 'ld-name-stop'))
    await settle()
    const field = fieldIn(container, 'stop')
    const before = widthPx(field)
    fireEvent.change(field, { target: { value: 'Start_Button_Main_Line' } })
    await settle()
    const after = widthPx(fieldIn(container, 'stop'))
    expect(after).toBeGreaterThan(before)
    expect(after).toBeGreaterThanOrEqual(textWidthPx('Start_Button_Main_Line', LADDER_TYPOGRAPHY.nameSizePx) - 0.5)
  })

  it('leaving the field renames the element in the store', async () => {
    const { store, container } = await openLabels()
    fireEvent.click(getTestId(container, 'ld-name-stop'))
    await settle()
    const field = fieldIn(container, 'stop')
    fireEvent.change(field, { target: { value: 'Stop_Button' } })
    fireEvent.blur(field)
    await settle()
    expect(nodeNamed(store, 'stop')?.data.variable).toEqual(expect.objectContaining({ name: 'Stop_Button' }))
  })

  it('while a debug session is open, clicking a name opens no editable field', async () => {
    const { store, container } = await openLabels()
    act(() => store.getState().workspaceActions.setDebuggerVisible(true))
    await settle()
    fireEvent.click(getTestId(container, 'ld-name-stop'))
    await settle()
    const editable = Array.from(nodeElement(container, 'stop').querySelectorAll('input, textarea')).filter(
      (field) =>
        !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) ||
        !(field.readOnly || field.disabled),
    )
    expect(editable).toHaveLength(0)
  })
})

describe('block help and project search', () => {
  it('hovering a block shows its documentation', async () => {
    const { container } = await openLabels()
    expect(tooltipOf(getTestId(container, 'ld-block-type-t'))).toContain('INPUT:')
  })

  it('a project-search match on a ladder name is highlighted', async () => {
    const { store, container } = await openLabels()
    act(() => store.getState().searchActions.setSearchQuery('pump'))
    await settle()
    expect(container.querySelectorAll('[data-testid="ld-search-highlight"]').length).toBeGreaterThan(0)
  })
})
