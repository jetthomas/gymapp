import { useState } from 'react';

// shortcut: hand-drawn SVG bars; switch to a chart library if you ever need lines, zoom or legends
export default function BarChart({ title, summary, data, isAlert = () => false, alertAt }) {
  const [asTable, setAsTable] = useState(false);
  const w = 600;
  const h = 140;
  const band = w / data.length;
  const max = Math.max(1, alertAt ?? 0, ...data.map((d) => d.value));
  const y = (v) => h - (v / max) * h;
  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      <p className="hint">{summary}</p>
      {asTable ? (
        <table className="chart-table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td>{d.label}</td>
                <td>{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        // A screen reader hears one image named by the summary; "Show as table" gives exact numbers
        <svg viewBox={`0 0 ${w} ${h + 20}`} role="img" aria-label={`${title}. ${summary}`}>
          {data.map((d, i) => (
            <rect
              key={d.label}
              className={isAlert(d) ? 'bar alert' : 'bar'}
              x={i * band + band * 0.15}
              y={y(d.value)}
              width={band * 0.7}
              height={h - y(d.value)}
            >
              <title>{`${d.label}: ${d.value}`}</title>
            </rect>
          ))}
          {alertAt != null && (
            <line className="alert-line" x1="0" x2={w} y1={y(alertAt)} y2={y(alertAt)} />
          )}
          <text className="axis" x="0" y={h + 16}>
            {data[0]?.label}
          </text>
          <text className="axis" x={w} y={h + 16} textAnchor="end">
            {data.at(-1)?.label}
          </text>
        </svg>
      )}
      <button className="link-btn" type="button" onClick={() => setAsTable(!asTable)}>
        {asTable ? 'Show as chart' : 'Show as table'}
      </button>
    </figure>
  );
}
