import {
  BaseLibraryPouSchema,
  BaseLibrarySchema,
  BaseLibraryVariableSchema,
} from '@root/types/PLC/library'
import { z } from 'zod'

const JaguarVariablesSchema = BaseLibraryVariableSchema

const JaguarPouSchema = BaseLibraryPouSchema.extend({
  variables: z.array(JaguarVariablesSchema),
})

export const JaguarLibrarySchema = BaseLibrarySchema.extend({
  pous: z.array(JaguarPouSchema),
})

type JaguarLibrary = z.infer<typeof JaguarLibrarySchema>

const Jaguar: JaguarLibrary = {
  name: 'Jaguar',
  version: '1.0.0',
  author: 'Autonomy Logic',
  stPath: 'src/renderer/data/library/jaguar/st',
  cPath: 'src/renderer/data/library/jaguar/c',
  pous: [
    {
      name: 'ADC_CONFIG',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'ADC_CH', class: 'input', type: { definition: 'base-type', value: 'INT' }, documentation: 'ADC_CH' },
        { name: 'ADC_TYPE', class: 'input', type: { definition: 'base-type', value: 'INT' }, documentation: 'ADC_TYPE' },
        { name: 'ADC_CH_LOCAL', class: 'local', type: { definition: 'base-type', value: 'SINT' }, documentation: 'ADC_CH_LOCAL' },
        { name: 'ADC_TYPE_LOCAL', class: 'local', type: { definition: 'base-type', value: 'SINT' }, documentation: 'ADC_TYPE_LOCAL' },
        { name: 'SUCCESS', class: 'output', type: { definition: 'base-type', value: 'BOOL' }, documentation: 'SUCCESS' },
      ],
      body: `IF ADC_CH <> ADC_CH_LOCAL OR ADC_TYPE <> ADC_TYPE_LOCAL THEN
    ADC_CH_LOCAL := ADC_CH;
    ADC_TYPE_LOCAL := ADC_TYPE;
    SUCCESS := TRUE;
  ELSE
    SUCCESS := FALSE;
  END_IF;`,
      documentation: 'Configures the analog channel inputs on the Jaguar board. ADC_CH must be between 0 - 3. ADC_TYPE must be between 0 - 3, where 0 = unipolar 10V, 1 = bipolar 10V, 2 = unipolar 5V, and 3 = bipolar 5V. Upon successful configuration of the ADC, SUCCESS is set to TRUE.',
    },
  ],
}

export { Jaguar }