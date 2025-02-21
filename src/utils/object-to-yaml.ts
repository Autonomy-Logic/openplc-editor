/* eslint-disable @typescript-eslint/no-explicit-any */
import { stringify } from 'yaml'

/**
 * Converts a JavaScript object to a YAML string
 * @param obj - The JavaScript object to convert
 * @returns The YAML string
 */
const YamlObjectToString = (obj: { [key: string]: any }): string => {
  const yamlString = stringify(obj)
  return yamlString
}

export { YamlObjectToString }
