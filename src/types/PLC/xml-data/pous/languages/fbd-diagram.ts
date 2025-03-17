/**
 * ----------------------------------------------------------------
 * This file is part of OpenPLC documentation.
 * Here is defined the shape of the mapped data structure for the Fbd Diagram language.
 * ----------------------------------------------------------------
 */

import { z } from 'zod'

/**
 * blockSchema is a zod schema for the block element of the Fbd Diagram.
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
  '@executionOrderId': z.number().optional(),
  '@width': z.number(),
  '@height': z.number(),
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
type BlockFbdXML = z.infer<typeof blockSchema>

/**
 * inSchema is a zod schema for the input variable element of the Fbd Diagram.
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
  '@executionOrderId': z.number(),
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
type InVariableFbdXML = z.infer<typeof inVariableSchema>

/**
 * inOutSchema is a zod schema for the inOut variable element of the Fbd Diagram.
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
type InOutVariableFbdXML = z.infer<typeof inOutVariableSchema>

/**
 * outSchema is a zod schema for the output variable element of the Fbd Diagram.
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
  '@executionOrderId': z.number(),
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
type OutVariableFbdXML = z.infer<typeof outVariableSchema>

/**
 * Fbd Diagram XML data types.
 */
const fbdXMLSchema = z.object({
  block: z.array(blockSchema),
  inVariable: z.array(inVariableSchema),
  inOutVariable: z.array(inOutVariableSchema),
  outVariable: z.array(outVariableSchema),
})
type FbdXML = z.infer<typeof fbdXMLSchema>

export {
  blockSchema,
  fbdXMLSchema,
  inOutVariableSchema,
  inVariableSchema,
  outVariableSchema,
}
export type {
  BlockFbdXML,
  FbdXML,
  InOutVariableFbdXML,
  InVariableFbdXML,
  OutVariableFbdXML,
}
