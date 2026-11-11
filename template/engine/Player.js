import { useEffect, useMemo, useState } from "react";
import { availableChoices, canRewind, choose, indexNodes, initCursor, rewind } from "./core";

const SAVE_PREFIX = "story-save:";
const ENDINGS_PREFIX = "story-endings:";

function load(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode / sandbox): play still works, just no save
  }
}

/** Accepts the current save format ({ state, line, trail }) and the older one (a bare state). */
function restore(saved, story, nodes) {
  if (saved && saved.state && nodes[saved.state.nodeId]) {
    const max = nodes[saved.state.nodeId].lines.length - 1;
    return { state: saved.state, line: Math.min(saved.line || 0, Math.max(0, max)), trail: (saved.trail || []).filter((s) => nodes[s.nodeId]) };
  }
  if (saved && saved.nodeId && nodes[saved.nodeId]) return { state: saved, line: 0, trail: [] };
  return initCursor(story);
}

/** The opening "play bill": background, who you are, who you will meet. */
export function Preface({ story, onStart }) {
  const { meta, characters } = story;
  const player = meta.player;
  return (
    <section className="sg-preface">
      <div className="sg-preface-kicker">序 幕</div>
      <h1 className="sg-preface-title">{meta.title}</h1>
      <p className="sg-muted sg-preface-genre">
        {meta.genre} · {meta.tone}
      </p>
      <p className="sg-preface-text">{meta.preface || meta.synopsis}</p>
      {player ? (
        <div className="sg-preface-block">
          <h3>你扮演</h3>
          <p>
            {player.name ? <b className="sg-preface-you">{player.name}</b> : null}
            {player.identity}
          </p>
        </div>
      ) : null}
      <div className="sg-preface-block">
        <h3>登场人物</h3>
        <ul className="sg-cast">
          {characters.map((c) => (
            <li key={c.id}>
              <span className="sg-cast-avatar">{c.avatar}</span>
              <b style={{ color: c.color }}>{c.name}</b>
              <span className="sg-muted">{c.intro || c.role}</span>
            </li>
          ))}
        </ul>
      </div>
      <button className="sg-choice sg-start" onClick={onStart}>
        拉开帷幕 ▸
      </button>
    </section>
  );
}

export default function Player({ story, Hud }) {
  const nodes = useMemo(() => indexNodes(story), [story]);
  const chars = useMemo(() => Object.fromEntries(story.characters.map((c) => [c.id, c])), [story]);
  const saveKey = SAVE_PREFIX + story.meta.title;
  const endingsKey = ENDINGS_PREFIX + story.meta.title;

  const [cursor, setCursor] = useState(() => restore(load(saveKey, null), story, nodes));
  // New players see the preface first; returning players go straight back to where they were.
  const [showPreface, setShowPreface] = useState(() => Boolean(story.meta.preface) && !load(saveKey, null));
  const [endings, setEndings] = useState(() => load(endingsKey, []));

  const { state, line: lineIndex } = cursor;
  const node = nodes[state.nodeId];
  const lines = node ? node.lines : [];
  const allShown = lineIndex >= lines.length - 1;
  const backEnabled = canRewind(cursor);

  useEffect(() => {
    save(saveKey, cursor);
  }, [saveKey, cursor]);

  useEffect(() => {
    if (state.ended && allShown && !endings.includes(state.nodeId)) {
      const next = [...endings, state.nodeId];
      setEndings(next);
      save(endingsKey, next);
    }
  }, [state, allShown, endings, endingsKey]);

  const you = story.meta.player;
  const playerSpeaker = {
    name: you && you.name ? you.name + "（你）" : "你",
    avatar: "👤",
    color: "var(--sg-accent)",
  };

  const next = () => setCursor((c) => (c.line < lines.length - 1 ? { ...c, line: c.line + 1 } : c));
  const back = () => setCursor((c) => rewind(story, c));

  // ← goes back a line, → / space goes forward.
  useEffect(() => {
    const onKey = (e) => {
      if (showPreface) return;
      if (e.key === "ArrowLeft") back();
      else if (e.key === "ArrowRight" || e.key === " ") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!node) return <div className="sg-error">剧情数据有误：找不到节点 {state.nodeId}</div>;

  const pick = (index) => setCursor((c) => choose(story, c, index));
  const restart = () => {
    setCursor(initCursor(story));
    if (story.meta.preface) setShowPreface(true);
  };

  const line = lines[Math.min(lineIndex, lines.length - 1)];
  const speaker = line.speaker === "player" ? playerSpeaker : line.speaker ? chars[line.speaker] : null;
  const endingNodes = story.nodes.filter((n) => n.type === "ending");

  return (
    <div className="sg-root">
      <header className="sg-header">
        <span className="sg-title">{story.meta.title}</span>
        <span className="sg-header-right">
          {!showPreface ? <span className="sg-bg">{node.bg}</span> : null}
          {story.meta.preface && !showPreface ? (
            <button className="sg-link" onClick={() => setShowPreface(true)} title="重看序幕和人物介绍">
              序幕
            </button>
          ) : null}
        </span>
      </header>

      {showPreface ? <Preface story={story} onStart={() => setShowPreface(false)} /> : null}

      {!showPreface && Hud ? <Hud vars={state.vars} variables={story.variables} characters={story.characters} /> : null}

      {showPreface ? null : (
      <main className="sg-stage" onClick={next}>
        {speaker ? (
          <div className="sg-portrait" style={{ borderColor: speaker.color }}>
            <span className="sg-avatar">{speaker.avatar}</span>
            <span className="sg-name" style={{ color: speaker.color }}>{speaker.name}</span>
          </div>
        ) : null}
        <p className={speaker ? "sg-line" : "sg-line sg-narration"} key={state.nodeId + ":" + lineIndex}>
          {line.text}
        </p>
        {backEnabled ? (
          <button
            className="sg-back"
            title="回看上一句（←）"
            onClick={(e) => {
              e.stopPropagation();
              back();
            }}
          >
            ◂ 上一句
          </button>
        ) : null}
        {!allShown ? <span className="sg-hint">点击继续 ▸</span> : null}
      </main>
      )}

      {!showPreface && allShown && node.type === "scene" ? (
        <nav className="sg-choices">
          {availableChoices(story, state).map(({ choice, index }) => (
            <button key={index} className="sg-choice" onClick={() => pick(index)}>
              {choice.text}
            </button>
          ))}
        </nav>
      ) : null}

      {!showPreface && allShown && node.type === "ending" ? (
        <section className="sg-ending">
          <h2>结局：{node.title}</h2>
          <p className="sg-muted">
            已解锁结局 {endings.length} / {endingNodes.length}
          </p>
          <ul className="sg-gallery">
            {endingNodes.map((e) => (
              <li key={e.id} className={endings.includes(e.id) ? "sg-unlocked" : "sg-locked"}>
                {endings.includes(e.id) ? e.title : "？？？"}
              </li>
            ))}
          </ul>
          <button className="sg-choice" onClick={restart}>
            重新开始
          </button>
        </section>
      ) : null}
    </div>
  );
}
