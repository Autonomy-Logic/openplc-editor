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
          connection: z.array(
            z.object({
              '@refLocalId': z.string(), // was just @localId, but it seems to be a reference to other element @localId.
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
          expression: z.string().optional(),
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
  connectionPointOut: z.string().optional(),
  expression: z.string(),
})
type InVariableFbdXML = z.infer<typeof inVariableSchema>

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
    connection: z.array(
      z.object({
        '@refLocalId': z.string(),
        '@formalParameter': z.string().optional(),
      }),
    ),
  }),
  expression: z.string(),
})
type OutVariableFbdXML = z.infer<typeof outVariableSchema>

/**
 * connectorSchema is a zod schema for the connector element of the Fbd Diagram.
 * It includes the following properties:
 * - @name: a string that represents the name of the connector.
 * - @localId: a string that represents the local identifier of the connector.
 * - @width: a number that represents the width of the connector.
 * - @height: a number that represents the height of the connector.
 * - position: an object that represents the position of the connector. It includes x and y coordinates.
 * - connectionPointIn: an object that represents the connection point in of the connector. It includes a relPosition object with x and y coordinates and an array of connections.
 * Each connection is an object that includes a @refLocalId and an array of position. Each position is an object that includes x and y coordinates representing the path of the connection.
 * Each connection also includes a @formalParameter.
 */
const connectorSchema = z.object({
  '@name': z.string(),
  '@localId': z.string(),
  '@width': z.number(),
  '@height': z.number(),
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
})
type ConnectorFbdXML = z.infer<typeof connectorSchema>

/**
 * continuationSchema is a zod schema for the continuation element of the Fbd Diagram.
 * It includes the following properties:
 * - @name: a string that represents the name of the continuation.
 * - @localId: a string that represents the local identifier of the continuation.
 * - @width: a number that represents the width of the continuation.
 * - @height: a number that represents the height of the continuation.
 * - position: an object that represents the position of the continuation. It includes x and y coordinates.
 * - connectionPointOut: an object that represents the connection point out of the continuation. It includes a relPosition object with x and y coordinates.
 */
const continuationSchema = z.object({
  '@name': z.string(),
  '@localId': z.string(),
  '@width': z.number(),
  '@height': z.number(),
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
})
type ContinuationFbdXML = z.infer<typeof continuationSchema>

const commentSchema = z.object({
  '@localId': z.string(),
  '@width': z.number(),
  '@height': z.number(),
  position: z.object({
    '@x': z.number(),
    '@y': z.number(),
  }),
  content: z.object({
    'xhtml:p': z.object({
      $: z.string(),
    }),
  }),
})
type CommentFbdXML = z.infer<typeof commentSchema>

/**
 * Fbd Diagram XML data types.
 */
const fbdXMLSchema = z.object({
  block: z.array(blockSchema),
  inVariable: z.array(inVariableSchema),
  outVariable: z.array(outVariableSchema),
  connector: z.array(connectorSchema),
  continuation: z.array(continuationSchema),
  comment: z.array(commentSchema),
})
type FbdXML = z.infer<typeof fbdXMLSchema>

export {
  blockSchema,
  commentSchema,
  connectorSchema,
  continuationSchema,
  fbdXMLSchema,
  inVariableSchema,
  outVariableSchema,
}
export type {
  BlockFbdXML,
  CommentFbdXML,
  ConnectorFbdXML,
  ContinuationFbdXML,
  FbdXML,
  InVariableFbdXML,
  OutVariableFbdXML,
}
