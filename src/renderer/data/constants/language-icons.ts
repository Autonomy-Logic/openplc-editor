import { CppIcon, FBDIcon, ILIcon, LDIcon, PythonIcon, SFCIcon, STIcon } from '@process:renderer/assets'

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
