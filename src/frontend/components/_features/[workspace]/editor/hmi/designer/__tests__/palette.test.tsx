import type { HmiWidgetCatalog, HmiWidgetInfo } from '@root/middleware/shared/ports/hmi-preview-types'
import { parseDesignerBlock } from '@root/middleware/shared/utils/hmi/designer/designer-model'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'

import { Outline } from '../outline'
import { VariableList, WidgetPalette } from '../palette'
import { CanvasBackdrop, CanvasControls, PlacementNotice } from '../parts'

const widget = (name: string, base: string, palette?: string): HmiWidgetInfo => ({
  name,
  library: 'StandardWidgets',
  extends: base,
  properties: [],
  outputs: [],
  events: [],
  ...(palette ? { palette } : {}),
})
const CATALOG: HmiWidgetCatalog = {
  widgets: new Map(
    [
      widget('HmiVerticalStack', 'HmiStack', 'Containers'),
      widget('HmiHorizontalStack', 'HmiStack', 'Containers'),
      widget('HmiDiagram', 'HmiContainer', 'Containers'),
      widget('HmiTank', 'HmiElement', 'Display'),
    ].map((w) => [w.name.toUpperCase(), w]),
  ),
  colors: [],
}
const ignore = () => undefined
const isContainer = (type: string) => /Stack$|Diagram$/.test(type)

const NESTED = [
  'FUNCTION_BLOCK S EXTENDS HmiScreen',
  '  VAR',
  '    HorizontalStack1 : HmiHorizontalStack;',
  "    VerticalStack1 : HmiVerticalStack := (Parent := 'HorizontalStack1');",
  "    Tank1 : HmiTank := (Parent := 'VerticalStack1');",
  '  END_VAR',
  'END_FUNCTION_BLOCK',
  '',
].join('\n')

/** The positions of the bars a stack's tile draws inside its frame. */
function bars(name: string): Array<[number, number]> {
  return Array.from(screen.getByTestId(`hmi-palette-${name}`).querySelectorAll('svg rect'))
    .slice(1)
    .map((r) => [Number(r.getAttribute('x')), Number(r.getAttribute('y'))])
}

describe('HMI designer palette', () => {
  it('offers both stacks and the diagram as containers, each with its own tile', () => {
    render(
      <WidgetPalette
        catalog={CATALOG}
        projectWidgets={new Set()}
        thumbnails={new Map()}
        filter=''
        capabilities={{}}
        onAdd={ignore}
        disabled={false}
      />,
    )
    expect(screen.getByTestId('hmi-palette-HmiVerticalStack').textContent).toBe('Vertical stack')
    expect(screen.getByTestId('hmi-palette-HmiHorizontalStack').textContent).toBe('Horizontal stack')
    expect(screen.getByTestId('hmi-palette-HmiDiagram').textContent).toContain('Diagram')
    const vertical = bars('HmiVerticalStack')
    const horizontal = bars('HmiHorizontalStack')
    expect(new Set(vertical.map(([, y]) => y)).size).toBe(1)
    expect(new Set(vertical.map(([x]) => x)).size).toBe(3)
    expect(new Set(horizontal.map(([x]) => x)).size).toBe(1)
    expect(new Set(horizontal.map(([, y]) => y)).size).toBe(3)
  })

  it('finds a stack tile by its type name or by its label', () => {
    for (const filter of ['vertical', 'VerticalStack', 'vertical stack']) {
      const { unmount } = render(
        <WidgetPalette
          catalog={CATALOG}
          projectWidgets={new Set()}
          thumbnails={new Map()}
          filter={filter}
          capabilities={{}}
          onAdd={ignore}
          disabled={false}
        />,
      )
      expect(screen.queryByTestId('hmi-palette-HmiVerticalStack')).not.toBeNull()
      expect(screen.queryByTestId('hmi-palette-HmiHorizontalStack')).toBeNull()
      unmount()
    }
  })
})

