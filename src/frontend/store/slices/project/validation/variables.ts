import type { PLCVariable } from '../../../../../middleware/shared/ports/types'
import {
  formatAddress,
  parseAddress,
  type ParsedAddress,
  slotRangesOverlap,
} from '../../../../../middleware/shared/utils/iec-address/registry'
import { DISALLOWED_LOCATION_CLASSES } from '../../../../utils/generate-iec-string-to-variables'
import {
  BOOL_LOCATION_REGEX,
  BYTE_LOCATION_REGEX,
  DWORD_LOCATION_REGEX,
  LWORD_LOCATION_REGEX,
  WORD_LOCATION_REGEX,
} from '../../../../utils/PLC/address-constants/types'
import { getArrayTotalElements, isArrayVariable } from '../../../../utils/PLC/array-codegen-helpers'
import type { ProjectResponse } from '../types'

/**
 * This function extracts the number at the end of a string.
 */
export const extractNumberAtEnd = (str: string): { number: number; string: string; length: number } => {
  const match = str.match(/(\d+)$/)
  const number = match ? parseInt(match[0], 10) : -1
  return {
    number,
    string: match ? match[0] : '',
    length: match ? match[0].length : 0,
  }
}

/**
 * This is a validation to check if the variable name already exists.
 **/
const checkIfVariableExists = (variables: PLCVariable[], name: string) => {
  const nameAlreadyInUse = variables.some((variable) => variable.name.toLowerCase() === name.toLowerCase())
  return nameAlreadyInUse
}
const checkIfGlobalVariableExists = (variables: PLCVariable[], name: string) => {
  return variables.some((variable) => variable.name === name)
}

/**
 * How many consecutive slots a variable claims from its location.
 *
 * A scalar claims one. An ARRAY claims one per element, laid out from the
 * declared address — `AT %MW60 : ARRAY [0..66] OF WORD` runs through `%MW126`
 * (openplc-editor#565). `getArrayTotalElements` already computes the product
 * of the dimensions and answers `0` for a shape it cannot read, which
 * `slotRangesOverlap` floors back to 1: an unreadable array must not silently
 * claim nothing.
 */
const slotsClaimedBy = (variable: PLCVariable): number =>
  isArrayVariable(variable) ? getArrayTotalElements(variable) : 1

/**
 * A multi-dimensional array cannot be located.
 *
 * `AT %MW0 : ARRAY [0..3, 0..3] OF WORD` has no single linear run of addresses
 * to occupy, and the compiler says exactly that:
 *
 *   Located variable 'MD' at %MW0 cannot be placed: a 2-dimensional array has
 *   no single linear run of addresses to occupy.
 *
 * The editor has to refuse it too. `getArrayTotalElements` happily returns the
 * product of every dimension (16 here), so without this the editor would place
 * it, reserve 16 slots, and let the user discover the problem at build time —
 * the same accept-here/reject-there divergence this whole change exists to
 * close.
 */
const hasUnlocatableShape = (variableType: PLCVariable['type']): boolean =>
  variableType.definition === 'array' && (variableType.data?.dimensions.length ?? 0) > 1

/** Wording shared by both places that refuse a multi-dimensional located array. */
const UNLOCATABLE_SHAPE_MESSAGE =
  'A multi-dimensional array cannot have a physical location: it has no single run of consecutive addresses to occupy. Use a one-dimensional array, or leave it unlocated.'

/**
 * Does `location` collide with a location another variable already holds?
 *
 * Two literal `%…` addresses collide when their SLOT RANGES overlap, not when
 * the strings match. An array is a contiguous area, so `arr AT %QX0.0 :
 * ARRAY [0..9] OF BOOL` covers `%QX0.0`–`%QX1.1` and conflicts with a plain
 * `flag AT %QX0.6` — two different strings, one piece of storage. Comparing
 * for string equality (all that was needed while every variable took one slot)
 * let the editor build a project the compiler then rejected.
 *
 * A location that is NOT a literal address is an alias name, and there the
 * test stays exact equality: an alias resolves to one producer channel, so two
 * variables naming the same alias collide and two different names never do.
 *
 * `exclude` skips the variable being updated so re-setting its own location
 * doesn't trip the check against itself.
 */
