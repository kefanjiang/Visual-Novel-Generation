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
