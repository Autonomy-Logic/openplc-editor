import { useCallback, useState } from 'react'

const useToggle = (defaultValue?: boolean): [boolean, () => void] => {
  const [value, setValue] = useState(!!defaultValue)

  const toggle = useCallback(() => setValue((state) => !state), [])

  return [value, toggle]
}

export default useToggle