const checkIfLocationExists = (variables: PLCVariable[], location: string, slots: number, exclude?: PLCVariable) => {
  const parsed = parseAddress(location)

  return variables.some((variable) => {
    if (variable === exclude) return false
    if (parsed === null) return variable.location === location

    const otherParsed = parseAddress(variable.location)
    if (otherParsed === null) return false

    return slotRangesOverlap(parsed, slots, otherParsed, slotsClaimedBy(variable))
  })
}

/**
 * This is a validation to check if the variable name is correct.
 * CamelCase, PascalCase or SnakeCase and can not be empty.
 **/
const variableNameValidation = (variableName: string) => {
  const regex =
    /^([a-zA-Z0-9]+(?:[A-Z][a-z0-9]*)*)|([A-Z][a-z0-9]*(?:[A-Z][a-z0-9]*)*)|([a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)*)$/
  return regex.test(variableName)
}

/**
 * This is a validation to check if the enumerated variable name is correct.
 *
 * The validation have to obey this rules:
 * - CamelCase, PascalCase or SnakeCase
 * - Can not be empty
 * - Can not be a reserved word
 */
const enumeratedValidation = ({ value }: { value: string }) => {
  const regex =
    /^([a-zA-Z0-9]+(?:[A-Z][a-z0-9]*)*)|([A-Z][a-z0-9]*(?:[A-Z][a-z0-9]*)*)|([a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)*)$/
  if (value === '') {
    return {
      ok: false,
      title: 'Invalid enumerated value',
      message: `The enumerated value can not be empty.`,
    }
  }

  if (!regex.test(value)) {
    return {
      ok: false,
      title: 'Invalid enumerated value',
      message: `The enumerated value "${value}" is invalid. Valid names: CamelCase, PascalCase or SnakeCase.`,
    }
  }
  return { ok: true }
}

/**
 * This is a validation to check if the array variable is correct.
 *
 * The validation have to obey this rules:
 * 1. There CANNOT be space between the numeric values and dots
 * 2. The second number MUST always be greater than the first
 * 3. Only integer numbers can be used (shouldn't accept floating numbers or strings of any type)
 */
const validateArrayValue = (value: string) => {
  const [left, right] = value.split('..').map(Number)
  return Number.isInteger(left) && Number.isInteger(right) && left < right
}
const arrayValidation = ({ value }: { value: string }) => {
  const regex = /^(\d+)\.\.(\d+)$/
  if (value === '') {
    return {
      ok: false,
      title: 'Invalid array value',
      message: `The array value can not be empty.`,
    }
  }
  if (!regex.test(value) || !validateArrayValue(value)) {
    return {
      ok: false,
      title: 'Invalid array value',
      message: `The array value "${value}" is invalid. Pattern: "LEFT_number..RIGHT_number" and RIGHT must be GREATER than LEFT. Example: 0..10.`,
    }
  }
  return { ok: true }
}

/**
 * The type that has to match the address class, given a variable's declared
 * type.
 *
 * For an array this is the ELEMENT type: `ARRAY [0..66] OF WORD AT %MW60`
 * occupies 67 consecutive WORD slots, so what has to fit `%MW` is WORD, not
 * the array (openplc-editor#565). Locating an array used to be rejected
 * outright — a limitation of the MatIEC-era toolchain that left with MatIEC.
 *
 * Returns the type's own name for every other definition, which lands
 * `user-data-type` and `derived` on the `default` branch below, where they
 * belong: a STRUCT has no single address class.
 */
