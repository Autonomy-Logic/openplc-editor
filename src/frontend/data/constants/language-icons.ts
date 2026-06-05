import { CppIcon } from '../../assets/icons/project/Cpp'
import { FBDIcon } from '../../assets/icons/project/FBD'
import { ILIcon } from '../../assets/icons/project/IL'
import { LDIcon } from '../../assets/icons/project/LD'
import { PythonIcon } from '../../assets/icons/project/Python'
import { SFCIcon } from '../../assets/icons/project/SFC'
import { STIcon } from '../../assets/icons/project/ST'

export const LanguageIcon = {
  st: STIcon,
  il: ILIcon,
  ld: LDIcon,
  fbd: FBDIcon,
  sfc: SFCIcon,
  python: PythonIcon,
  cpp: CppIcon,
}

export type LanguageIconType = typeof LanguageIcon