describe('HMI designer layers', () => {
  it('shows nested containers with their types', () => {
    const parsed = parseDesignerBlock(
      [
        'FUNCTION_BLOCK S EXTENDS HmiScreen',
        '  VAR',
        '    HorizontalStack1 : HmiHorizontalStack;',
        "    VerticalStack1 : HmiVerticalStack := (Parent := 'HorizontalStack1');",
        "    Tank1 : HmiTank := (Parent := 'VerticalStack1');",
        '  END_VAR',
        'END_FUNCTION_BLOCK',
        '',
      ].join('\n'),
      (t) => CATALOG.widgets.has(t.toUpperCase()),
    )
    if (!parsed.ok) throw new Error('fixture does not parse')
    render(
      <Outline
        model={parsed.model}
        selection={[]}
        onSelect={ignore}
        onShift={ignore}
        isContainer={isContainer}
        collapsed={[]}
        onToggle={ignore}
      />,
    )
    const outer = screen.getByTestId('hmi-outline-HorizontalStack1')
    const inner = screen.getByTestId('hmi-outline-VerticalStack1')
    expect(outer.textContent).toContain('HorizontalStack')
    expect(inner.textContent).toContain('VerticalStack')
    expect(screen.getByTestId('hmi-outline-Tank1').textContent).toContain('Tank')
    expect(Number.parseInt(inner.style.paddingLeft, 10)).toBeGreaterThan(Number.parseInt(outer.style.paddingLeft, 10))
  })
})

describe('HMI designer layers collapsing', () => {
  /** The Layers panel with its collapsed containers kept in local state, as the store keeps them. */
  function Layers(props: { onSelect: (name: string) => void }) {
    const parsed = parseDesignerBlock(NESTED, (t) => CATALOG.widgets.has(t.toUpperCase()))
    if (!parsed.ok) throw new Error('fixture does not parse')
    const [collapsed, setCollapsed] = useState<string[]>([])
    return (
      <Outline
        model={parsed.model}
        selection={[]}
        onSelect={props.onSelect}
        onShift={ignore}
        isContainer={isContainer}
        collapsed={collapsed}
        onToggle={(n) =>
          setCollapsed((c) =>
            c.includes(n.toUpperCase()) ? c.filter((x) => x !== n.toUpperCase()) : [...c, n.toUpperCase()],
          )
        }
      />
    )
  }

  it('gives containers an arrow that hides and shows their children, and other rows a spacer', () => {
    const selected: string[] = []
    render(<Layers onSelect={(n) => selected.push(n)} />)
    const toggle = screen.getByTestId('hmi-outline-toggle-VerticalStack1')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.querySelector('svg')).not.toBeNull()
    expect(screen.queryByTestId('hmi-outline-toggle-Tank1')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('hmi-outline-Tank1')).toBeNull()
    expect(selected).toEqual([])
    fireEvent.click(screen.getByTestId('hmi-outline-VerticalStack1'))
    expect(selected).toEqual(['VerticalStack1'])
    fireEvent.click(screen.getByTestId('hmi-outline-toggle-HorizontalStack1'))
    expect(screen.queryByTestId('hmi-outline-VerticalStack1')).toBeNull()
    fireEvent.click(screen.getByTestId('hmi-outline-toggle-HorizontalStack1'))
    fireEvent.click(screen.getByTestId('hmi-outline-toggle-VerticalStack1'))
    expect(screen.queryByTestId('hmi-outline-Tank1')).not.toBeNull()
  })
})

describe('HMI designer placement notice', () => {
  it('shows why a placement was refused while visible', () => {
    const { rerender } = render(<PlacementNotice visible text='Place widgets inside a stack or a diagram' />)
    const notice = screen.getByTestId('hmi-placement-notice')
    expect(notice.getAttribute('data-visible')).toBe('true')
    expect(notice.textContent).toContain('Place widgets inside a stack or a diagram')
    rerender(<PlacementNotice visible={false} text='Place widgets inside a stack or a diagram' />)
    expect(notice.getAttribute('data-visible')).toBe('false')
  })
})