const addressClassTypeOf = (variableType: PLCVariable['type']): string =>
  // `data` is optional on the port-side type; an array without it is a
  // half-built row from the array modal, and falling back to `value` (the
  // "ARRAY [...] OF T" text) lands it on the `default` branch — rejected with
  // a message, which is the right answer for a type that isn't finished.
  variableType.definition === 'array' && variableType.data ? variableType.data.baseType.value : variableType.value

/**
 * Validate a variable's `location`. Single-field model: `location` is either
 * an alias name, a literal IEC address, or empty.
 *   - Empty → unlocated, valid.
 *   - A non-`%` value → an alias name; its concrete address (and therefore
 *     its type match) is resolved at compile time, so accept it here.
 *   - A literal `%…` → must match the variable's type's address class.
 */
const variableLocationValidation = (variableLocation: string, variableType: string) => {
  if (variableLocation === '' || !variableLocation.startsWith('%')) return true
  switch (variableType.toUpperCase()) {
    case 'BOOL': {
      const boolMatch = BOOL_LOCATION_REGEX.test(variableLocation) && variableLocation.split('.')[1] <= '7'
      return boolMatch
    }
    case 'BYTE':
    case 'SINT':
    case 'USINT':
      return BYTE_LOCATION_REGEX.test(variableLocation)
    case 'INT':
    case 'UINT':
    case 'WORD':
      return WORD_LOCATION_REGEX.test(variableLocation)
    case 'DINT':
    case 'UDINT':
    case 'REAL':
    case 'DWORD':
      return DWORD_LOCATION_REGEX.test(variableLocation)
    case 'LINT':
    case 'ULINT':
    case 'LREAL':
    case 'LWORD':
      return LWORD_LOCATION_REGEX.test(variableLocation)
    default:
      return false
  }
}

const variableLocationValidationErrorMessage = (variableType: string) => {
  switch (variableType.toUpperCase()) {
    case 'BOOL':
      return 'Valid locations: %QX0.0..7, %IX0.0..7, %MX0.0..7 (change the number to the desired location)'
    case 'BYTE':
    case 'SINT':
    case 'USINT':
      return 'Valid locations: %QB0, %IB0, %MB0 (change the number to the desired location)'
    case 'INT':
    case 'UINT':
    case 'WORD':
      return 'Valid locations: %QW0, %IW0, %MW0 (change the number to the desired location)'
    case 'DINT':
    case 'UDINT':
    case 'REAL':
    case 'DWORD':
      return 'Valid locations: %QD0, %ID0, %MD0 (change the number to the desired location)'
    case 'LINT':
    case 'ULINT':
    case 'LREAL':
    case 'LWORD':
      return 'Valid locations: %QL0, %IL0, %ML0 (change the number to the desired location)'
    default:
      // Reached by a structure or an enum — types with no single address
      // class. This used to return an empty string, so the dialog showed
      // "Please make sure that the location is valid." and nothing else: a
      // refusal with no reason and nothing to act on.
      return `A variable of type "${variableType}" cannot have a physical location: only the elementary types (BOOL, BYTE, INT, WORD, DINT, REAL, ...) and arrays of them map onto an IEC address.`
  }
}

/**
 * Check if the variable name exists and if it is needed to change the name of the variable.
 * Returns an object containing:
 * - ok: boolean (true if the variable exists, false otherwise)
 * - name: string (the new name of the variable)
 * - number: number (the biggest number at the end of the variable name)
 */
