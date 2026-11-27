import { act, fireEvent, render, screen } from '@testing-library/react'

import type { DebugTreeNode } from '../../../../../middleware/shared/ports/types'
import { VariablesPanel } from '../index'

const ELEMENTS = 100000

const arrayTree = (): Map<string, DebugTreeNode> => {
  const children: DebugTreeNode[] = Array.from({ length: ELEMENTS }, (_, i) => ({
    name: `[${i}]`,
    fullPath: `INSTANCE0.ARR[${i}]`,
    compositeKey: `main:ARR[${i}]`,
    type: 'DINT',
    isComplex: false,
    debugIndex: i,
  }))
  const root: DebugTreeNode = {
    name: 'ARR',
    fullPath: 'INSTANCE0.ARR',
    compositeKey: 'main:ARR',
    type: 'ARRAY',
    isComplex: true,
    children,
  }
  return new Map([[root.compositeKey, root]])
}

const setViewportHeight = (height: number) =>
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height })

const renderPanel = (onVisibleKeysChange: (keys: string[]) => void) =>
  render(
    <VariablesPanel
      variableTree={arrayTree()}
      setGraphList={() => undefined}
      debugExpandedNodes={new Map([['main:ARR', true]])}
      debugNonBoolValues={new Map([['main:ARR[5]', '38']])}
      isDebuggerVisible
      onVisibleKeysChange={onVisibleKeysChange}
    />,
  )

const lastKeys = (spy: jest.Mock<void, [string[]]>) => spy.mock.calls[spy.mock.calls.length - 1][0]

describe('debugger panel rows on screen', () => {
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
  })

  it('mounts and reports only the rows near the viewport of an expanded 100000-element array', () => {
    setViewportHeight(200)
    const onVisibleKeysChange = jest.fn<void, [string[]]>()

    renderPanel(onVisibleKeysChange)

    const keys = lastKeys(onVisibleKeysChange)
    expect(keys[0]).toBe('main:ARR')
    expect(keys).toContain('main:ARR[5]')
    expect(keys.length).toBeLessThanOrEqual(25)
    expect(screen.getAllByText(/^\[\d+\]$/).length).toBe(keys.length - 1)
    expect(screen.getByText('38')).toBeTruthy()
  })

  it('reports the rows scrolled into view', () => {
    setViewportHeight(200)
    const onVisibleKeysChange = jest.fn<void, [string[]]>()
    renderPanel(onVisibleKeysChange)

    const scroller = screen.getByText('main.ARR').closest('.overflow-auto') as HTMLElement
    act(() => {
      scroller.scrollTop = 20 * 50001
      fireEvent.scroll(scroller)
    })

    const keys = lastKeys(onVisibleKeysChange)
    expect(keys).toContain('main:ARR[50000]')
    expect(keys).not.toContain('main:ARR')
    expect(screen.getByText('[50000]')).toBeTruthy()
  })

  it('reports no rows while the panel has no height', () => {
    setViewportHeight(0)
    const onVisibleKeysChange = jest.fn<void, [string[]]>()

    renderPanel(onVisibleKeysChange)

    expect(lastKeys(onVisibleKeysChange)).toEqual([])
  })

  it('gives a forced element shown both as a root and in its array two distinct rows', () => {
    setViewportHeight(200)
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const tree = arrayTree()
    const element = tree.get('main:ARR')!.children![ELEMENTS - 1]
    tree.set(element.compositeKey, element)
    const props = {
      variableTree: tree,
      setGraphList: () => undefined,
      debugForcedVariables: new Map([[element.compositeKey, true]]),
      debugNonBoolValues: new Map([[element.compositeKey, '77']]),
      isDebuggerVisible: true,
    }
    const { rerender } = render(<VariablesPanel {...props} debugExpandedNodes={new Map([['main:ARR', true]])} />)
    const scroller = screen.getByText('main.ARR').closest('.overflow-auto') as HTMLElement
    act(() => {
      scroller.scrollTop = 20 * ELEMENTS
      fireEvent.scroll(scroller)
    })
    expect(screen.getAllByText('77')).toHaveLength(2)

    rerender(<VariablesPanel {...props} debugExpandedNodes={new Map()} />)
    act(() => {
      scroller.scrollTop = 0
      fireEvent.scroll(scroller)
    })

    expect(screen.getAllByText('77')).toHaveLength(1)
    expect(screen.queryByText(`[${ELEMENTS - 1}]`)).toBeNull()
    expect(screen.getByText(`main.ARR[${ELEMENTS - 1}]`)).toBeTruthy()
    expect(consoleError.mock.calls.filter(([message]) => String(message).includes('same key'))).toEqual([])
    consoleError.mockRestore()
  })

  it('reports no rows once unmounted', () => {
    setViewportHeight(200)
    const onVisibleKeysChange = jest.fn<void, [string[]]>()
    const { unmount } = renderPanel(onVisibleKeysChange)

    unmount()

    expect(lastKeys(onVisibleKeysChange)).toEqual([])
  })
})
