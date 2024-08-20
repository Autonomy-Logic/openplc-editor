/**
 * ----------------------------------------------------------------
 * This file is part of OpenPLC documentation.
 * Here is defined the shape of the mapped data structure for the Ladder Diagram language.
 * ----------------------------------------------------------------
 */

import { z } from 'zod'

const _powerRails = z.object({
  left: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      label: z.string(),
      data: z.object({
        handles: z.array(
          z.object({
            x: z.number(),
            y: z.number(),
            type: z.enum(['left', 'right']),
          }),
        ),
      }),
    }),
  ),
  right: z.array(
    z.object({
      // Same structure as left power rails
    }),
  ),
})
