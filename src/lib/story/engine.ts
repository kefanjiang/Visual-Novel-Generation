// Server-side access to the exact engine core that ships inside every game.
export {
  applyEffects,
  availableChoices,
  clampVar,
  evalCondition,
  indexNodes,
  initState,
  step,
} from "../../../template/engine/core.js";
export type { GameState } from "../../../template/engine/core.js";
