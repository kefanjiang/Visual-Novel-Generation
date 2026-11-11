// Story engine core — pure functions, no React, no DOM.
// The same file runs inside the generated game (Sandpack) and on the server
// (validator / auto-playtest), so simulation and real play always agree.

export function indexNodes(story) {
  const map = {};
  for (const node of story.nodes) map[node.id] = node;
  return map;
}

export function clampVar(def, value) {
  return Math.max(def.min, Math.min(def.max, value));
}

export function initState(story) {
  const vars = {};
  for (const v of story.variables) vars[v.id] = clampVar(v, v.init);
  const start = indexNodes(story)[story.meta.start];
  return {
    nodeId: story.meta.start,
    vars,
    history: [story.meta.start],
    ended: Boolean(start && start.type === "ending"),
  };
}

export function evalCondition(condition, vars) {
  if (!condition) return true;
  const value = vars[condition.var] ?? 0;
  if (condition.op === ">=") return value >= condition.value;
  if (condition.op === "<=") return value <= condition.value;
  if (condition.op === "==") return value === condition.value;
  return false;
}

/** Choices the player can see right now, with their original index. */
export function availableChoices(story, state) {
  const node = indexNodes(story)[state.nodeId];
  if (!node || node.type !== "scene") return [];
  return node.choices
    .map((choice, index) => ({ choice, index }))
    .filter(({ choice }) => evalCondition(choice.condition, state.vars));
}

export function applyEffects(story, vars, effects) {
  const defs = {};
  for (const v of story.variables) defs[v.id] = v;
  const out = { ...vars };
  for (const e of effects || []) {
    const def = defs[e.var];
    if (!def) continue;
    const next = e.op === "set" ? e.value : (out[e.var] ?? 0) + e.value;
    out[e.var] = clampVar(def, next);
  }
  return out;
}

/** Take choice `choiceIndex` (index into node.choices). Throws if not allowed. */
export function step(story, state, choiceIndex) {
  if (state.ended) throw new Error("game already ended");
  const nodes = indexNodes(story);
  const node = nodes[state.nodeId];
  if (!node || node.type !== "scene") throw new Error(`no scene at ${state.nodeId}`);
  const choice = node.choices[choiceIndex];
  if (!choice) throw new Error(`no choice ${choiceIndex} at ${state.nodeId}`);
  if (!evalCondition(choice.condition, state.vars)) throw new Error(`choice ${choiceIndex} is locked`);
  const next = nodes[choice.next];
  if (!next) throw new Error(`missing node ${choice.next}`);
  return {
    nodeId: next.id,
    vars: applyEffects(story, state.vars, choice.effects),
    history: [...state.history, next.id],
    ended: next.type === "ending",
  };
}

// ---- Reading position + rewind ("上一句") ----
// A cursor is where the player is reading: the game state, the line within the
// current node, and a trail of earlier states (one per choice taken).

export const TRAIL_LIMIT = 100;

export function initCursor(story) {
  return { state: initState(story), line: 0, trail: [] };
}

/** Take a choice and remember where we came from, so the player can go back. */
export function choose(story, cursor, choiceIndex) {
  const trail = [...cursor.trail, cursor.state].slice(-TRAIL_LIMIT);
  return { state: step(story, cursor.state, choiceIndex), line: 0, trail };
}

export function canRewind(cursor) {
  return cursor.line > 0 || cursor.trail.length > 0;
}

/**
 * Go back one line. At the first line of a node, return to the previous node's
 * last line with its earlier variables restored, so its choices show again.
 */
export function rewind(story, cursor) {
  if (cursor.line > 0) return { ...cursor, line: cursor.line - 1 };
  if (!cursor.trail.length) return cursor;
  const prev = cursor.trail[cursor.trail.length - 1];
  const node = indexNodes(story)[prev.nodeId];
  return { state: prev, line: Math.max(0, (node ? node.lines.length : 1) - 1), trail: cursor.trail.slice(0, -1) };
}
