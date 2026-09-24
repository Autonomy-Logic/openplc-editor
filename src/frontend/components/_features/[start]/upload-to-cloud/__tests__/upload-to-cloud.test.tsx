/**
 * The project port arrives through `PlatformProvider`, not module mocks, so this file
 * runs unchanged under both runners.
 */

import { beforeEach, describe, expect, it } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

import { EDITOR_CAPABILITIES } from '../../../../../../middleware/shared/ports/platform-capabilities'
import type {
  CloudFoldersResult,
  ProjectPort,
  UploadProjectParams,
  UploadProjectResult,
} from '../../../../../../middleware/shared/ports/project-port'
import { PlatformProvider } from '../../../../../../middleware/shared/providers'
import type { PlatformPorts } from '../../../../../../middleware/shared/providers/types'
import { UploadToCloudModal } from '..'

/** A port whose every method answers `undefined`, except the ones handed in. */
function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy({} as T, {
    get: (_, prop) => {
      if (Reflect.has(overrides, prop)) return Reflect.get(overrides, prop)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

function makePorts(overrides: Partial<PlatformPorts>): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort(),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities: EDITOR_CAPABILITIES,
    ...overrides,
  }
}

const listCloudFolders = jest.fn<Promise<CloudFoldersResult>, []>()
const uploadProjectToCloud = jest.fn<Promise<UploadProjectResult>, [UploadProjectParams]>()

// Stable object: a fresh one per render would re-run the load effect and reset the chosen folder.
const projectPort = stubPort<ProjectPort>({ listCloudFolders, uploadProjectToCloud })
const ports = makePorts({ project: projectPort })

const FOLDERS = [
  { id: 'root', name: 'Root (/)', depth: 0 },
  { id: 'empty', name: 'Empty', depth: 1 },
  { id: 'forum', name: 'forum', depth: 1 },
  { id: 'packages', name: 'packages', depth: 1 },
]

const onUploaded = jest.fn<void, [string | null]>()
const onOpenChange = jest.fn<void, [boolean]>()

function renderModal() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlatformProvider ports={ports}>{children}</PlatformProvider>
  )

  return render(
    <UploadToCloudModal
      open
      onOpenChange={onOpenChange}
      projectPath='/Users/me/Projects/irrigation'
      projectName='Irrigation'
      onUploaded={onUploaded}
    />,
    { wrapper },
  )
}

const radio = (name: RegExp) => screen.getByRole<HTMLInputElement>('radio', { name })
const uploadButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Upload' })

beforeEach(() => {
  listCloudFolders.mockReset()
  uploadProjectToCloud.mockReset()
  onUploaded.mockReset()
  onOpenChange.mockReset()
  listCloudFolders.mockResolvedValue({ status: 'ok', folders: FOLDERS })
  uploadProjectToCloud.mockResolvedValue({ status: 'ok', projectId: 'p1', uploadedFiles: 3 })
})

describe('choosing a destination', () => {
  it('shows the whole hierarchy at once', async () => {
    renderModal()

    for (const folder of FOLDERS) {
      expect(
        await screen.findByRole('radio', { name: new RegExp(folder.name.replace(/[()/]/g, '\\$&')) }),
      ).not.toBeNull()
    }
  })

  it('selects the account root to begin with', async () => {
    renderModal()

    await waitFor(() => expect(radio(/Root/).checked).toBe(true))
  })

  it('lets a nested folder be picked', async () => {
    renderModal()

    await userEvent.click(await screen.findByRole('radio', { name: /forum/ }))

    expect(radio(/forum/).checked).toBe(true)
    expect(radio(/Root/).checked).toBe(false)
  })

  it('publishes into the folder that was picked', async () => {
    renderModal()

    await userEvent.click(await screen.findByRole('radio', { name: /packages/ }))
    await userEvent.click(uploadButton())

    await waitFor(() =>
      expect(uploadProjectToCloud).toHaveBeenCalledWith(expect.objectContaining({ parentFolderId: 'packages' })),
    )
  })

  it('draws a branch for a nested folder and none for the root', async () => {
    renderModal()
    await screen.findByRole('radio', { name: /forum/ })

    // The dialog is portalled, so the document body is where the connector reads.
    expect(document.body.textContent).toContain('└──')
  })
})

describe('what gets sent', () => {
  it('defaults to private', async () => {
    renderModal()
    await screen.findByRole('radio', { name: /Root/ })

    expect(radio(/Private/).checked).toBe(true)

    await userEvent.click(uploadButton())

    await waitFor(() =>
      expect(uploadProjectToCloud).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' })),
    )
  })

  it('omits the name when it was not changed', async () => {
    renderModal()
    await screen.findByRole('radio', { name: /Root/ })

    await userEvent.click(uploadButton())

    await waitFor(() => expect(uploadProjectToCloud).toHaveBeenCalled())
    expect(uploadProjectToCloud.mock.calls[0][0].projectName).toBeUndefined()
  })

  it('sends a name the user did change', async () => {
    renderModal()
    const input = await screen.findByDisplayValue('Irrigation')

    await userEvent.clear(input)
    await userEvent.type(input, 'Irrigation v2')
    await userEvent.click(uploadButton())

    await waitFor(() =>
      expect(uploadProjectToCloud).toHaveBeenCalledWith(expect.objectContaining({ projectName: 'Irrigation v2' })),
    )
  })
})

describe('when it cannot proceed', () => {
  it('asks a signed-out user to sign in, and offers no destination', async () => {
    listCloudFolders.mockResolvedValueOnce({ status: 'signed-out' })

    renderModal()

    expect(await screen.findByText(/Sign in to your Autonomy Edge account/i)).not.toBeNull()
    expect(screen.queryByRole('radio', { name: /Root/ })).toBeNull()
    expect(uploadButton().disabled).toBe(true)
  })

  it('offers a retry when Edge could not be reached', async () => {
    listCloudFolders.mockResolvedValueOnce({ status: 'unreachable' })

    renderModal()

    await userEvent.click(await screen.findByRole('button', { name: /try again/i }))

    expect(listCloudFolders).toHaveBeenCalledTimes(2)
  })

  it('does NOT claim failure when the server never answered', async () => {
    uploadProjectToCloud.mockResolvedValueOnce({
      status: 'failed',
      failure: { reason: 'unreachable', message: 'ECONNRESET' },
    })

    renderModal()
    await screen.findByRole('radio', { name: /Root/ })
    await userEvent.click(uploadButton())

    // The project may exist. Telling the user it failed invites a duplicate.
    expect(await screen.findByText(/unclear whether the project was created/i)).not.toBeNull()
    expect(onUploaded).not.toHaveBeenCalled()
  })

  it('says plainly when the folder is not an OpenPLC project', async () => {
    uploadProjectToCloud.mockResolvedValueOnce({ status: 'failed', failure: { reason: 'no-manifest' } })

    renderModal()
    await screen.findByRole('radio', { name: /Root/ })
    await userEvent.click(uploadButton())

    expect(await screen.findByText(/no project.json/i)).not.toBeNull()
  })

  it('keeps the dialog open after a failure, so the choices are not lost', async () => {
    uploadProjectToCloud.mockResolvedValueOnce({ status: 'failed', failure: { reason: 'no-manifest' } })

    renderModal()
    await screen.findByRole('radio', { name: /Root/ })
    await userEvent.click(uploadButton())

    await screen.findByText(/no project.json/i)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
