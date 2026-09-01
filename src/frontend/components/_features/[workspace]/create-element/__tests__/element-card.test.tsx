import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { useOpenPLCStore } from '@root/frontend/store'
import { getMemoryState } from '@root/frontend/utils/toast'

import { ElementCard } from '../element-card'

function seed({ pous = [], dataTypes = [] }: { pous?: string[]; dataTypes?: string[] } = {}) {
  useOpenPLCStore.setState((state) => ({
    ...state,
    project: {
      ...state.project,
      data: { ...state.project.data, pous: [], dataTypes: [], globalVariableLists: [] },
    },
  }))
  const store = useOpenPLCStore.getState()
  for (const name of pous) store.pouActions.create({ type: 'program', name, language: 'st' })
  for (const name of dataTypes) store.datatypeActions.create({ name, derivation: 'structure' })
}

const dataTypeNames = () => useOpenPLCStore.getState().project.data.dataTypes.map((d) => d.name)

const latestToast = () => getMemoryState().toasts[0]

/** Open the card, fill the form and submit it. */
async function createDataType(name: string) {
  const user = userEvent.setup()
  render(<ElementCard target='data-type' closeContainer={() => undefined} />)

  // The Popover trigger opens on a plain click; user-event's full pointer sequence
  // leaves it closed. The derivation Select is the reverse — it needs the real
  // sequence, since jsdom never delivers the pointerdown `fireEvent` synthesises.
  fireEvent.click(screen.getByRole('button', { name: /data type/i }))
  await user.type(screen.getByPlaceholderText('Data type name'), name)
  await user.click(screen.getByLabelText('data-type-derivation'))
  await user.click(await screen.findByRole('option', { name: /structure/i }))
  await user.click(screen.getByRole('button', { name: 'Create' }))
}

describe('ElementCard — data type creation', () => {
  beforeEach(() => seed())

  it('creates the data type when the name is free', async () => {
    await createDataType('Motor')

    expect(dataTypeNames()).toEqual(['Motor'])
  })

  /**
   * The form used to discard the action's result: on a refusal it closed with nothing
   * created and nothing said. The reason has to reach the user, and it is often about a
   * POU rather than another data type.
   */
  it('keeps the form open and shows the store reason when the name belongs to a POU', async () => {
    seed({ pous: ['Pump'] })
    await createDataType('pump')

    expect(screen.getByText(/"pump" is already the name of a POU/)).toBeTruthy()
    expect(latestToast()?.description).toBe('"pump" is already the name of a POU')
    expect(dataTypeNames()).toEqual([])
    expect(screen.getByPlaceholderText('Data type name')).toBeTruthy()
  })

  it('shows the store reason when the name belongs to another data type', async () => {
    seed({ dataTypes: ['Motor'] })
    await createDataType('motor')

    expect(screen.getByText(/Data type name already exists/)).toBeTruthy()
    expect(dataTypeNames()).toEqual(['Motor'])
  })
})
