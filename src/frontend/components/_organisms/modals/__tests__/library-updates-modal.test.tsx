import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { useOpenPLCStore } from '@root/frontend/store'

import { LibraryUpdatesModal } from '../library-updates-modal'

/** One library the project pins below a version already installed. */
function seed(pinned = '0.1.0', available = ['0.2.0', '0.1.0']) {
  useOpenPLCStore.setState((state) => ({
    ...state,
    project: {
      ...state.project,
      data: { ...state.project.data, libraries: [{ name: 'libtest-basic', version: pinned }] },
    },
    installedLibraries: available.map(
      (version) => ({ name: 'libtest-basic', author: '', version, stPath: '', cPath: '', pous: [] }) as never,
    ),
    outdatedLibraries: [{ name: 'libtest-basic', pinned, available }],
  }))
  useOpenPLCStore.getState().modalActions.openModal('library-updates')
}

const pinnedVersion = () =>
  useOpenPLCStore.getState().project.data.libraries?.find((l) => l.name === 'libtest-basic')?.version

describe('LibraryUpdatesModal', () => {
  it('lists the outdated library with the version in use', () => {
    seed()
    render(<LibraryUpdatesModal />)

    expect(screen.getByText('Library updates')).toBeTruthy()
    expect(screen.getByText('libtest-basic')).toBeTruthy()
    expect(screen.getByText('in use: v0.1.0')).toBeTruthy()
  })

  it('proposes the newest version and offers it as the action', () => {
    seed()
    render(<LibraryUpdatesModal />)

    // The trigger shows the proposed action, the way CODESYS names one.
    expect(screen.getByRole('combobox', { name: 'Version for libtest-basic' }).textContent).toContain('Use v0.2.0')
    expect((screen.getByRole('button', { name: 'Update 1' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('applies the pin and closes when Update is pressed', async () => {
    const user = userEvent.setup()
    seed()
    render(<LibraryUpdatesModal />)

    await user.click(screen.getByRole('button', { name: 'Update 1' }))

    expect(pinnedVersion()).toBe('0.2.0')
    expect(useOpenPLCStore.getState().modals['library-updates']?.open).toBe(false)
  })

  it('changes nothing when dismissed', async () => {
    const user = userEvent.setup()
    seed()
    render(<LibraryUpdatesModal />)

    await user.click(screen.getByRole('button', { name: 'Not now' }))

    expect(pinnedVersion()).toBe('0.1.0')
  })

  it('offers nothing to change when every row is already on its pinned version', () => {
    // `available[0]` equals the pin, so the proposed action is "keep".
    seed('0.2.0', ['0.2.0'])
    render(<LibraryUpdatesModal />)

    expect((screen.getByRole('button', { name: 'Nothing to change' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
