import "./theme.css";
import story from "./story.json";
import Player from "./engine/Player";
import Hud from "./components/Hud";

export default function App() {
  return <Player story={story} Hud={Hud} />;
}
