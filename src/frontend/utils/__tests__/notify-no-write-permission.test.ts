import { beforeEach, describe, expect, it, vi } from 'vitest'

import { notifyNoWritePermission } from '../notify-no-write-permission'
import { toast } from '../toast'

vi.mock('../toast', () => ({
  toast: vi.fn(),
}))

describe('notifyNoWritePermission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a warn toast that slots the action verb into the message', () => {
    notifyNoWritePermission('save changes to')

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith({
      title: 'No write permission',
      description: "You don't have permission to save changes to this project.",
      variant: 'warn',
    })
  })
})
