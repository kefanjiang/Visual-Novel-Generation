// Default HUD: shows each numeric variable as a small bar.
// The engineer agent may replace this file; it must keep the same props.
export default function Hud({ vars, variables }) {
  if (!variables || variables.length === 0) return null;
  return (
    <div className="sg-hud">
      {variables.map((v) => {
        const value = vars[v.id] ?? v.init;
        const pct = v.max === v.min ? 0 : ((value - v.min) / (v.max - v.min)) * 100;
        return (
          <div key={v.id} className="sg-hud-item">
            <span>{v.label}</span>
            <span className="sg-hud-bar">
              <span style={{ width: pct + "%" }} />
            </span>
            <span className="sg-hud-value">{value}</span>
          </div>
        );
      })}
    </div>
  );
}
