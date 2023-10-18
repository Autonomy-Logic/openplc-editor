import { Schema } from 'electron-store';

import { z } from 'zod';

/**
 * Defines the Zod schema for the default store configuration.
 */
export const defaultStoreSchema = z.object({
  /** An array containing the most recent projects path. */
  recentProjects: z.array(z.string()).max(5),
  /**
   * Represents the application's theme configuration.
   */
  theme: z.string(),
  /**
   * Represents the configuration for the application window.
   */
  window: z.object({
    /**
     * Represents the bounds (size and position) of the application window.
     */
    bounds: z
      .object({
        /**
         * Width of the application window.
         */
        width: z.number(),
        /**
         * Height of the application window.
         */
        height: z.number(),
        /**
         * X-coordinate of the application window's position.
         */
        x: z.number(),
        /**
         * Y-coordinate of the application window's position.
         */
        y: z.number(),
      })
      .optional(), // The window bounds are optional.
  }),
});
/**
 * Type definition for the inferred properties of the default store schema.
 */
export type DefaultStoreProps = z.infer<typeof defaultStoreSchema>;
/**
 * Generates the default store configuration.
 * @returns {DefaultStoreProps} The default store configuration.
 */
export const getDefaultStore = (): DefaultStoreProps => {
  return {
    recentProjects: [],
    theme: 'light',
    window: {},
  };
};

export const schema: Schema<DefaultStoreProps> = {
  recentProjects: { type: ['string'] },
  /**
   * Schema definition for the 'theme' property.
   */
  theme: {
    type: 'string',
  },
  /**
   * Schema definition for the 'window' property.
   */
  window: {
    type: 'object',
    properties: {
      /**
       * Schema definition for the 'bounds' property within the 'window'.
       */
      bounds: {
        type: 'object',
        properties: {
          /**
           * Schema definition for the 'width' property within the 'bounds'.
           */
          width: {
            type: 'number',
          },
          /**
           * Schema definition for the 'height' property within the 'bounds'.
           */
          height: {
            type: 'number',
          },
          /**
           * Schema definition for the 'x' property within the 'bounds'.
           */
          x: {
            type: 'number',
          },
          /**
           * Schema definition for the 'y' property within the 'bounds'.
           */
          y: {
            type: 'number',
          },
        },
      },
    },
  },
};