const checkVariableName = (variables: PLCVariable[], variableName: string) => {
  // Check if there is a variable with the same name when removing the number at the end
  const variableNameWithoutNumber = variableName.substring(
    0,
    variableName.length - extractNumberAtEnd(variableName).length,
  )
  const filteredVariables = variables.filter((variable: PLCVariable) =>
    variable.name.toLowerCase().includes(variableNameWithoutNumber.toLowerCase()),
  )

  // If there is a variable with the same name, sort the variables by the number at the end and get the biggest number
  const sortedVariables = filteredVariables.sort((a, b) => {
    const numberA = extractNumberAtEnd(a.name).number
    const numberB = extractNumberAtEnd(b.name).number

    // Treat variables without numbers as having number -1 for sorting purposes
    // This ensures they come before numbered variables
    const sortNumberA = numberA === -1 ? -1 : numberA
    const sortNumberB = numberB === -1 ? -1 : numberB

    return sortNumberA - sortNumberB
  })

  // Get the biggest number at the end of the variable name
  // If there is no number at the end of the variable name, return -1 (because the number at the end of the variable name is 0)
  const biggestVariable =
    sortedVariables.length > 0 ? extractNumberAtEnd(sortedVariables[sortedVariables.length - 1].name) : { number: -1 }

  return {
    ok: filteredVariables.length > 0,
    name: variableNameWithoutNumber,
    number: biggestVariable.number + 1,
  }
}

/**
 * This is a validation to check if it is needed changing the name of a variable at creation.
 * If the variable exists change the variable name.
 **/
/**
 * Increment an IEC 61131-3 address by one slot, respecting the
 * width of the variable's underlying type.  For BOOL addresses
 * (`%IX/%QX<byte>.<bit>`) the bit field wraps from .7 back to .0
 * with the byte index bumping by one; for word / dword / lword
 * forms the numeric index after the prefix increments by one.
 *
 * Returns `null` when the type isn't recognised — the caller stops
 * the auto-increment loop and falls back to whatever location it
 * currently holds, so an unknown future IEC type can't produce an
 * infinite loop here.
 */
const incrementLocationByOne = (location: string): string | null => {
  // Derived from the ADDRESS, not from the variable's type. The address
  // already states its size class (`%QX` bit, `%IB` byte, `%MW` word, ...),
  // and every class advances the same way once linearised — `parseAddress`
  // maps a bit address to `byte*8 + bit`, so `%QX0.7` steps to `%QX1.0`
  // without the carry needing to be spelled out per class.
  //
  // This replaced a per-type switch that had two holes: it had no case for
  // BYTE / SINT / USINT (so `%IB` / `%QB` / `%MB` returned null and the
  // caller's search gave up, keeping a colliding location), and its BOOL case
  // stripped only the `%QX` and `%IX` prefixes, so a memory bit `%MX0.0` fell
  // through with its prefix intact and `parseInt` produced `%IXNaN.NaN`.
  const parsed = parseAddress(location)
  if (!parsed) return null
  return formatAddress(parsed.cls, parsed.linear + 1)
}

/** Safety bound on the auto-increment loop in `createVariableValidation`.
 *  Picked well above any realistic project size (8 bits × N bytes =
 *  N×8 BOOLs; this lets us scan ~1000 bytes / words / dwords / lwords
 *  before we give up).  The loop normally terminates after at most
 *  a handful of iterations — the bound only matters if the table is
 *  pathologically dense or an unknown IEC type slipped past
 *  `incrementLocationByOne`'s switch. */
const MAX_AUTO_INCREMENT_ITERATIONS = 8192

