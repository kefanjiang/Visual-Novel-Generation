import { useEffect, useMemo, useState } from "react";
import { availableChoices, indexNodes, initState, step } from "./core";

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

export default function Player({ story, Hud }) {
  const nodes = useMemo(() => indexNodes(story), [story]);
  const chars = useMemo(() => Object.fromEntries(story.characters.map((c) => [c.id, c])), [story]);
  const saveKey = SAVE_PREFIX + story.meta.title;
  const endingsKey = ENDINGS_PREFIX + story.meta.title;

  const [state, setState] = useState(() => {
    const saved = load(saveKey, null);
    return saved && nodes[saved.nodeId] ? saved : initState(story);
  });
  const [lineIndex, setLineIndex] = useState(0);
  const [endings, setEndings] = useState(() => load(endingsKey, []));

  const node = nodes[state.nodeId];
  const lines = node ? node.lines : [];
  const allShown = lineIndex >= lines.length - 1;

  useEffect(() => {
    save(saveKey, state);
  }, [saveKey, state]);

  useEffect(() => {
    if (state.ended && allShown && !endings.includes(state.nodeId)) {
      const next = [...endings, state.nodeId];
      setEndings(next);
      save(endingsKey, next);
    }
  }, [state, allShown, endings, endingsKey]);

  if (!node) return <div className="sg-error">剧情数据有误：找不到节点 {state.nodeId}</div>;

  const choose = (index) => {
    setState(step(story, state, index));
    setLineIndex(0);
  };
  const restart = () => {
    setState(initState(story));
    setLineIndex(0);
  };

  const line = lines[Math.min(lineIndex, lines.length - 1)];
  const speaker = line.speaker ? chars[line.speaker] : null;
  const endingNodes = story.nodes.filter((n) => n.type === "ending");

  return (
    <div className="sg-root">
      <header className="sg-header">
        <span className="sg-title">{story.meta.title}</span>
        <span className="sg-bg">{node.bg}</span>
      </header>

      {Hud ? <Hud vars={state.vars} variables={story.variables} characters={story.characters} /> : null}

      <main className="sg-stage" onClick={() => !allShown && setLineIndex(lineIndex + 1)}>
        {speaker ? (
          <div className="sg-portrait" style={{ borderColor: speaker.color }}>
            <span className="sg-avatar">{speaker.avatar}</span>
            <span className="sg-name" style={{ color: speaker.color }}>{speaker.name}</span>
          </div>
        ) : null}
        <p className={speaker ? "sg-line" : "sg-line sg-narration"} key={state.nodeId + ":" + lineIndex}>
          {line.text}
        </p>
        {!allShown ? <span className="sg-hint">点击继续 ▸</span> : null}
      </main>

      {allShown && node.type === "scene" ? (
        <nav className="sg-choices">
          {availableChoices(story, state).map(({ choice, index }) => (
            <button key={index} className="sg-choice" onClick={() => choose(index)}>
              {choice.text}
            </button>
          ))}
        </nav>
      ) : null}

      {allShown && node.type === "ending" ? (
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
