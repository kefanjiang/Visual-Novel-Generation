"use client";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: init?.json !== undefined ? { "content-type": "application/json", ...init?.headers } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `请求失败（${res.status}）`);
  return body;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ProjectPayload {
  project: {
    id: string;
    title: string;
    genre: string | null;
    prompt: string;
    isExample: boolean;
    forkedFrom: string | null;
    currentVersionId: string | null;
    isOwner: boolean;
  };
  messages: {
    id: string;
    role: "user" | "agent" | "system";
    agent: string | null;
    content: string;
    versionId: string | null;
    runId: string | null;
    createdAt: string;
  }[];
  versions: { id: string; n: number; source: string; summary: string; createdAt: string }[];
  currentVersion: { id: string; n: number; files: Record<string, string>; story: unknown } | null;
  run: { id: string; kind: string; stage: string; status: "running" | "done" | "failed"; error: string | null } | null;
}
