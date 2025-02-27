/* eslint-disable @typescript-eslint/no-explicit-any */
import { parse } from 'yaml'

/**
 * Converts a YAML string to a JavaScript object
 * @param yaml - The YAML string to convert
 * @returns The JavaScript object
 */
const YamlToObject = (yaml: string): { [key: string]: any } => {
  try {
    const parsedObject = parse(yaml) as { [key: string]: any }
    return parsedObject
  } catch (error) {
    console.error('Error parsing YAML:', error)
    throw new Error(`Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export { YamlToObject }
