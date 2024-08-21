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
 * - 'conection-point-out': an object that represents the connection point out of the left power rail. It includes a 'relative-position' object with x and y coordinates.
 */
const _leftPowerRailSchema = z.object({
  'local-id': z.string(),
  width: z.number(),
  height: z.number(),
  'global-position': z.object({
    x: z.number(),
    y: z.number(),
  }),
  'conection-point-out': z.object({
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
 * - 'conection-point-in': an object that represents the connection point in of the right power rail. It includes a 'relative-position' object with x and y coordinates and an array of connections.
 * Each connection is an object that includes a 'local-id' and an array of 'global-positions'. Each 'global-position' is an object that includes a 'coordinate-reference' and x and y coordinates.
 */
const _rightPowerRailSchema = z.object({
  'local-id': z.string(),
  width: z.number(),
  height: z.number(),
  'global-position': z.object({
    x: z.number(),
    y: z.number(),
  }),
  // This is our handles.
  'conection-point-in': z.object({
    'relative-position': z.object({
      x: z.number(),
      y: z.number(),
    }),
    conections: z.array(
      z.object({
        'local-id': z.string(),
        'global-positions': z.array(
          z.object({
            'coordinate-reference': z.string(), // This could be unnecessary.
            x: z.number(),
            y: z.number(),
          }),
        ),
      }),
    ),
  }),
})

const _blockSchema = z.object({
  'local-id': z.string(),
  'type-name': z.string(),
  'instance-name': z.string(),
  width: z.number(),
  height: z.number(),
  'global-position': z.object({
    x: z.number(),
    y: z.number(),
  }),
  'input-variables': z.array(
    z.object({
      'formal-parameter': z.string(),
      'conection-point-in': z.object({
        'relative-position': z.object({
          x: z.number(),
          y: z.number(),
        }),
        conections: z.array(
          z.object({
            'local-id': z.string(),
            'global-positions': z.array(
              z.object({
                'coordinate-reference': z.string(), // This could be unnecessary.
                x: z.number(),
                y: z.number(),
              }),
            ),
          }),
        ),
      }),
    }),
  ),
  'output-variables': z.array(
    z.object({
      'formal-parameter': z.string(),
      'conection-point-out': z.object({
        'relative-position': z.object({
          x: z.number(),
          y: z.number(),
        }),
      }),
    }),
  ),
})
const _contactSchema = z.object({})
const _coilSchema = z.object({})
const _variableSchema = z.object({})
