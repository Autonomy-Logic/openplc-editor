import { DataTypeIcon } from '../../assets/icons/project/DataType'
import { DeviceIcon } from '../../assets/icons/project/Device'
import { FunctionBlockIcon } from '../../assets/icons/project/FunctionBlock'
import { FunctionIcon } from '../../assets/icons/project/Function'
import { ProgramIcon } from '../../assets/icons/project/Program'
import { ResourceIcon } from '../../assets/icons/project/Resource'

export const PouIcon = {
  function: FunctionIcon,
  'function-block': FunctionBlockIcon,
  program: ProgramIcon,
  resource: ResourceIcon,
  'data-type': DataTypeIcon,
  device: DeviceIcon,
}

export type PouIconType = typeof PouIcon
