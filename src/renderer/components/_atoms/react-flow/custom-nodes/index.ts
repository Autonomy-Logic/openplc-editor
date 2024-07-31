import { POWER_RAIL_HEIGHT, POWER_RAIL_WIDTH, PowerRail } from './power-rail'

export const customNodeTypes = {
  powerRail: PowerRail,
}

export const customNodesStyles = {
  powerRail: {
    width: POWER_RAIL_WIDTH,
    height: POWER_RAIL_HEIGHT,
  },
}