const createVariableValidation = (
  variables: PLCVariable[],
  variable: PLCVariable,
): { name: string; location: string } => {
  const { name: variableName } = variable
  // Interface-class variables cannot carry a physical location — the ST
  // parser rejects such declarations when the project is reopened
  // (GitHub issue #904). Strip the location instead of rejecting so
  // creation flows that clone an existing row as a template still succeed.
  const variableLocation = DISALLOWED_LOCATION_CLASSES.includes(variable.class) ? '' : variable.location
  const response = { name: variableName, location: variableLocation }

  if (checkIfVariableExists(variables, variableName)) {
    const { name: variableNameWithoutNumber, number } = checkVariableName(variables, variableName)
    response.name = `${variableNameWithoutNumber}${number}`
  }

  const slots = slotsClaimedBy(variable)

  if (variableLocation !== '' && checkIfLocationExists(variables, variableLocation, slots)) {
    // Scan forward through the address space until we find a slot
    // that no other variable in this table holds.  Single-increment
    // wasn't enough: when the user kept clicking "+" through a row
    // of contiguous variables, the increment would eventually land
    // ON another already-bound row and silently produce a duplicate-
    // location collision that only the compiler caught (forum
    // thread, v4.2.0 follow-up).
    //
    // The test is range overlap rather than set membership because an
    // ARRAY occupies a contiguous area: a candidate has to clear every
    // slot the new variable would claim, and has to clear the whole
    // span of any array already sitting there — landing one slot inside
    // a neighbouring array is the same collision as landing on its
    // first address (openplc-editor#565).
    //
    // The occupied spans are parsed ONCE, outside the loop. Calling
    // `checkIfLocationExists` per iteration would re-scan every variable and
    // re-run its address regex on each, and the walk steps one element slot at
    // a time — placing an `ARRAY [0..999]` on a taken address would be ~1000
    // iterations x N variables x 2 regexes, synchronously inside the store's
    // `produce`. Parsing up front makes each step a plain interval comparison.
    const occupied: Array<{ parsed: ParsedAddress; slots: number }> = []
    for (const other of variables) {
      const parsed = parseAddress(other.location)
      if (parsed) occupied.push({ parsed, slots: slotsClaimedBy(other) })
    }
    const collides = (address: string): boolean => {
      const parsed = parseAddress(address)
      if (!parsed) return false
      return occupied.some((o) => slotRangesOverlap(parsed, slots, o.parsed, o.slots))
    }

    let candidate = variableLocation
    let iterations = 0
    while (collides(candidate) && iterations < MAX_AUTO_INCREMENT_ITERATIONS) {
      const next = incrementLocationByOne(candidate)
      if (!next || next === candidate) break // unknown type / no progress — bail
      candidate = next
      iterations += 1
    }
    response.location = candidate
  }
  return response
}

/**
 * This is a validation to check the name of the variable at update.
 * If the variable name is invalid, create a response.
 * If the variable name already exists, create or change a response.
 **/
