/**
 * ----------------------------------------------------------------
 * This file is part of OpenPLC documentation.
 * Here is defined the shape of the mapped data structure for the Ladder Diagram language.
 * ----------------------------------------------------------------
 */

import { z } from 'zod'

/**
 * leftPowerRailSchema is a zod schema for the left power rail of the Ladder Diagram.
 * It includes the following properties:
 * - @localId: a string that represents the local identifier of the left power rail.
 * - @width: a number that represents the width of the left power rail.
 * - @height: a number that represents the height of the left power rail.
 * - position: an object that represents the global position of the left power rail. It includes x and y coordinates.
 * - connectionPointOut: an object that represents the connection point out of the left power rail. It includes a relPosition object with x and y coordinates.
 */
const leftPowerRailSchema = z.object({
  '@localId': z.string(), //@localId
  '@width': z.number(),
  '@height': z.number(),
  position: z.object({
    '@x': z.number(),
    '@y': z.number(),
  }),
  connectionPointOut: z.object({
    '@formalParameter': z.string(),
    relPosition: z.object({
      '@x': z.number(),
      '@y': z.number(),
    }),
  }),
})
type LeftPowerRailLadderXML = z.infer<typeof leftPowerRailSchema>

/**
 * rightPowerRailSchema is a zod schema for the right power rail of the Ladder Diagram.
 * It includes the following properties:
 * - @localId: a string that represents the local identifier of the right power rail.
 * - @width: a number that represents the width of the right power rail.
 * - @height: a number that represents the height of the right power rail.
 * - position: an object that represents the global position of the right power rail. It includes x and y coordinates.
 * - connectionPointIn: an object that represents the connection point in of the right power rail. It includes a relPosition object with x and y coordinates and an array of connections.
 * Each connection is an object that includes a @refLocalId (reference to other block) and an array of 'positions'. Each position is an object that includes x and y coordinates representing the path of the connection.
 */
const rightPowerRailSchema = z.object({
  '@localId': z.string(),
  '@width': z.number(),
  '@height': z.number(),
  position: z.object({
    '@x': z.number(),
    '@y': z.number(),
  }),
  // This is our handles.
  connectionPointIn: z.object({
    relPosition: z.object({
      '@x': z.number(),
      '@y': z.number(),
    }),
    connection: z.array(
      z.object({
        '@refLocalId': z.string(),
        '@formalParameter': z.string().optional(),
        position: z.array(
          z.object({
            '@x': z.number(),
            '@y': z.number(),
          }),
        ),
      }),
    ),
  }),
})
type RightPowerRailLadderXML = z.infer<typeof rightPowerRailSchema>

/**
 * blockSchema is a zod schema for the block element of the Ladder Diagram.
 * It includes the following properties:
 * - @localId: a string that represents the local identifier of the block.
 * - @typeName: a string that represents the type name of the block.
 * - @instanceName: a string that represents the instance name of the block.
 * - @width: a number that represents the width of the block.
 * - @height: a number that represents the height of the block.
 * - position: an object that represents the position of the block. It includes x and y coordinates.
 * - inVariable: an array of objects that represent the input variables of the block. Each object includes a @formalParameter and a connectionPointIn.
 * - outVariable: an array of objects that represent the output variables of the block. Each object includes a formalParameter and a connectionPointOut'.
 * Each connectionPointIn and connectionPointOut' includes a relPosition object with x and y coordinates and an array of connections.
 * Each connection is an object that includes a @refLocalId and an array of position. Each position is an object that includes x and y coordinates representing the path of the connection..
 */
const blockSchema = z.object({
  '@localId': z.string(),
  '@typeName': z.string(),
  '@instanceName': z.string().optional(),
  '@width': z.number(),
  '@height': z.number(),
  '@executionOrderId': z.number().optional(),
  position: z.object({
    '@x': z.number(),
    '@y': z.number(),
  }),
  inputVariables: z.object({
    variable: z.array(
      z.object({
        '@formalParameter': z.string(),
        connectionPointIn: z.object({
          relPosition: z.object({
            '@x': z.number(),
            '@y': z.number(),
          }),
          connection: z.array(
            z.object({
              '@refLocalId': z.string(), // was just @localId, but it seems to be a reference to other element @localId.
              position: z.array(
                z.object({
                  '@x': z.number(),
                  '@y': z.number(),
                }),
              ),
            }),
          ),
        }),
      }),
    ),
  }),
  /**
   * 'inOutVariable' is an array of objects that represent the inOut variables of the block.
   * @wip This is a guess, we need to confirm this.
   */
  inOutVariables: z.string(),
  outputVariables: z.object({
    variable: z.array(
      z.object({
        '@formalParameter': z.string(),
        connectionPointOut: z.object({
          relPosition: z.object({
            '@x': z.number(),
            '@y': z.number(),
          }),
        }),
      }),
    ),
  }),
})
type BlockLadderXML = z.infer<typeof blockSchema>

