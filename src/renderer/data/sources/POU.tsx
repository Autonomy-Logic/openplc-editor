import {
  DataTypeIcon,
  FBDIcon,
  FunctionBlockIcon,
  FunctionIcon,
  ILIcon,
  LDIcon,
  ProgramIcon,
  SFCIcon,
  STIcon,
} from '@root/renderer/assets'

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
] as const

const CreatePouSources = {
  function: <FunctionIcon size='sm' />,
  'function-block': <FunctionBlockIcon size='sm' />,
  program: <ProgramIcon size='sm' />,
  'data-type': <DataTypeIcon size='sm' />,
}

export { CreatePouSources, PouLanguageSources }
