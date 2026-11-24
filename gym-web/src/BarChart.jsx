// shortcut: plain CSS bars; switch to a chart library if you ever need lines, zoom or legends
// `max` is shared between charts so their bar heights can be compared
export default function BarChart({
  title,
  summary,
  total,
  data,
  max,
  tone = '',
  alertAt = Infinity,
  totalLabel = 'total',
}) {
  const axis = [data[0], data[Math.floor((data.length - 1) / 2)], data.at(-1)];
  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      <p className="chart-total">
        <span className={tone}>{total}</span> {totalLabel}
      </p>
      <p className="chart-summary">{summary}</p>
      {/* shortcut: 3-digit daily counts would overlap their neighbours' labels; label only the peak then */}
      <div className="bars" aria-hidden="true">
        {[0, 0.5, 1].map((v) => (
          <div key={v} className="grid-line" style={{ '--v': v }}>
            <span>{max * v}</span>
          </div>
        ))}
        {data.map((d) => (
          <div key={d.label} className="bar-col" title={`${d.label}: ${d.value}`}>
            {d.value > 0 && <span className="bar-value">{d.value}</span>}
            <div
              className={`bar ${d.value > alertAt ? 'alert' : tone}`}
              style={{ '--v': d.value / max }}
            />
          </div>
        ))}
      </div>
      <div className="bar-axis" aria-hidden="true">
        {axis.map((d) => (
          <span key={d.label}>{d.label}</span>
        ))}
      </div>
      {/* The bars are a picture; a screen reader gets the exact numbers from this table */}
      <div className="visually-hidden">
        <table>
          <caption>{title}</caption>
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
      </div>
    </figure>
  );
}
