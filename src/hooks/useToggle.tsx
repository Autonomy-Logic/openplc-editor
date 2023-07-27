import { useCallback, useState } from 'react'

const useToggle = (
  defaultValue?: boolean,
): [boolean, (value?: boolean) => void] => {
  const [value, setValue] = useState(!!defaultValue)

  const toggle = useCallback(
    (value?: boolean) =>
      setValue((state) =>
        value && typeof value === 'boolean' ? value : !state,
      ),
    [],
  )

  return [value, toggle]
}

export default useToggle
