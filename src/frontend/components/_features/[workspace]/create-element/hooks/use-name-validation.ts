import { isLegalIdentifier } from '../../../../../utils/keywords'

/**
 * Custom validation function for POU and data type names.
 * Validates against IEC 61131-3 naming rules.
 *
 * @param value - The name to validate
 * @returns true if valid, or error message string if invalid
 */
export const validatePouOrDataTypeName = (value: string): true | string => {
  // Check if empty
  if (!value || value.trim() === '') {
    return 'Name cannot be empty'
  }

  // Check minimum length
  if (value.length < 3) {
    return 'Name must be at least 3 characters'
  }

  // Check against IEC 61131-3 rules
  const [isValid, reason] = isLegalIdentifier(value)
  if (!isValid) {
    return `Invalid name: ${reason}`
  }

  return true
}