const updateVariableValidation = (
  variables: PLCVariable[],
  dataToBeUpdated: Partial<PLCVariable>,
  variableToUpdate: PLCVariable,
) => {
  let response: ProjectResponse = { ok: true }

  if (dataToBeUpdated.class) {
    // Switching to an interface class makes an existing physical location
    // invalid IEC — the saved declaration would fail to parse on reopen
    // (GitHub issue #904) — so clear the location in the same update.
    // Enforced here (not only in the table UI) so every caller keeps the
    // invariant.
    response.data = DISALLOWED_LOCATION_CLASSES.includes(dataToBeUpdated.class)
      ? { class: dataToBeUpdated.class, location: '' }
      : { class: dataToBeUpdated.class }
  }

  if (dataToBeUpdated.name || dataToBeUpdated.name === '') {
    const { name } = dataToBeUpdated
    if (name === '') {
      response = {
        ok: false,
        title: 'Variable name is empty.',
        message: 'Please make sure that the name is not empty.',
      }
      return response
    }

    if (checkIfVariableExists(variables, name)) {
      response = {
        ok: false,
        title: 'Variable already exists',
        message: 'Please make sure that the name is unique.',
      }
      return response
    }

    if (!variableNameValidation(name)) {
      response = {
        ok: false,
        title: 'Variable name is invalid.',
        message: `Please make sure that the name is valid. Valid names: CamelCase, PascalCase or SnakeCase.`,
      }
      return response
    }
  }

  // Both location checks below reason about the variable as it will be AFTER
  // this update, not as it is now. A single edit can change the location, the
  // type, or both, and validating a new location against the old type (or a
  // new type against the old span) is how a joint edit slips through.
  const effectiveType = dataToBeUpdated.type ?? variableToUpdate.type
  const effectiveAddressClass = addressClassTypeOf(effectiveType)
  const effectiveSlots = slotsClaimedBy({ ...variableToUpdate, ...dataToBeUpdated })

  if (dataToBeUpdated.location) {
    const { location } = dataToBeUpdated

    // A physical location is only valid on `local` (VAR) and `global`
    // (VAR_GLOBAL) declarations — mirrors the parser rule that makes a
    // located interface-class variable un-parseable on project reopen
    // (GitHub issue #904).
    const effectiveClass = dataToBeUpdated.class ?? variableToUpdate.class
    if (effectiveClass && DISALLOWED_LOCATION_CLASSES.includes(effectiveClass)) {
      response = {
        ok: false,
        title: 'Location is not allowed.',
        message: `Variables of class "${effectiveClass.toUpperCase()}" cannot have a physical location ("AT"). Use class LOCAL for located variables.`,
      }
      return response
    }

    if (hasUnlocatableShape(effectiveType)) {
      response = {
        ok: false,
        title: 'Location is not allowed.',
        message: UNLOCATABLE_SHAPE_MESSAGE,
      }
      return response
    }

    // Exclude the variable being updated so re-setting its own
    // location (e.g. re-picking the same address to refresh a
    // renamed alias) doesn't trip the uniqueness check on itself.
    if (checkIfLocationExists(variables, location, effectiveSlots, variableToUpdate)) {
      response = {
        ok: false,
        title: 'Location already exists',
        message: 'Please make sure that the location is unique.',
      }
      return response
    }

    if (!variableLocationValidation(location, effectiveAddressClass)) {
      response = {
        ok: false,
        title: 'Location is invalid.',
        message: `Please make sure that the location is valid.\n${variableLocationValidationErrorMessage(effectiveAddressClass)}`,
      }
      return response
    }
  }

  if (dataToBeUpdated.type) {
    if (variableToUpdate.location !== '' && hasUnlocatableShape(effectiveType)) {
      // Reached from the array modal, which dispatches a type-only patch: the
      // user turns a located 1-D array into a 2-D one and it stops having a
      // linear run of addresses to sit on.
      response = { ok: false, title: 'Location is not allowed.', message: UNLOCATABLE_SHAPE_MESSAGE }
      return response
    }
    if (!variableLocationValidation(variableToUpdate.location, effectiveAddressClass)) {
      response.data = { ...(response.data ? response.data : {}), location: '' }
    } else if (
      // A type-only edit can widen what an already-located variable claims:
      // turning a scalar at %MW0 into an ARRAY [0..3] makes it swallow %MW1-3
      // and whatever sits there. The block above only runs when the LOCATION
      // is part of the edit, so without this the widening lands unchecked.
      variableToUpdate.location !== '' &&
      checkIfLocationExists(variables, variableToUpdate.location, effectiveSlots, variableToUpdate)
    ) {
      response = {
        ok: false,
        title: 'Location already exists',
        message: `"${variableToUpdate.name}" at ${variableToUpdate.location} would now cover ${effectiveSlots} addresses, overlapping another variable. Move it, or shorten the array.`,
      }
      return response
    }
    if (dataToBeUpdated.type.definition === 'derived') {
      response.data = { ...(response.data ? response.data : {}), location: '', initialValue: '', class: 'local' }
    }
  }

  return response
}

const updateGlobalVariableValidation = (variables: PLCVariable[], dataToBeUpdated: Partial<PLCVariable>) => {
  let response: ProjectResponse = { ok: true }

  if (dataToBeUpdated.name || dataToBeUpdated.name === '') {
    const { name } = dataToBeUpdated
    if (name === '') {
      response = {
        ok: false,
        title: 'Global Variable name is empty.',
        message: 'Please make sure that the name is not empty.',
      }
      return response
    }

    if (checkIfGlobalVariableExists(variables, name)) {
      response = {
        ok: false,
        title: 'Global Variable already exists',
        message: 'Please make sure that the name is unique.',
      }
      return response
    }
  }

  return response
}

export {
  arrayValidation,
  checkVariableName,
  createVariableValidation,
  enumeratedValidation,
  updateGlobalVariableValidation,
  updateVariableValidation,
}
