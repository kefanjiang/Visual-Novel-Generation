import { addMessage, createProject, createRun } from "@/lib/db/repo";
import type { Db } from "@/lib/db/types";
import { initialState } from "./runner";

export const MAX_PROMPT_LENGTH = 500;

/** Create a project + generation run for a new game request. */
export async function startGeneration(db: Db, input: { owner: string; prompt: string }) {
  const prompt = input.prompt.trim().slice(0, MAX_PROMPT_LENGTH);
  if (!prompt) throw new Error("需求不能为空");
  const project = await createProject(db, { owner: input.owner, prompt });
  await addMessage(db, { projectId: project.id, role: "user", content: prompt });
  const run = await createRun(db, { projectId: project.id, kind: "generate", stage: "plan", state: initialState(prompt) });
  return { project, run };
}
