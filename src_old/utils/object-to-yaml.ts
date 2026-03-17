/* eslint-disable @typescript-eslint/no-explicit-any */
import { stringify } from 'yaml'

/**
 * Converts a JavaScript object to a YAML string
 * @param obj - The JavaScript object to convert
 * @returns The YAML string
 */
const YamlObjectToString = (obj: { [key: string]: any }): string => {
  try {
    const yamlString = stringify(obj)
    return yamlString
  } catch (error) {
    console.error('Error while trying to parse the object to YAML:', error)
    throw new Error(`Failed to convert object to YAML: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export { YamlObjectToString }
