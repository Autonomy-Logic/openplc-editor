import { useCallback, useState } from 'react'
/**
 * Custom hook to create a toggle state with a boolean value
 * @function
 * @param {boolean} [defaultValue] - Initial value of the toggle state
 * @returns {[boolean, (value?: boolean) => void]} - A tuple containing the current value and a function to toggle it
 */
const useToggle = (
  defaultValue?: boolean,
): [boolean, (value?: boolean) => void] => {
  /**
   * Initialize the state with the provided default value or `false`
   */
  const [value, setValue] = useState(!!defaultValue)
  /**
   * Toggle function to update the value
   * @function
   * @param {boolean} [value] - New value to set (optional)
   */
  const toggle = useCallback(
    (value?: boolean) =>
      setValue((state) =>
        value && typeof value === 'boolean' ? value : !state,
      ),
    [],
  )
  /**
   * Return a tuple containing the current value and the toggle function
   */
  return [value, toggle]
}

export default useToggle
