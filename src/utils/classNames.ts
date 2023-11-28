/**
 * Combines a list of strings and booleans into a space-separated string of class names.
 * Only truthy strings are used as class names.
 *
 * @param {...(string | boolean)} classes - The list of class names and boolean values to combine.
 * @returns {string} The combined space-separated string of class names.
 */
const classNames = (...classes: (string | boolean)[]) => 
  /**
   * Filter out falsy values and join the truthy strings with a space separator.
   *
   * @param {string | boolean} value - The class name or boolean value to filter.
   * @returns {boolean} Whether the value is truthy.
   */
   classes.filter(Boolean).join(' ')
;

export default classNames;
