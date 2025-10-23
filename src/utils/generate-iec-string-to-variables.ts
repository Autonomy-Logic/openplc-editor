import { LibraryState } from '@root/renderer/store/slices/library/type'
import { baseTypeSchema, PLCVariable } from '@root/types/PLC'
import { PLCDataType, PLCPou } from '@root/types/PLC/open-plc'
import { v4 as uuidv4 } from 'uuid'

const varBlockToClass: Record<string, PLCVariable['class']> = {
  VAR: 'local',
  VAR_INPUT: 'input',
  VAR_OUTPUT: 'output',
  VAR_IN_OUT: 'inOut',
  VAR_EXTERNAL: 'external',
  VAR_TEMP: 'temp',
  VAR_GLOBAL: 'global',
}

const lineRegex =
  // eslint-disable-next-line no-useless-escape
  /^\s*(?<name>\w+)(?:\s+AT\s+(?<location>%[\w\d\._]+))?\s*:\s*(?<type>[\w\s\[\]\.]+?)\s*(?::=\s*(?<initialValue>[^;]+?))?\s*;\s*(?:\(\*\s*(?<documentation>.*?)\s*\*\))?$/

const guessErrorReason = (line: string): string => {
  if (!line.includes(';')) return 'missing semicolon (;) at the end of the declaration'
  if (!line.includes(':')) return 'missing colon (:) between name and type'
  // eslint-disable-next-line no-useless-escape
  if (/[^A-Za-z0-9_\s:;=%()/*\-.\[\]]/.test(line)) return 'invalid or unsupported characters'
  return 'unrecognized declaration format'
}

export const parseIecStringToVariables = (
  iecString: string,
  pous?: PLCPou[],
  _dataTypes?: PLCDataType[],
  libraries?: LibraryState['libraries'],
): PLCVariable[] => {
  const variables: PLCVariable[] = []
  const lines = iecString.split(/\r?\n/)
  let currentClass: PLCVariable['class'] | null = null

  lines.forEach((rawLine, idx) => {
    const lineNumber = idx + 1
    const line = rawLine.trim()
    if (line === '') return

    const blockStart = line.match(/^(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_EXTERNAL|VAR_TEMP|VAR_GLOBAL|VAR)\b/i)
    if (blockStart) {
      currentClass = varBlockToClass[blockStart[1].toUpperCase()]
      return
    }

    if (/^END_VAR\b/i.test(line)) {
      currentClass = null
      return
    }

    if (!currentClass) return

    const match = line.match(lineRegex)
    if (!match || !match.groups) {
      throw new Error(`Syntax error on line ${lineNumber}: "${line}". Possible cause: ${guessErrorReason(line)}.`)
    }

    const { name, location, type, initialValue, documentation } = match.groups

    const disallowedLocationClasses: Array<PLCVariable['class']> = ['input', 'output', 'inOut', 'external', 'temp']

    if (location && disallowedLocationClasses.includes(currentClass)) {
      throw new Error(
        `Syntax error on line ${lineNumber}: Location ("AT") is not allowed for variables of class "${currentClass.toUpperCase()}".`,
      )
    }

    if (initialValue && currentClass === 'external') {
      throw new Error(
        `Syntax error on line ${lineNumber}: Initial Value (":=") is not allowed for variables of class "EXTERNAL".`,
      )
    }

    const parsedType = type.trim()
    const baseCheck = baseTypeSchema.safeParse(parsedType.toLowerCase())

    console.log('[PARSER DEBUG] Parsing type', {
      parsedType,
      baseCheckSuccess: baseCheck.success,
      baseCheckData: baseCheck.success ? baseCheck.data : null,
      pousCount: pous?.length ?? 0,
      pous: pous?.map((p) => ({ name: p.data.name, type: p.type })) ?? [],
      librariesAvailable: !!libraries,
    })

    const isUserFunctionBlock = pous?.some(
      (pou) => pou.type === 'function-block' && pou.data.name.toLowerCase() === parsedType.toLowerCase(),
    )

    const isSystemFunctionBlock = libraries?.system.some((lib) => {
      const libPous = ('pous' in lib ? lib.pous : []) as Array<{ name: string; type: string }>
      return libPous.some((pou) => pou.type === 'function-block' && pou.name.toLowerCase() === parsedType.toLowerCase())
    })

    const isUserLibraryFunctionBlock = libraries?.user.some(
      (lib) => lib.type === 'function-block' && lib.name.toLowerCase() === parsedType.toLowerCase(),
    )

    const isFunctionBlock = isUserFunctionBlock || isSystemFunctionBlock || isUserLibraryFunctionBlock

    console.log('[PARSER DEBUG] Function block check', {
      parsedType,
      isUserFunctionBlock,
      isSystemFunctionBlock,
      isUserLibraryFunctionBlock,
      isFunctionBlock,
    })

    const typeDefinition: PLCVariable['type'] = baseCheck.success
      ? { definition: 'base-type' as const, value: baseCheck.data }
      : isFunctionBlock
        ? { definition: 'derived' as const, value: parsedType }
        : { definition: 'user-data-type' as const, value: parsedType }

    console.log('[PARSER DEBUG] Final type definition', {
      parsedType,
      typeDefinition,
    })

    variables.push({
      id: uuidv4(),
      name: name.trim(),
      class: currentClass,
      type: typeDefinition,
      location: location ? location.trim() : '',
      initialValue: initialValue ? initialValue.trim() : null,
      documentation: documentation ? documentation.trim() : '',
      debug: false,
    })
  })

  return variables
}
