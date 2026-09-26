/**
 * Refresh reloads the app, so unsaved work goes through the save-changes prompt first.
 */

import { requestAppRefresh } from '../refresh-app'

function setup(editingState: 'unsaved' | 'saved' | 'initial-state') {
  const openModal = vi.fn()
  const reload = vi.fn()
  requestAppRefresh(editingState, openModal, { reload })
  return { openModal, reload }
}

describe('requestAppRefresh', () => {
  it.each(['saved', 'initial-state'] as const)('reloads straight away when the project is %s', (state) => {
    const { openModal, reload } = setup(state)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(openModal).not.toHaveBeenCalled()
  })

  it('asks to save first when the project is unsaved, without reloading', () => {
    const { openModal, reload } = setup('unsaved')

    expect(openModal).toHaveBeenCalledWith('save-changes-project', { validationContext: 'refresh-app' })
    expect(reload).not.toHaveBeenCalled()
  })
})
