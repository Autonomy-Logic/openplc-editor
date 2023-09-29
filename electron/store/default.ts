import { z } from 'zod'
/**
 * Defines the Zod schema for the default store configuration.
 */
export const defaultStoreSchema = z.object({
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
  projectPath: z.string(),
})
/**
 * Type definition for the inferred properties of the default store schema.
 */
export type DefaultStoreProps = z.infer<typeof defaultStoreSchema>
/**
 * Generates the default store configuration.
 * @returns {DefaultStoreProps} The default store configuration.
 */
export const getDefaultStore = (): DefaultStoreProps => {
  return {
    theme: 'light',
    window: {},
    projectPath: 'C:\\Users\\user1234567890',
  }
}
