/**
 * Whether the assistant may talk to Autonomy Edge, and how a refused request changes that.
 *
 * The AI routes need an Edge session, and on a build where signing in is optional the
 * panel can be opened without one. The account is read first, so the gate shows BEFORE a
 * request is made; a 401 on a request becomes the same gate and re-reads the account.
 */

import { useCallback, useEffect, useState } from 'react'

import type { EdgeAccountPort } from '../../../../../middleware/shared/ports/edge-account-port'
import type { PlatformCapabilities } from '../../../../../middleware/shared/ports/platform-capabilities'
import { useEdgeAccount } from '../../../../hooks/use-edge-account'

/** The status the AI routes answer a missing or refused session with. */
const SIGN_IN_STATUS = 401

export interface AssistantAccess {
  /** The panel should show the sign-in state instead of talking to the model. */
  needsSignIn: boolean
  /** The account is known good (or the build has none), so reads that need a session may run. */
  ready: boolean
  reason: 'expired' | 'signed-out'
  /** Record a refused request. True when it was a sign-in refusal and the gate now shows. */
  noteRefusal: (status: number | undefined) => boolean
  /** A sign-in completed from this panel. */
  signedIn: () => void
}

export function useAssistantAccess(capabilities: PlatformCapabilities, account?: EdgeAccountPort): AssistantAccess {
  const gated = capabilities.hasEdgeAccount && account !== undefined
  const { status, signedOutReason, refresh } = useEdgeAccount(gated, account)
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    if (status === 'signed-in') {
      setRefused(false)
    }
  }, [status])

  const noteRefusal = useCallback(
    (httpStatus: number | undefined): boolean => {
      if (!gated || httpStatus !== SIGN_IN_STATUS) {
        return false
      }

      setRefused(true)
      // The account hook has not seen the refusal — the request was not one it made.
      void refresh()

      return true
    },
    [gated, refresh],
  )

  const signedIn = useCallback(() => {
    setRefused(false)
    void refresh()
  }, [refresh])

  return {
    needsSignIn: gated && (status === 'signed-out' || refused),
    ready: !gated || status === 'signed-in',
    reason: signedOutReason,
    noteRefusal,
    signedIn,
  }
}
