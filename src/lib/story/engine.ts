// Server-side access to the exact engine core that ships inside every game.
export {
  applyEffects,
  availableChoices,
  canRewind,
  choose,
  clampVar,
  evalCondition,
  indexNodes,
  initCursor,
  initState,
  rewind,
  step,
  TRAIL_LIMIT,
} from "../../../template/engine/core.js";
export type { Cursor, GameState } from "../../../template/engine/core.js";
