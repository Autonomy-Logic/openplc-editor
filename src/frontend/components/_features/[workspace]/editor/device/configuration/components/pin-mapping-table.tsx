import { toast } from '@root/frontend/components/_features/[app]/toast/use-toast'
import { pinSelectors } from '@root/frontend/hooks/use-store-selectors'
import { useOpenPLCStore } from '@root/frontend/store'
import type { DevicePin } from '@root/middleware/shared/ports/types'
import {
  buildAddressPool,
  buildAliasRegistry,
  describeSource,
  validateAliasEdit,
} from '@root/middleware/shared/utils/iec-address'
import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'
import { createColumnHelper } from '@tanstack/react-table'

import { GenericTable } from '../../../../../../_atoms/generic-table'
import { PinComboboxInputCell } from '../../../../../../_molecules/pin-mapping-table/combobox-input'
import { PinSelectInputCell } from '../../../../../../_molecules/pin-mapping-table/select-input'
import { PinTextInputCell } from '../../../../../../_molecules/pin-mapping-table/text-input'

const columnHelper = createColumnHelper<DevicePin>()

const columns = [
  columnHelper.accessor('pin', {
    header: 'Pin',
    cell: PinComboboxInputCell,
  }),
  columnHelper.accessor('pinType', {
    header: 'Type',
    cell: PinSelectInputCell,
  }),
  columnHelper.accessor('address', {
    header: 'Address',
    cell: (props) => props.getValue(),
  }),
  columnHelper.accessor('alias', {
    header: 'Alias',
    cell: PinTextInputCell,
  }),
]

type PinMappingTableProps = {
  pins: DevicePin[]
  selectedRowId: number
  handleRowClick: (row: HTMLTableRowElement) => void
}

const PinMappingTable = ({ pins, selectedRowId, handleRowClick }: PinMappingTableProps) => {
  const updatePin = pinSelectors.useUpdatePin()

  const handleUpdateDataRequest = (_rowIndex: number, columnId: string, value: unknown) => {
    // Phase 1 — write-time alias-uniqueness gate (global, across all
    // producers).  `checkIfPinAliasIsValid` inside the slice's
    // `updatePin` already enforces uniqueness *within* the active
    // board's pin list; this additional check covers the cross-
    // producer case where a pin alias collides with a VPP channel
    // alias, a Modbus point alias, or an EtherCAT channel alias.
    if (columnId === 'alias' && typeof value === 'string') {
      const state = useOpenPLCStore.getState()
      const board = state.deviceDefinitions.configuration.deviceBoard
      const currentPins = state.deviceDefinitions.pinMapping.pinsByBoard[board] ?? []
      const currentPin = currentPins[state.deviceDefinitions.pinMapping.currentSelectedPinTableRow]
      const sourceRef = { kind: 'pin-mapping' as const, ref: currentPin?.address ?? '' }
      const boardInfo = state.deviceAvailableOptions.availableBoards.get(board ?? '')
      const ioMapping =
        (
          state.deviceDefinitions.configuration.vendorScreenData?.['io-mapping'] as
            | { entries?: Array<{ iecAddress: string; alias?: string; slot: number; channelName: string }> }
            | undefined
        )?.entries ?? []
      const pool = buildAddressPool(
        {
          pinMapping: { pins: currentPins },
          vendorIoMapping: { entries: ioMapping },
          remoteDevices: state.project.data.remoteDevices,
        },
        resolveTargetCapabilities(boardInfo),
      )
      const registry = buildAliasRegistry(pool)
      const validation = validateAliasEdit(registry, value, sourceRef)
      if (!validation.ok) {
        toast({
          title: 'Alias already in use',
          description: `"${value}" is already assigned to ${describeSource(validation.conflict.source)} (${validation.conflict.address}). Alias names must be unique across all I/O channels.`,
          variant: 'fail',
        })
        return { ok: false, title: 'Alias already in use', message: 'Pin alias collides with another producer.' }
      }

      // Cascade the rename onto bound variables: any variable whose
      // `location` holds the old alias name follows to the new one, so it
      // stays located (resolved to the address at compile time) rather than
      // orphaning.
      const oldAlias = currentPin?.alias ?? ''
      if (oldAlias) {
        useOpenPLCStore.getState().projectActions.renameAlias(oldAlias, value)
      }
    }

    const res = updatePin({
      [columnId as keyof DevicePin]: value,
    })
    // No variable re-sync needed: variables bound to this pin hold its alias
    // NAME (resolved at compile time), and the rename above already cascaded
    // to them via `renameAlias`. Manual literal locations are honoured
    // verbatim and are the user's responsibility.
    return res
  }

  return (
    <GenericTable<DevicePin>
      columns={columns}
      tableData={pins}
      selectedRow={selectedRowId}
      handleRowClick={handleRowClick}
      updateData={handleUpdateDataRequest}
      tableContext='Pin mapping table'
    />
  )
}

export { PinMappingTable }
