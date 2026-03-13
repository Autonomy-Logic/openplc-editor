import {
  CppIcon,
  DataTypeIcon,
  FBDIcon,
  FunctionBlockIcon,
  FunctionIcon,
  ILIcon,
  LDIcon,
  ProgramIcon,
  PythonIcon,
  RemoteDeviceIcon,
  ServerIcon,
  SFCIcon,
  STIcon,
} from '../../assets'

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
