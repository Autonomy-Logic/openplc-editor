import { useOpenPLCStore } from '@root/frontend/store'
import {
  type ModbusMasterProfile,
  resolveModbusMasterProfile,
} from '@root/middleware/shared/utils/modbus-master-profile'
import { useMemo } from 'react'

import { useTargetCapabilities } from './use-target-capabilities'

/** The active target's Modbus master profile, resolved from the selected board and its capabilities. */
export function useModbusMasterProfile(): ModbusMasterProfile {
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const availableBoards = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards)
  const capabilities = useTargetCapabilities()

  return useMemo(
    () => resolveModbusMasterProfile(availableBoards.get(deviceBoard), capabilities),
    [availableBoards, deviceBoard, capabilities],
  )
}
