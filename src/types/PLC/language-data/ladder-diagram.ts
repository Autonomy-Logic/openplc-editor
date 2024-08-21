/**
 * ----------------------------------------------------------------
 * This file is part of OpenPLC documentation.
 * Here is defined the shape of the mapped data structure for the Ladder Diagram language.
 * ----------------------------------------------------------------
 */

import { z } from 'zod'

const powerRailSchema = z.object({
  direction: z.enum(['left', 'right']),
  'local-id': z.string(),
  width: z.number(),
  height: z.number(),
  'global-position': z.object({
    x: z.number(),
    y: z.number(),
  }),
  // This is our handles.
  'conection-points': z.array(
    z.object({
      'relative-position': z.object({
        x: z.number(),
        y: z.number(),
      }),
      conection: z.object({
        'local-id': z.string(),
        'global-position-top': z.object({
          x: z.number(),
          y: z.number(),
        }),
        'global-position-bottom': z.object({
          x: z.number(),
          y: z.number(),
        }),
      }),
    }),
  ),
})