/**
 * contactSchema is a zod schema for the contact element of the Ladder Diagram.
 * It includes the following properties:
 * - @localId: a string that represents the local identifier of the contact.
 * - @negated: a boolean that represents if the contact is negated.
 * - @edge: a string that represents the edges of the contact (rising, falling, or empty).
 * - @width: a number that represents the width of the contact.
 * - @height: a number that represents the height of the contact.
 * - position: an object that represents the position of the contact. It includes x and y coordinates.
 * - variable: a string that represents the variable of the contact.
 * - connectionPointIn': an object that represents the connection point in of the contact. It includes a relPosition object with x and y coordinates and an array of connections.
 * Each connection is an object that includes a @refLocalId and an array of position. Each position is an object that includes x and y coordinates representing the path of the connection.
 * - connectionPointOut': an object that represents the connection point out of the contact. It includes a relPosition object with x and y coordinates.
 */
const contactSchema = z.object({
  '@localId': z.string(),
  '@negated': z.boolean(),
  '@edge': z.enum(['rising', 'falling']).optional(),
  '@width': z.number(),
  '@height': z.number(),
  '@executionOrderId': z.number().optional(),
  position: z.object({
    '@x': z.number(),
    '@y': z.number(),
  }),
  connectionPointIn: z.object({
    relPosition: z.object({
      '@x': z.number(),
      '@y': z.number(),
    }),
    connection: z.array(
      z.object({
        '@refLocalId': z.string(),
        '@formalParameter': z.string().optional(),
        position: z.array(
          z.object({
            '@x': z.number(),
            '@y': z.number(),
          }),
        ),
      }),
    ),
  }),
  connectionPointOut: z.object({
    relPosition: z.object({
      '@x': z.number(),
      '@y': z.number(),
    }),
  }),
  variable: z.string(),
})
type ContactLadderXML = z.infer<typeof contactSchema>

/**
 * coilSchema is a zod schema for the coil element of the Ladder Diagram.
 * It includes the following properties:
 * - @localId: a string that represents the local identifier of the coil.
 * - @negated: a boolean that represents if the coil is negated.
 * - @edge: a string that represents the edges of the coil (rising, falling, or empty).
 * - @storage: a string that represents the storage of the coil (set, reset, or empty).
 * - @width: a number that represents the width of the coil.
 * - @height: a number that represents the height of the coil.
 * - position: an object that represents the position of the coil. It includes x and y coordinates.
 * - variable: a string that represents the variable of the coil.
 * - connectionPointIn: an object that represents the connection point in of the coil. It includes a relPosition object with x and y coordinates and an array of connections.
 * Each connection is an object that includes a @refLocalId and an array of position. Each position is an object that includes x and y coordinates representing the path of the connection.
 * - connectionPointOut: an object that represents the connection point out of the coil. It includes a relPosition object with x and y coordinates.
 */
const coilSchema = z.object({
  '@localId': z.string(),
  '@negated': z.boolean(),
  '@edge': z.enum(['rising', 'falling']).optional(),
  '@storage': z.enum(['set', 'reset']).optional(),
  '@width': z.number(),
  '@height': z.number(),
  '@executionOrderId': z.number().optional(),
  position: z.object({
    '@x': z.number(),
    '@y': z.number(),
  }),
  connectionPointIn: z.object({
    relPosition: z.object({
      '@x': z.number(),
      '@y': z.number(),
    }),
    connection: z.array(
      z.object({
        '@refLocalId': z.string(),
        '@formalParameter': z.string().optional(),
        position: z.array(
          z.object({
            '@x': z.number(),
            '@y': z.number(),
          }),
        ),
      }),
    ),
  }),
  connectionPointOut: z.object({
    relPosition: z.object({
      '@x': z.number(),
      '@y': z.number(),
    }),
  }),
  variable: z.string(),
})
type CoilLadderXML = z.infer<typeof coilSchema>

/**
 * inSchema is a zod schema for the input variable element of the Ladder Diagram.
 * It includes the following properties:
 * - @localId: a string that represents the local identifier of the input variable.
 * - @width: a number that represents the width of the input variable.
 * - @height: a number that represents the height of the input variable.
 * - @negated: a boolean that represents if the input variable is negated.
 * - position: an object that represents the position of the input variable. It includes x and y coordinates.
 * - connectionPointOut': an object that represents the connection point out of the input variable. It includes a relPosition object with x and y coordinates.
 * - expression: a string that represents the expression of the input variable.
 */
