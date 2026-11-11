import type { Choice, Condition, Effect, Story, StoryNode, Variable } from "@/lib/story/schema";

export interface GameState {
  nodeId: string;
  vars: Record<string, number>;
  history: string[];
  ended: boolean;
}

export function indexNodes(story: Story): Record<string, StoryNode>;
export function clampVar(def: Variable, value: number): number;
export function initState(story: Story): GameState;
export function evalCondition(condition: Condition | null | undefined, vars: Record<string, number>): boolean;
export function availableChoices(story: Story, state: GameState): { choice: Choice; index: number }[];
export function applyEffects(story: Story, vars: Record<string, number>, effects: Effect[]): Record<string, number>;
export function step(story: Story, state: GameState, choiceIndex: number): GameState;

export interface Cursor {
  state: GameState;
  line: number;
  trail: GameState[];
}
export const TRAIL_LIMIT: number;
export function initCursor(story: Story): Cursor;
export function choose(story: Story, cursor: Cursor, choiceIndex: number): Cursor;
export function canRewind(cursor: Cursor): boolean;
export function rewind(story: Story, cursor: Cursor): Cursor;