describe('HMI designer layers selection', () => {
  it('marks every selected row with the hover background and the project tree bold text', () => {
    const parsed = parseDesignerBlock(NESTED, (t) => CATALOG.widgets.has(t.toUpperCase()))
    if (!parsed.ok) throw new Error('fixture does not parse')
    render(
      <Outline
        model={parsed.model}
        selection={['Tank1', 'VerticalStack1']}
        onSelect={ignore}
        onShift={ignore}
        isContainer={isContainer}
        collapsed={[]}
        onToggle={ignore}
      />,
    )
    for (const name of ['Tank1', 'VerticalStack1']) {
      const row = screen.getByTestId(`hmi-outline-${name}`)
      expect(row.className).toContain('bg-neutral-100')
      expect(row.className).toContain('dark:bg-neutral-900')
      expect(row.className).toContain('font-medium')
      expect(row.className).toContain('dark:text-white')
    }
    expect(screen.getByTestId('hmi-outline-HorizontalStack1').className).not.toContain('font-medium')
  })
})

describe('HMI designer variables tree', () => {
  const VARS = [
    { path: 'instance0.Main.T1.Q', type: 'BOOL' },
    { path: 'instance0.Main.Arr[2]', type: 'INT' },
    { path: 'instance0.Main.Level', type: 'REAL' },
    { path: 'instance0.Main.Run', type: 'BOOL' },
    { path: 'AlarmOn', type: 'BOOL', initialValue: 'TRUE' },
  ]
  function Variables(props: { filter: string }) {
    const [collapsed, setCollapsed] = useState<string[]>([])
    return (
      <VariableList
        variables={VARS}
        filter={props.filter}
        disabled={false}
        collapsed={collapsed}
        onToggle={(k) => setCollapsed((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))}
      />
    )
  }

  it('starts open, closes and opens a branch with its arrow, and drags a nested leaf by its path', () => {
    render(<Variables filter='' />)
    const branch = screen.getByTestId('hmi-variable-node-instance0.Main')
    expect(branch.getAttribute('aria-expanded')).toBe('true')
    expect(branch.querySelector('svg')).not.toBeNull()
    const leaf = screen.getByTestId('hmi-variable-instance0.Main.Level')
    expect(leaf.getAttribute('draggable')).toBe('true')
    const data = new Map<string, string>()
    const transfer = { effectAllowed: 'none', setData: (k: string, v: string) => data.set(k, v) }
    fireEvent.dragStart(leaf, { dataTransfer: transfer })
    expect([...data.entries()]).toEqual([['application/x-openplc-hmi-variable', 'instance0.Main.Level']])
    expect(transfer.effectAllowed).toBe('copy')
    fireEvent.click(branch)
    expect(branch.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('hmi-variable-instance0.Main.Level')).toBeNull()
    expect(screen.getByTestId('hmi-variable-AlarmOn')).toBeTruthy()
    fireEvent.click(branch)
    expect(screen.getByTestId('hmi-variable-instance0.Main.Level')).toBeTruthy()
  })

  it('drags a block pin and an array element from their nested branches', () => {
    render(<Variables filter='' />)
    expect(screen.getByTestId('hmi-variable-node-instance0.Main.T1').textContent).toContain('T1')
    expect(screen.getByTestId('hmi-variable-node-instance0.Main.Arr').textContent).toContain('Arr')
    for (const path of ['instance0.Main.T1.Q', 'instance0.Main.Arr[2]']) {
      const data = new Map<string, string>()
      fireEvent.dragStart(screen.getByTestId(`hmi-variable-${path}`), {
        dataTransfer: { setData: (k: string, v: string) => data.set(k, v) },
      })
      expect(data.get('application/x-openplc-hmi-variable')).toBe(path)
    }
    fireEvent.click(screen.getByTestId('hmi-variable-node-instance0.Main.Arr'))
    expect(screen.queryByTestId('hmi-variable-instance0.Main.Arr[2]')).toBeNull()
  })

  it('opens every matching branch while searching, and restores the closed ones after', () => {
    const { rerender } = render(<Variables filter='' />)
    fireEvent.click(screen.getByTestId('hmi-variable-node-instance0'))
    expect(screen.queryByTestId('hmi-variable-instance0.Main.Run')).toBeNull()
    rerender(<Variables filter='run' />)
    expect(screen.getByTestId('hmi-variable-instance0.Main.Run')).toBeTruthy()
    expect(screen.queryByTestId('hmi-variable-instance0.Main.Level')).toBeNull()
    expect(screen.queryByTestId('hmi-variable-AlarmOn')).toBeNull()
    rerender(<Variables filter='' />)
    expect(screen.queryByTestId('hmi-variable-instance0.Main.Run')).toBeNull()
  })
})

