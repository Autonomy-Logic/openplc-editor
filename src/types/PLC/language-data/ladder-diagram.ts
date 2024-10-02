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
 * - 'local-id': a string that represents the local identifier of the left power rail.
 * - width: a number that represents the width of the left power rail.
 * - height: a number that represents the height of the left power rail.
 * - 'global-position': an object that represents the global position of the left power rail. It includes x and y coordinates.
 * - 'connection-point-out': an object that represents the connection point out of the left power rail. It includes a 'relative-position' object with x and y coordinates.
 */
const _leftPowerRailSchema = z.object({
  'local-id': z.string(),
  width: z.number(),
  height: z.number(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  'connection-point-out': z.object({
    'relative-position': z.object({
      x: z.number(),
      y: z.number(),
    }),
  }),
})

/**
 * rightPowerRailSchema is a zod schema for the right power rail of the Ladder Diagram.
 * It includes the following properties:
 * - 'local-id': a string that represents the local identifier of the right power rail.
 * - width: a number that represents the width of the right power rail.
 * - height: a number that represents the height of the right power rail.
 * - 'global-position': an object that represents the global position of the right power rail. It includes x and y coordinates.
 * - 'connection-point-in': an object that represents the connection point in of the right power rail. It includes a 'relative-position' object with x and y coordinates and an array of connections.
 * Each connection is an object that includes a 'reference-to-local-id' (reference to other block) and an array of 'positions'. Each position is an object that includes x and y coordinates representing the path of the connection.
 */
const _rightPowerRailSchema = z.object({
  'local-id': z.string(),
  width: z.number(),
  height: z.number(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  // This is our handles.
  'connection-point-in': z.object({
    'relative-position': z.object({
      x: z.number(),
      y: z.number(),
    }),
    connection: z.object({
      'reference-to-local-id': z.string(), // was just local-id, but it seems to be a reference to other element local-id.
      positions: z.array(
        z.object({
          x: z.number(),
          y: z.number(),
        }),
      ),
    }),
  }),
})

/**
 * blockSchema is a zod schema for the block element of the Ladder Diagram.
 * It includes the following properties:
 * - 'local-id': a string that represents the local identifier of the block.
 * - 'type-name': a string that represents the type name of the block.
 * - 'instance-name': a string that represents the instance name of the block.
 * - width: a number that represents the width of the block.
 * - height: a number that represents the height of the block.
 * - position: an object that represents the position of the block. It includes x and y coordinates.
 * - 'input-variables': an array of objects that represent the input variables of the block. Each object includes a 'formal-parameter' and a 'connection-point-in'.
 * - 'output-variables': an array of objects that represent the output variables of the block. Each object includes a 'formal-parameter' and a 'connection-point-out'.
 * Each 'connection-point-in' and 'connection-point-out' includes a 'relative-position' object with x and y coordinates and an array of connections.
 * Each connection is an object that includes a 'reference-to-local-id' and an array of 'positions'. Each 'position' is an object that includes x and y coordinates representing the path of the connection..
 */
const _blockSchema = z.object({
  'local-id': z.string(),
  'type-name': z.string(),
  'instance-name': z.string(),
  width: z.number(),
  height: z.number(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  'input-variables': z.array(
    z.object({
      'formal-parameter': z.string(),
      'connection-point-in': z.object({
        'relative-position': z.object({
          x: z.number(),
          y: z.number(),
        }),
        connections: z.array(
          z.object({
            'reference-to-local-id': z.string(), // was just local-id, but it seems to be a reference to other element local-id.
            positions: z.array(
              z.object({
                x: z.number(),
                y: z.number(),
              }),
            ),
          }),
        ),
      }),
    }),
  ),
  /**
   * 'inOut-variables' is an array of objects that represent the inOut variables of the block.
   * @wip This is a guess, we need to confirm this.
   */
  'inOut-variables': z.array(
    z.object({
      'formal-parameter': z.string(),
      'connection-point-in': z.object({
        'relative-position': z.object({
          x: z.number(),
          y: z.number(),
        }),
        connections: z.array(
          z.object({
            'reference-to-local-id': z.string(), // was just local-id, but it seems to be a reference to other element local-id.
            positions: z.array(
              z.object({
                x: z.number(),
                y: z.number(),
              }),
            ),
          }),
        ),
      }),
      'connection-point-out': z.object({
        'relative-position': z.object({
          x: z.number(),
          y: z.number(),
        }),
      }),
    }),
  ),
  'output-variables': z.array(
    z.object({
      'formal-parameter': z.string(),
      'connection-point-out': z.object({
        'relative-position': z.object({
          x: z.number(),
          y: z.number(),
        }),
      }),
    }),
  ),
})

/**
 * contactSchema is a zod schema for the contact element of the Ladder Diagram.
 * It includes the following properties:
 * - 'local-id': a string that represents the local identifier of the contact.
 * - negated: a boolean that represents if the contact is negated.
 * - edges: a string that represents the edges of the contact (rising, falling, or empty).
 * - width: a number that represents the width of the contact.
 * - height: a number that represents the height of the contact.
 * - position: an object that represents the position of the contact. It includes x and y coordinates.
 * - variable: a string that represents the variable of the contact.
 * - 'connection-point-in': an object that represents the connection point in of the contact. It includes a 'relative-position' object with x and y coordinates and an array of connections.
 * Each connection is an object that includes a 'reference-to-local-id' and an array of 'positions'. Each 'position' is an object that includes x and y coordinates representing the path of the connection.
 * - 'connection-point-out': an object that represents the connection point out of the contact. It includes a 'relative-position' object with x and y coordinates.
 */
const _contactSchema = z.object({
  'local-id': z.string(),
  negated: z.boolean(),
  edges: z.enum(['rising', 'falling', '']),
  width: z.number(),
  height: z.number(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  variable: z.string(),
  'connection-point-in': z.object({
    'relative-position': z.object({
      x: z.number(),
      y: z.number(),
    }),
    connections: z.array(
      z.object({
        'reference-to-local-id': z.string(), // was just local-id, but it seems to be a reference to other element local-id.
        positions: z.array(
          z.object({
            x: z.number(),
            y: z.number(),
          }),
        ),
      }),
    ),
  }),
  'connection-point-out': z.object({
    'relative-position': z.object({
      x: z.number(),
      y: z.number(),
    }),
  }),
})

/**
 * coilSchema is a zod schema for the coil element of the Ladder Diagram.
 * It includes the following properties:
 * - 'local-id': a string that represents the local identifier of the coil.
 * - negated: a boolean that represents if the coil is negated.
 * - edges: a string that represents the edges of the coil (rising, falling, or empty).
 * - storage: a string that represents the storage of the coil (set, reset, or empty).
 * - width: a number that represents the width of the coil.
 * - height: a number that represents the height of the coil.
 * - position: an object that represents the position of the coil. It includes x and y coordinates.
 * - variable: a string that represents the variable of the coil.
 * - 'connection-point-in': an object that represents the connection point in of the coil. It includes a 'relative-position' object with x and y coordinates and an array of connections.
 * Each connection is an object that includes a 'reference-to-local-id' and an array of 'positions'. Each 'position' is an object that includes x and y coordinates representing the path of the connection.
 * - 'connection-point-out': an object that represents the connection point out of the coil. It includes a 'relative-position' object with x and y coordinates.
 */
const _coilSchema = z.object({
  'local-id': z.string(),
  negated: z.boolean(),
  edges: z.enum(['rising', 'falling', '']),
  storage: z.enum(['set', 'reset', '']),
  width: z.number(),
  height: z.number(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  variable: z.string(),
  'connection-point-in': z.object({
    'relative-position': z.object({
      x: z.number(),
      y: z.number(),
    }),
    connections: z.array(
      z.object({
        'reference-to-local-id': z.string(), // was just local-id, but it seems to be a reference to other element local-id.
        positions: z.array(
          z.object({
            x: z.number(),
            y: z.number(),
          }),
        ),
      }),
    ),
  }),
  'connection-point-out': z.object({
    'relative-position': z.object({
      x: z.number(),
      y: z.number(),
    }),
  }),
})

/**
 * variableSchema is a zod schema for the variable element of the Ladder Diagram.
 * It includes the following properties:
 * - type: a string that represents the type of the variable (in, out, or inOut).
 */
const _variableSchema = z.discriminatedUnion('type', [
  /**
   * inSchema is a zod schema for the input variable element of the Ladder Diagram.
   * It includes the following properties:
   * - type: a string that represents the type of the variable (in).
   * - 'local-id': a string that represents the local identifier of the input variable.
   * - width: a number that represents the width of the input variable.
   * - height: a number that represents the height of the input variable.
   * - position: an object that represents the position of the input variable. It includes x and y coordinates.
   * - negated: a boolean that represents if the input variable is negated.
   * - 'connection-point-out': an object that represents the connection point out of the input variable. It includes a 'relative-position' object with x and y coordinates.
   * - expression: a string that represents the expression of the input variable.
   */
  z.object({
    type: z.literal('in'),
    'local-id': z.string(),
    width: z.number(),
    height: z.number(),
    position: z.object({
      x: z.number(),
      y: z.number(),
    }),
    negated: z.boolean(),
    'connection-point-out': z.object({
      'relative-position': z.object({
        x: z.number(),
        y: z.number(),
      }),
    }),
    expression: z.string(),
  }),
  /**
   * outSchema is a zod schema for the output variable element of the Ladder Diagram.
   * It includes the following properties:
   * - type: a string that represents the type of the variable (out).
   * - 'local-id': a string that represents the local identifier of the output variable.
   * - width: a number that represents the width of the output variable.
   * - height: a number that represents the height of the output variable.
   * - position: an object that represents the position of the output variable. It includes x and y coordinates.
   * - negated: a boolean that represents if the output variable is negated.
   * - 'connection-point-in': an object that represents the connection point in of the output variable. It includes a 'relative-position' object with x and y coordinates and an array of connections.
   * Each connection is an object that includes a 'reference-to-local-id' and an array of 'positions'. Each 'position' is an object that includes x and y coordinates representing the path of the connection.
   * - expression: a string that represents the expression of the output variable.
   */
  z.object({
    type: z.literal('out'),
    'local-id': z.string(),
    width: z.number(),
    height: z.number(),
    position: z.object({
      x: z.number(),
      y: z.number(),
    }),
    negated: z.boolean(),
    'connection-point-in': z.object({
      'relative-position': z.object({
        x: z.number(),
        y: z.number(),
      }),
      connections: z.array(
        z.object({
          'reference-to-local-id': z.string(),
          positions: z.array(
            z.object({
              x: z.number(),
              y: z.number(),
            }),
          ),
        }),
      ),
    }),
    expression: z.string(),
  }),
  /**
   * inOutSchema is a zod schema for the inOut variable element of the Ladder Diagram.
   * It includes the following properties:
   * - type: a string that represents the type of the variable (inOut).
   * - 'local-id': a string that represents the local identifier of the inOut variable.
   * - width: a number that represents the width of the inOut variable.
   * - height: a number that represents the height of the inOut variable.
   * - position: an object that represents the position of the inOut variable. It includes x and y coordinates.
   * - negatedOut: a boolean that represents if the output of the inOut variable is negated.
   * - negatedIn: a boolean that represents if the input of the inOut variable is negated.
   * - 'connection-point-in': an object that represents the connection point in of the inOut variable. It includes a 'relative-position' object with x and y coordinates and an array of connections.
   * Each connection is an object that includes a 'reference-to-local-id' and an array of 'positions'. Each 'position' is an object that includes x and y coordinates representing the path of the connection.
   * - 'connection-point-out': an object that represents the connection point out of the inOut variable. It includes a 'relative-position' object with x and y coordinates.
   * - expression: a string that represents the expression of the inOut variable.
   */
  z.object({
    type: z.literal('inOut'),
    'local-id': z.string(),
    width: z.number(),
    height: z.number(),
    position: z.object({
      x: z.number(),
      y: z.number(),
    }),
    negatedOut: z.boolean(),
    negatedIn: z.boolean(),
    'connection-point-in': z.object({
      'relative-position': z.object({
        x: z.number(),
        y: z.number(),
      }),
      connections: z.array(
        z.object({
          'reference-to-local-id': z.string(),
          positions: z.array(
            z.object({
              x: z.number(),
              y: z.number(),
            }),
          ),
        }),
      ),
    }),
    'connection-point-out': z.object({
      'relative-position': z.object({
        x: z.number(),
        y: z.number(),
      }),
    }),
    expression: z.string(),
  }),
])
