interface Point {
  x: number
  y: number
}

export function parseSvgPath(pathStr: string): Point[] {
  // Tokenize the path string
  const tokens = pathStr.match(/([A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g) || []
  const filteredTokens = tokens.filter((t) => t.trim().length > 0)

  const coordinates: Point[] = []
  let currentPos: Point = { x: 0, y: 0 }
  let startPos: Point = { x: 0, y: 0 }
  let currentCommand: string | null = null
  let i = 0

  while (i < filteredTokens.length) {
    const token = filteredTokens[i]
    if (/[A-Za-z]/.test(token)) {
      currentCommand = token
      i++
    } else {
      if (!currentCommand) {
        throw new Error('Number encountered without preceding command')
      }

      const cmd = currentCommand.toUpperCase()
      const isRelative = currentCommand === currentCommand.toLowerCase()
      const paramCounts: { [key: string]: number } = {
        M: 2,
        L: 2,
        C: 6,
        S: 4,
        Q: 4,
        T: 2,
        H: 1,
        V: 1,
        Z: 0,
      }

      const params: number[] = []
      const expectedParams = paramCounts[cmd] || 0

      while (params.length < expectedParams && i < filteredTokens.length) {
        const num = parseFloat(filteredTokens[i])
        params.push(num)
        i++
      }

      switch (cmd) {
        case 'M': {
          let [x, y] = params
          if (isRelative) {
            x += currentPos.x
            y += currentPos.y
          }
          currentPos = { x, y }
          coordinates.push(currentPos)
          startPos = { ...currentPos }

          // Handle implicit line-to commands
          while (params.length > 2) {
            const [x, y] = params.splice(2, 2)
            const absX = isRelative ? currentPos.x + x : x
            const absY = isRelative ? currentPos.y + y : y
            currentPos = { x: absX, y: absY }
            coordinates.push(currentPos)
          }
          break
        }

        case 'L': {
          for (let j = 0; j < params.length; j += 2) {
            let x = params[j]
            let y = params[j + 1]
            if (isRelative) {
              x += currentPos.x
              y += currentPos.y
            }
            currentPos = { x, y }
            coordinates.push(currentPos)
          }
          break
        }

        case 'H': {
          let x = params[0]
          if (isRelative) x += currentPos.x
          currentPos = { x, y: currentPos.y }
          coordinates.push(currentPos)
          break
        }

        case 'V': {
          let y = params[0]
          if (isRelative) y += currentPos.y
          currentPos = { x: currentPos.x, y }
          coordinates.push(currentPos)
          break
        }

        case 'Z': {
          currentPos = { ...startPos }
          coordinates.push(currentPos)
          break
        }

        // Add cases for other commands (C, Q, etc.) as needed
        default:
          console.warn(`Command ${cmd} not implemented`)
          break
      }
    }
  }

  return coordinates
}
