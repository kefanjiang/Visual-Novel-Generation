"use client";

import { useEffect, useRef, useState } from "react";
import { api, sleep } from "./api";
import { emptyTimeline, reduceEvents, type ClientEvent, type TimelineState } from "./timeline";

interface RunInfo {
  id: string;
  stage: string;
  status: "running" | "done" | "failed";
  error: string | null;
}

/**
 * Drives a run: the owner's browser keeps calling /advance (one stage per call)
 * while every viewer polls /events once a second. Closing the tab simply pauses the run.
 */
export function useRun(runId: string | null, canDrive: boolean, onSettled: () => void) {
  const [timeline, setTimeline] = useState<TimelineState>(emptyTimeline);
  const [run, setRun] = useState<RunInfo | null>(null);
  const lastId = useRef(0);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    lastId.current = 0;
    setTimeline(emptyTimeline());

    const poll = async () => {
      while (alive) {
        try {
          const r = await api<{ run: RunInfo; events: ClientEvent[] }>(`/api/runs/${runId}/events?after=${lastId.current}`);
          if (!alive) return;
          if (r.events.length) {
            lastId.current = r.events.at(-1)!.id;
            setTimeline((t) => reduceEvents(t, r.events));
          }
          setRun(r.run);
          if (r.run.status !== "running") {
            settledRef.current();
            return;
          }
        } catch {
          // transient network error: keep polling
        }
        await sleep(1200);
      }
    };

    const drive = async () => {
      while (alive && canDrive) {
        try {
          const r = await api<{ status: string; busy?: boolean }>(`/api/runs/${runId}/advance`, { method: "POST" });
          if (r.status !== "running") return;
          if (r.busy) await sleep(2500);
        } catch {
          await sleep(3000);
        }
      }
    };

    poll();
    drive();
    return () => {
      alive = false;
    };
  }, [runId, canDrive]);

  return { timeline, run };
}
