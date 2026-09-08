import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { useOpenPLCStore } from '@root/frontend/store'
import type { InstalledLibrary } from '@root/middleware/shared/ports/library-types'

import { ProjectLibrariesTab } from '../project-libraries-tab'

const row = (over: Partial<InstalledLibrary> = {}): InstalledLibrary => ({
  name: 'libtest-basic',
  version: '0.2.0',
  bundled: false,
  installedAt: '2026-01-01T00:00:00.000Z',
  origin: 'stlib',
  versions: ['0.2.0', '0.1.0'],
  ...over,
})

function seed({ pinned, outdated = true }: { pinned: string; outdated?: boolean }) {
  useOpenPLCStore.setState((state) => ({
    ...state,
    project: {
      ...state.project,
      data: { ...state.project.data, libraries: [{ name: 'libtest-basic', version: pinned }] },
    },
    enabledLibraries: ['libtest-basic'],
    missingLibraries: [],
    outdatedLibraries: outdated ? [{ name: 'libtest-basic', pinned, available: ['0.2.0', '0.1.0'] }] : [],
  }))
}

describe('ProjectLibrariesTab', () => {
  it('shows the version the project pins, not the newest installed', () => {
    seed({ pinned: '0.1.0' })
    render(<ProjectLibrariesTab installed={[row()]} />)

    expect(screen.getByRole('combobox', { name: 'Version of libtest-basic' }).textContent).toContain('v0.1.0')
  })

  it('offers a way into the update dialog when a newer version is installed', async () => {
    const user = userEvent.setup()
    seed({ pinned: '0.1.0' })
    render(<ProjectLibrariesTab installed={[row()]} />)

    await user.click(screen.getByRole('button', { name: /newer version installed/i }))

    expect(useOpenPLCStore.getState().modals['library-updates']?.open).toBe(true)
  })

  it('says nothing about updates when the project is on the newest', () => {
    seed({ pinned: '0.2.0', outdated: false })
    render(<ProjectLibrariesTab installed={[row()]} />)

    expect(screen.queryByRole('button', { name: /newer version installed/i })).toBeNull()
  })

  it('names a pinned version that is not installed rather than showing a wrong one', () => {
    seed({ pinned: '9.9.9', outdated: false })
    render(<ProjectLibrariesTab installed={[row()]} />)

    expect(screen.getByRole('combobox', { name: 'Version of libtest-basic' }).textContent).toContain('not installed')
  })

  it('shows how many versions are available on a library not yet added', () => {
    seed({ pinned: '0.1.0', outdated: false })
    useOpenPLCStore.setState((state) => ({ ...state, enabledLibraries: [] }))
    render(<ProjectLibrariesTab installed={[row()]} />)

    expect(screen.getByText(/2 versions/)).toBeTruthy()
  })
})
