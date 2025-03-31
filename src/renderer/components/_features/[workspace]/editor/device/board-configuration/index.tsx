const BoardConfiguration = () => {
  const _formatBoardsForLabel = (boards: { board: string; version: string }[]) => {
    const formattedBoards = boards.map(({ board, version }) => `${board} ${version !== '0' && `[ ${version} ]`}`)
    return formattedBoards
  }

  return (
    <div id='board-configuration-container' className='flex h-full w-1/2 flex-col gap-6'>
      <div id='board-figure-container' className='h-[60%]'></div>
      <div id='board-specs-container' className='flex h-[40%]  flex-col items-center justify-center gap-3'>
        <div id='board-selection'>Here goes the board selection</div>
        <div id='programming-port-selection'>Here goes the programming port selection</div>
        <div id='board-specs'>Here goes the specs</div>
      </div>
    </div>
  )
}

export { BoardConfiguration }
