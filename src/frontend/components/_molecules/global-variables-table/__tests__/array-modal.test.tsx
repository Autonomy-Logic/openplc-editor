import { fireEvent, render, screen, within } from '@testing-library/react'

import type { PLCGlobalVariable } from '@root/middleware/shared/ports/types'
import type { ProjectResponse } from '@root/frontend/store/slices/project/types'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { dispatch, getMemoryState } from '@root/frontend/utils/toast'

import { GlobalArrayModal } from '../elements/array-modal'

type VariableType = PLCGlobalVariable['type']

const INT: VariableType = { definition: 'base-type', value: 'INT' }

const ARRAY_1_5_0_2_OF_REAL: VariableType = {
  definition: 'array',
  value: 'ARRAY [1..5, 0..2] OF REAL',
  data: {
    baseType: { definition: 'base-type', value: 'REAL' },
    dimensions: [{ dimension: '1..5' }, { dimension: '0..2' }],
  },
}

const ARRAY_0_3_OF_BOOL: VariableType = {
  definition: 'array',
  value: 'ARRAY [0..3] OF BOOL',
  data: { baseType: { definition: 'base-type', value: 'BOOL' }, dimensions: [{ dimension: '0..3' }] },
}

const makeHandlers = (result: ProjectResponse | undefined) => ({
  setArrayModalIsOpen: vi.fn((value: boolean): boolean => value),
  closeContainer: vi.fn((): undefined => undefined),
  onSave: vi.fn((_type: VariableType): ProjectResponse | undefined => result),
})

type Handlers = ReturnType<typeof makeHandlers>

const modal = (variableType: VariableType, handlers: Handlers) => (
  <GlobalArrayModal
    variableType={variableType}
    arrayModalIsOpen
    setArrayModalIsOpen={handlers.setArrayModalIsOpen}
    closeContainer={handlers.closeContainer}
    onSave={handlers.onSave}
  />
)

const renderModal = (variableType: VariableType, handlers: Handlers) =>
  render(modal(variableType, handlers), { wrapper: createStoreWrapper(createTestStore()) })

const dialogDimensions = () =>
  within(screen.getByRole('dialog'))
    .queryAllByLabelText('Array dimension input')
    .map((row) => row.querySelector('input')?.value)

const dialogBaseType = () => screen.getByRole('dialog').querySelector('[aria-haspopup="menu"] span')?.textContent

/** Adds one dimension row and commits its text the way the input does on blur. */
const addDimension = (dimension: string) => {
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByLabelText('Add table row button'))
  const input = within(dialog).getAllByLabelText('Array dimension input').at(-1)?.querySelector('input')
  if (!input) throw new Error('no dimension input')
  fireEvent.change(input, { target: { value: dimension } })
  fireEvent.blur(input)
}

const pickBaseType = (baseType: string) => {
  const trigger = screen.getByRole('dialog').querySelector('[aria-haspopup="menu"]')
  if (!(trigger instanceof HTMLElement)) throw new Error('no base type selector')
  fireEvent.keyDown(trigger, { key: 'Enter' })
  const subTrigger = screen.getByText('Base Type').closest('[role="menuitem"]')
  if (!(subTrigger instanceof HTMLElement)) throw new Error('no Base Type submenu')
  fireEvent.keyDown(subTrigger, { key: 'ArrowRight' })
  fireEvent.click(screen.getByRole('menuitem', { name: baseType }))
}

const save = () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))

const lastToast = () => getMemoryState().toasts[0]

const stayedOpen = (handlers: Handlers) =>
  handlers.closeContainer.mock.calls.length === 0 &&
  !handlers.setArrayModalIsOpen.mock.calls.some(([value]) => value === false)

beforeEach(() => {
  dispatch({ type: 'REMOVE_TOAST' })
})

describe('GlobalArrayModal initial state comes from variableType', () => {
  it('shows the dimensions and base type of an array variableType', () => {
    renderModal(ARRAY_1_5_0_2_OF_REAL, makeHandlers({ ok: true }))

    expect({ dimensions: dialogDimensions(), baseType: dialogBaseType() }).toEqual({
      dimensions: ['1..5', '0..2'],
      baseType: 'REAL',
    })
  })

  it('shows no dimension and base type DINT for a non-array variableType', () => {
    renderModal(INT, makeHandlers({ ok: true }))

    expect({ dimensions: dialogDimensions(), baseType: dialogBaseType() }).toEqual({
      dimensions: [],
      baseType: 'DINT',
    })
  })

  it('refreshes when variableType changes', () => {
    const handlers = makeHandlers({ ok: true })
    const { rerender } = renderModal(ARRAY_1_5_0_2_OF_REAL, handlers)

    rerender(modal(ARRAY_0_3_OF_BOOL, handlers))

    expect({ dimensions: dialogDimensions(), baseType: dialogBaseType() }).toEqual({
      dimensions: ['0..3'],
      baseType: 'BOOL',
    })
  })
})

describe('GlobalArrayModal save goes through onSave', () => {
  it('passes the built array type to onSave exactly once', () => {
    const handlers = makeHandlers({ ok: true })
    renderModal(INT, handlers)

    addDimension('0..9')
    pickBaseType('INT')
    save()

    expect(handlers.onSave.mock.calls).toEqual([
      [
        {
          definition: 'array',
          value: 'ARRAY [0..9] OF INT',
          data: { baseType: { definition: 'base-type', value: 'INT' }, dimensions: [{ dimension: '0..9' }] },
        },
      ],
    ])
  })

  it('closes the dialog and its container when onSave answers ok', () => {
    const handlers = makeHandlers({ ok: true })
    renderModal(ARRAY_0_3_OF_BOOL, handlers)

    save()

    expect({
      setOpen: handlers.setArrayModalIsOpen.mock.calls,
      containerClosed: handlers.closeContainer.mock.calls.length,
    }).toEqual({ setOpen: [[false]], containerClosed: 1 })
  })

  it('shows a fail toast with the result title and message and stays open when onSave answers ok: false', () => {
    const handlers = makeHandlers({ ok: false, title: 'Invalid type', message: 'Rejected by the table' })
    renderModal(ARRAY_0_3_OF_BOOL, handlers)

    save()

    expect({
      saves: handlers.onSave.mock.calls.length,
      toast: lastToast(),
      stayedOpen: stayedOpen(handlers),
    }).toEqual({
      saves: 1,
      toast: expect.objectContaining({ title: 'Invalid type', description: 'Rejected by the table', variant: 'fail' }),
      stayedOpen: true,
    })
  })

  it('shows a fail toast and stays open when onSave answers undefined', () => {
    const handlers = makeHandlers(undefined)
    renderModal(ARRAY_0_3_OF_BOOL, handlers)

    save()

    expect({
      saves: handlers.onSave.mock.calls.length,
      variant: lastToast()?.variant,
      stayedOpen: stayedOpen(handlers),
    }).toEqual({ saves: 1, variant: 'fail', stayedOpen: true })
  })

  it('refuses an array with no non-empty dimension without calling onSave', () => {
    const handlers = makeHandlers({ ok: true })
    renderModal(INT, handlers)

    save()

    expect({
      saves: handlers.onSave.mock.calls.length,
      toast: lastToast(),
      stayedOpen: stayedOpen(handlers),
    }).toEqual({
      saves: 0,
      toast: expect.objectContaining({ title: 'Invalid array', variant: 'fail' }),
      stayedOpen: true,
    })
  })
})
