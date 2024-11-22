import {
  AdditionalFunctionBlocksLibrarySchema,
  ArduinoFunctionBlocksLibrarySchema,
  ArithmeticLibrarySchema,
  BitShiftLibrarySchema,
  BitwiseLibrarySchema,
  CharacterStringLibrarySchema,
  CommunicationBlocksLibrarySchema,
  ComparisonLibrarySchema,
  JaguarLibrarySchema,
  MQTTLibrarySchema,
  NumericalLibrarySchema,
  P1AMLibrarySchema,
  SelectionLibrarySchema,
  SequentMicrosystemsModulesLibrarySchema,
  StandardFunctionBlocksLibrarySchema,
  TimeLibrarySchema,
  TypeConversionLibrarySchema,
} from '@process:renderer/data/library'
import { z } from 'zod'

const libraryStateSchema = z.object({
  libraries: z.object({
    system: z.tuple([
      AdditionalFunctionBlocksLibrarySchema,
      ArduinoFunctionBlocksLibrarySchema,
      CommunicationBlocksLibrarySchema,
      JaguarLibrarySchema,
      MQTTLibrarySchema,
      P1AMLibrarySchema,
      SequentMicrosystemsModulesLibrarySchema,
      StandardFunctionBlocksLibrarySchema,
      ArithmeticLibrarySchema,
      BitShiftLibrarySchema,
      BitwiseLibrarySchema,
      CharacterStringLibrarySchema,
      ComparisonLibrarySchema,
      NumericalLibrarySchema,
      SelectionLibrarySchema,
      TimeLibrarySchema,
      TypeConversionLibrarySchema,
    ]), // This is the libraries that are built-in to the system
    user: z.array(z.object({
      name: z.string(),
      type: z.enum(['function', 'function-block','program'])
    })), // This is the libraries that the user has installed
  }),
})

const libraryActionsSchema = z.object({
  addLibrary: z.function().args(z.string(), z.enum(['function', 'function-block'	])).returns(z.void()),
  removeLibrary: z.function().args(z.string()).returns(z.void()),
})

type LibraryState = z.infer<typeof libraryStateSchema>
type LibraryActions = z.infer<typeof libraryActionsSchema>
type LibrarySlice = LibraryState & {
  libraryActions: LibraryActions
}

export { libraryActionsSchema, libraryStateSchema }
export type { LibraryActions, LibrarySlice, LibraryState }
