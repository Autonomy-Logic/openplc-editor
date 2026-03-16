import { CppIcon } from '../../assets/icons/project/Cpp'
import { DataTypeIcon } from '../../assets/icons/project/DataType'
import { FBDIcon } from '../../assets/icons/project/FBD'
import { FunctionIcon } from '../../assets/icons/project/Function'
import { FunctionBlockIcon } from '../../assets/icons/project/FunctionBlock'
import { ILIcon } from '../../assets/icons/project/IL'
import { LDIcon } from '../../assets/icons/project/LD'
import { ProgramIcon } from '../../assets/icons/project/Program'
import { PythonIcon } from '../../assets/icons/project/Python'
import { RemoteDeviceIcon } from '../../assets/icons/project/RemoteDevice'
import { ServerIcon } from '../../assets/icons/project/Server'
import { SFCIcon } from '../../assets/icons/project/SFC'
import { STIcon } from '../../assets/icons/project/ST'

const PouLanguageSources = [
  {
    icon: <LDIcon />,
    value: 'Ladder Diagram',
  },
  {
    icon: <STIcon />,
    value: 'Structured Text',
  },
  {
    icon: <ILIcon />,
    value: 'Instruction List',
  },
  {
    icon: <FBDIcon />,
    value: 'Functional Block Diagram',
  },
  {
    icon: <SFCIcon />,
    value: 'Sequential Functional Chart',
  },
  {
    icon: <PythonIcon />,
    value: 'Python',
  },
  {
    icon: <CppIcon />,
    value: 'C/C++',
  },
] as const

const CreatePouSources = {
  function: <FunctionIcon size='sm' />,
  'function-block': <FunctionBlockIcon size='sm' />,
  program: <ProgramIcon size='sm' />,
  'data-type': <DataTypeIcon size='sm' />,
  server: <ServerIcon size='sm' />,
  'remote-device': <RemoteDeviceIcon size='sm' />,
}

export { CreatePouSources, PouLanguageSources }