const inVariableSchema = z.object({
  '@localId': z.string(),
  '@width': z.number(),
  '@height': z.number(),
  '@negated': z.boolean(),
  position: z.object({
    '@x': z.number(),
    '@y': z.number(),
  }),
  connectionPointOut: z.object({
    relPosition: z.object({
      '@x': z.number(),
      '@y': z.number(),
    }),
  }),
  expression: z.string(),
})
type InVariableLadderXML = z.infer<typeof inVariableSchema>

/**
 * inOutSchema is a zod schema for the inOut variable element of the Ladder Diagram.
 * It includes the following properties:
 * - @localId: a string that represents the local identifier of the inOut variable.
 * - @width: a number that represents the width of the inOut variable.
 * - @height: a number that represents the height of the inOut variable.
 * - @negatedOut: a boolean that represents if the output of the inOut variable is negated.
 * - @negatedIn: a boolean that represents if the input of the inOut variable is negated.
 * - position: an object that represents the position of the inOut variable. It includes x and y coordinates.
 * - connectionPointIn': an object that represents the connection point in of the inOut variable. It includes a relPosition object with x and y coordinates and an array of connections.
 * Each connection is an object that includes a @refLocalId and an array of position. Each position is an object that includes x and y coordinates representing the path of the connection.
 * - connectionPointOut: an object that represents the connection point out of the inOut variable. It includes a relPosition object with x and y coordinates.
 * - expression: a string that represents the expression of the inOut variable.
 */
const inOutVariableSchema = z.object({
  '@localId': z.string(),
  '@width': z.number(),
  '@height': z.number(),
  '@negatedOut': z.boolean(),
  '@negatedIn': z.boolean(),
  position: z.object({
    '@x': z.number(),
    '@y': z.number(),
  }),
  connectionPointIn: z.object({
    relPosition: z.object({
      '@x': z.number(),
      '@y': z.number(),
    }),
    connection: z.array(
      z.object({
        '@refLocalId': z.string(),
        position: z.array(
          z.object({
            '@x': z.number(),
            '@y': z.number(),
          }),
        ),
      }),
    ),
  }),
  connectionPointOut: z.object({
    relPosition: z.object({
      '@x': z.number(),
      '@y': z.number(),
    }),
  }),
  expression: z.string(),
})
type InOutVariableLadderXML = z.infer<typeof inOutVariableSchema>

/**
 * outSchema is a zod schema for the output variable element of the Ladder Diagram.
 * It includes the following properties:
 * - @localId: a string that represents the local identifier of the output variable.
 * - @width: a number that represents the width of the output variable.
 * - @height: a number that represents the height of the output variable.
 * - @negated: a boolean that represents if the output variable is negated.
 * - position: an object that represents the position of the output variable. It includes x and y coordinates.
 * - connectionPointIn: an object that represents the connection point in of the output variable. It includes a relPosition object with x and y coordinates and an array of connections.
 * Each connection is an object that includes a @refLocalId and an array of position. Each position is an object that includes x and y coordinates representing the path of the connection.
 * - expression: a string that represents the expression of the output variable.
 */
const outVariableSchema = z.object({
  '@localId': z.string(),
  '@width': z.number(),
  '@height': z.number(),
  '@negated': z.boolean(),
  position: z.object({
    '@x': z.number(),
    '@y': z.number(),
  }),
  connectionPointIn: z.object({
    relPosition: z.object({
      '@x': z.number(),
      '@y': z.number(),
    }),
    connection: z.array(
      z.object({
        '@refLocalId': z.string(),
        '@formalParameter': z.string().optional(),
        position: z.array(
          z.object({
            '@x': z.number(),
            '@y': z.number(),
          }),
        ),
      }),
    ),
  }),
  expression: z.string(),
})
type OutVariableLadderXML = z.infer<typeof outVariableSchema>

/**
 * Ladder Diagram XML data types.
 */
const ladderXMLSchema = z.object({
  leftPowerRail: z.array(leftPowerRailSchema),
  rightPowerRail: z.array(rightPowerRailSchema),
  block: z.array(blockSchema),
  contact: z.array(contactSchema),
  coil: z.array(coilSchema),
  inVariable: z.array(inVariableSchema),
  inOutVariable: z.array(inOutVariableSchema),
  outVariable: z.array(outVariableSchema),
})
type LadderXML = z.infer<typeof ladderXMLSchema>

export {
  blockSchema,
  coilSchema,
  contactSchema,
  inOutVariableSchema,
  inVariableSchema,
  ladderXMLSchema,
  leftPowerRailSchema,
  outVariableSchema,
  rightPowerRailSchema,
}
export type {
  BlockLadderXML,
  CoilLadderXML,
  ContactLadderXML,
  InOutVariableLadderXML,
  InVariableLadderXML,
  LadderXML,
  LeftPowerRailLadderXML,
  OutVariableLadderXML,
  RightPowerRailLadderXML,
}
