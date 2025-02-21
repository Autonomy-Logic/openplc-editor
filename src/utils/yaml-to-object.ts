/* eslint-disable @typescript-eslint/no-explicit-any */
import { parse } from 'yaml'

/**
 * Converts a YAML string to a JavaScript object
 * @param yaml - The YAML string to convert
 * @returns The JavaScript object
 */
const YamlToObject = (yaml: string): { [key: string]: any } => {
  const parsedObject = parse(yaml) as { [key: string]: any }
  return parsedObject
}

export { YamlToObject }