describe('HMI designer canvas frame', () => {
  it("draws the FBD editor's dotted background and control buttons in a flow scope", () => {
    const { container } = render(
      <div>
        <CanvasBackdrop id='hmi-bg-test' />
        <CanvasControls zoom={1.25} onZoomIn={ignore} onZoomOut={ignore} onFit={ignore} preview onPreview={ignore} />
      </div>,
    )
    expect(
      container.querySelector('.react-flow .react-flow__background .react-flow__background-pattern.dots'),
    ).not.toBeNull()
    const buttons = container.querySelectorAll('.react-flow .react-flow__controls .react-flow__controls-button')
    expect(buttons.length).toBe(5)
    expect(screen.getByTestId('hmi-zoom').textContent).toBe('125%')
    expect(screen.getByTestId('hmi-preview-mode').getAttribute('aria-pressed')).toBe('true')
  })
})

describe('HMI designer palette and target capabilities', () => {
  const list: HmiWidgetInfo = { ...widget('HmiAlarmList', 'HmiDataElement', 'Alarms'), requires: 'hmiDataWidgets' }
  const banner = widget('HmiAlarmBanner', 'HmiDataElement', 'Alarms')
  const catalog: HmiWidgetCatalog = {
    widgets: new Map([list, banner].map((w) => [w.name.toUpperCase(), w])),
    colors: [],
  }
  const palette = (capabilities: object) => (
    <WidgetPalette
      catalog={catalog}
      projectWidgets={new Set()}
      thumbnails={new Map()}
      filter=''
      capabilities={capabilities}
      onAdd={ignore}
      disabled={false}
    />
  )

  it('hides a widget whose capability the board lacks and shows it on a board that has it', () => {
    const { rerender } = render(palette({ hmiDataWidgets: false }))
    expect(screen.queryByTestId('hmi-palette-HmiAlarmList')).toBeNull()
    expect(screen.getByTestId('hmi-palette-HmiAlarmBanner')).toBeTruthy()
    rerender(palette({ hmiDataWidgets: true }))
    expect(screen.getByTestId('hmi-palette-HmiAlarmList')).toBeTruthy()
  })
})

describe('HMI designer variables tree and data sources', () => {
  it('drags a whole alarm table, and an array of numbers by its branch', () => {
    render(
      <VariableList
        variables={[
          { path: 'instance0.Main.Flow[0]', type: 'REAL' },
          { path: 'instance0.Main.Flow[1]', type: 'REAL' },
          { path: 'instance0.Main.Flow', type: 'ARRAY[0..1] OF REAL', source: { kind: 'numbers', lower: 0, upper: 1 } },
          {
            path: 'instance0.Main.Alarms',
            type: 'ARRAY[1..9] OF HMI_ALARM_ROW',
            source: { kind: 'alarms', lower: 1, upper: 9 },
          },
        ]}
        filter=''
        disabled={false}
        collapsed={[]}
        onToggle={ignore}
      />,
    )
    for (const [testId, path] of [
      ['hmi-variable-instance0.Main.Alarms', 'instance0.Main.Alarms'],
      ['hmi-variable-node-instance0.Main.Flow', 'instance0.Main.Flow'],
    ]) {
      const node = screen.getByTestId(testId)
      expect(node.getAttribute('draggable')).toBe('true')
      const data = new Map<string, string>()
      fireEvent.dragStart(node, { dataTransfer: { setData: (k: string, v: string) => data.set(k, v) } })
      expect(data.get('application/x-openplc-hmi-variable')).toBe(path)
    }
    expect(screen.getByTestId('hmi-variable-node-instance0.Main').getAttribute('draggable')).toBe('false')
    expect(screen.queryByTestId('hmi-variable-instance0.Main.Flow')).toBeNull()
  })
})
