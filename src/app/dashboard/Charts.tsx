import type { BreakdownRow, HeatCell } from "@/services/analytics";

// Server-rendered SVG, no client code. One series per chart, so no legend is needed: the title names it.
// Hover shows the exact figure through the native tooltip (<title>); "View as table" has every number.

interface Pt { label: string; value: number | null; tip: string }
const W = 640, H = 190, PL = 40, PR = 8, PT = 10, PB = 26;

function niceMax(v: number) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

export function Chart({ title, kind, points, fixedMax, unit }: { title: string; kind: "bar" | "line"; points: Pt[]; fixedMax?: number; unit?: string }) {
  const max = fixedMax ?? niceMax(Math.max(0, ...points.map((p) => p.value ?? 0)));
  const n = points.length;
  const band = (W - PL - PR) / Math.max(n, 1);
  const x = (i: number) => PL + band * i + band / 2;
  const y = (v: number) => PT + (H - PT - PB) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const labelAt = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];

  // Lines break where a period has no answers, instead of joining across the gap.
  const runs: { x: number; y: number }[][] = [];
  if (kind === "line") {
    let cur: { x: number; y: number }[] = [];
    points.forEach((p, i) => {
      if (p.value === null) { if (cur.length) runs.push(cur); cur = []; } else cur.push({ x: x(i), y: y(p.value) });
    });
    if (cur.length) runs.push(cur);
  }

  return (
    <figure className="viz">
      <figcaption><b>{title}</b></figcaption>
      {n === 0 ? <p className="muted">No surveys in this range.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. Open View as table for every value.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="viz-grid" x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} />
              <text className="viz-tick" x={PL - 6} y={y(t) + 4} textAnchor="end">{Math.round(t)}{unit}</text>
            </g>
          ))}
          <line className="viz-axis" x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} />
          {kind === "bar" && points.map((p, i) => {
            const bw = Math.max(2, Math.min(28, band * 0.6));
            const h = p.value ? y(0) - y(p.value) : 0;
            return h > 0 ? <rect key={i} className="viz-bar" x={x(i) - bw / 2} y={y(p.value!)} width={bw} height={h} rx={2} /> : null;
          })}
          {kind === "line" && runs.map((r, i) => (
            <polyline key={i} className="viz-line" points={r.map((q) => `${q.x},${q.y}`).join(" ")} />
          ))}
          {kind === "line" && n <= 30 && points.map((p, i) => p.value === null ? null : <circle key={i} className="viz-dot" cx={x(i)} cy={y(p.value)} r={4} />)}
          {labelAt.map((i) => (
            <text key={i} className="viz-tick" x={Math.min(Math.max(x(i), PL + 20), W - PR - 20)} y={H - 6} textAnchor="middle">{points[i].label}</text>
          ))}
          {points.map((p, i) => (
            <rect key={i} x={PL + band * i} y={PT} width={band} height={H - PT - PB} fill="transparent"><title>{p.tip}</title></rect>
          ))}
        </svg>
      )}
      <details>
        <summary>View as table</summary>
        <table>
          <thead><tr><th>Period</th><th>Value</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.label}><td>{p.label}</td><td>{p.value === null ? "no answers" : `${p.value}${unit ?? ""}`}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

export function BreakdownTable({ title, rows, min }: { title: string; rows: BreakdownRow[]; min: number }) {
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <table>
        <thead><tr><th>Name</th><th>Surveys</th><th>Responses</th><th>Satisfied</th><th>Satisfaction</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td><td>{r.surveys}</td><td>{r.responses}</td><td>{r.satisfied}</td>
              <td>
                {r.satisfactionPct === null
                  ? <span className="muted">fewer than {min} answers</span>
                  : <span className="meter" title={`${r.satisfactionPct}%`}><span style={{ width: `${r.satisfactionPct}%` }} /><b>{r.satisfactionPct}%</b></span>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="muted">No data.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// Darker means a larger share of Unsatisfied answers. One hue, light to dark. The number is always printed.
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#1c5cab", "#104281"];
const EDGES = [0, 5, 10, 20, 30, 50]; // lower edge of each step, in percent
const step = (p: number) => EDGES.reduce((acc, e, i) => (p >= e ? i : acc), 0);

export function Heatmap({ groups, services, cells, min }: { groups: string[]; services: string[]; cells: HeatCell[][]; min: number }) {
  if (groups.length === 0) return <p className="muted">No data.</p>;
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <h3 style={{ marginTop: 0 }}>Unsatisfied answers: support group by service</h3>
      <table className="heat">
        <thead><tr><th />{services.map((s) => <th key={s}>{s}</th>)}</tr></thead>
        <tbody>
          {groups.map((g, i) => (
            <tr key={g}>
              <th scope="row">{g}</th>
              {cells[i].map((c, j) => {
                if (!c.enough || c.dissatisfactionPct === null) {
                  return <td key={j} className="heat-na" title={`${c.responses} answers, fewer than ${min}`}>{c.responses ? `n=${c.responses}` : ""}</td>;
                }
                const s = step(c.dissatisfactionPct);
                return (
                  <td key={j} style={{ background: RAMP[s], color: s >= 3 ? "#ffffff" : "#0b0b0b" }}
                    title={`${g} / ${services[j]}: ${c.dissatisfactionPct}% unsatisfied, ${c.unsatisfied} of ${c.responses}`}>
                    {c.dissatisfactionPct}% <small>n={c.responses}</small>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ marginBottom: 0 }}>
        Share unsatisfied, darker is worse:{" "}
        {RAMP.map((c, i) => <span key={c} className="swatch" style={{ background: c, color: i >= 3 ? "#fff" : "#0b0b0b" }}>{EDGES[i]}%{i === RAMP.length - 1 ? "+" : ""}</span>)}
        {" "}Grey cells have fewer than {min} answers, so no percentage is shown.
      </p>
    </div>
  );
}
