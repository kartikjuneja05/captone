import {
  ROM_GROUPS, SIDES, romKey, friendlyValue, loadHistory, clearHistory,
} from './romProfile';

const COLORS = { left: '#0284c7', right: '#f97316' };
const MAX_SESSIONS_SHOWN = 12;

// ---------------------------------------------------------------- data shaping
/** History entries -> sessions with friendly degrees (bigger = more range): [{ date, values }] */
export const toSessions = (history) =>
  history.map((h) => ({
    date: new Date(h.measuredAt),
    values: Object.fromEntries(Object.entries(h.values).map(([k, v]) => [k, friendlyValue(k, v)])),
  }));

/** Realistic-looking improving data, for previewing the charts before the user has real history. */
export const sampleSessions = (n = 6) => {
  const base = { shoulder: 128, elbow: 118, knee: 82, hip_straight: 58, hip_bent: 88, hip_wide: 26 };
  const gain = { shoulder: 6, elbow: 3, knee: 5, hip_straight: 5, hip_bent: 4, hip_wide: 3 };
  return Array.from({ length: n }, (_, i) => {
    const values = {};
    for (const g of ROM_GROUPS) {
      for (const [si, side] of SIDES.entries()) {
        values[romKey(side, g)] = Math.round(base[g.id] + gain[g.id] * i + (si ? -2 : 2) + Math.sin(i * 2 + si + g.id.length) * 1.5);
      }
    }
    return { date: new Date(Date.now() - (n - 1 - i) * 7 * 86400000), values };
  });
};

const seriesFor = (sessions, group) =>
  SIDES.map((side) => ({
    side,
    color: COLORS[side],
    points: sessions.map((s) => s.values[romKey(side, group)] ?? null),
  }));

// ---------------------------------------------------------------- chart drawing (SVG strings)
const W = 680, H = 340;
const M = { l: 50, r: 20, t: 36, b: 54 };
const PW = W - M.l - M.r, PH = H - M.t - M.b;

const niceScale = (minV, maxV, zeroBased) => {
  const range = Math.max(10, maxV - minV);
  const step = [5, 10, 20, 25, 50].find((s) => s >= range / 4) ?? 50;
  const lo = zeroBased ? 0 : Math.max(0, Math.floor((minV - 5) / step) * step);
  let hi = Math.ceil((maxV + 3) / step) * step;
  if (hi <= lo) hi = lo + step;
  return { lo, hi, step };
};

const fmtDate = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

const frame = (sessions, series, group, scale, body) => {
  const y = (v) => M.t + PH - ((v - scale.lo) / (scale.hi - scale.lo)) * PH;
  let grid = '';
  for (let v = scale.lo; v <= scale.hi + 0.001; v += scale.step) {
    grid += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}" stroke="#e5e7eb"/>` +
      `<text x="${M.l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#6b7280">${v}°</text>`;
  }
  const n = sessions.length;
  const INSET = 28;
  const xs = (i) => (body.mode === 'bar' ? M.l + ((i + 0.5) * PW) / n
    : n === 1 ? M.l + PW / 2 : M.l + INSET + (i * (PW - 2 * INSET)) / (n - 1));
  const labels = sessions.map((s, i) =>
    `<text x="${xs(i)}" y="${H - M.b + 18}" text-anchor="middle" font-size="11" fill="#374151">${fmtDate(s.date)}</text>` +
    `<text x="${xs(i)}" y="${H - M.b + 32}" text-anchor="middle" font-size="10" fill="#9ca3af">check ${s.index}</text>`).join('');
  const legend = series.map((s, i) =>
    `<rect x="${W - M.r - 130 + i * 70}" y="10" width="12" height="12" rx="2" fill="${s.color}"/>` +
    `<text x="${W - M.r - 113 + i * 70}" y="20" font-size="12" fill="#374151">${s.side === 'left' ? 'Left' : 'Right'}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img"
      aria-label="${group.label} over time" font-family="system-ui, sans-serif">
    <rect width="${W}" height="${H}" fill="#fff"/>
    <text x="${M.l}" y="20" font-size="13" font-weight="600" fill="#111827">${group.label} (degrees of range)</text>
    ${grid}${labels}${legend}${body.draw(xs, y)}</svg>`;
};

const withIndex = (sessions) => sessions.map((s, i) => ({ ...s, index: s.index ?? i + 1 }));

export const lineChartSVG = (allSessions, group) => {
  const sessions = withIndex(allSessions).slice(-MAX_SESSIONS_SHOWN);
  const series = seriesFor(sessions, group);
  const vals = series.flatMap((s) => s.points).filter((v) => v !== null);
  if (vals.length === 0) return '';
  const scale = niceScale(Math.min(...vals), Math.max(...vals), false);
  return frame(sessions, series, group, scale, {
    mode: 'line',
    draw: (xs, y) => series.map((s) => {
      // break the line where a session skipped this joint
      let path = '';
      let pen = false;
      s.points.forEach((v, i) => {
        if (v === null) { pen = false; return; }
        path += `${pen ? 'L' : 'M'}${xs(i).toFixed(1)} ${y(v).toFixed(1)} `;
        pen = true;
      });
      const labelDy = s.side === 'left' ? -10 : 18;
      const dots = s.points.map((v, i) => (v === null ? '' :
        `<circle cx="${xs(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4.5" fill="#fff" stroke="${s.color}" stroke-width="2.5">
          <title>${s.side} - ${fmtDate(sessions[i].date)}: ${v}°</title></circle>` +
        `<text x="${xs(i).toFixed(1)}" y="${(y(v) + labelDy).toFixed(1)}" text-anchor="middle" font-size="10" fill="${s.color}">${v}°</text>`)).join('');
      return `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"/>${dots}`;
    }).join(''),
  });
};

export const barChartSVG = (allSessions, group) => {
  const sessions = withIndex(allSessions).slice(-MAX_SESSIONS_SHOWN);
  const series = seriesFor(sessions, group);
  const vals = series.flatMap((s) => s.points).filter((v) => v !== null);
  if (vals.length === 0) return '';
  const scale = niceScale(0, Math.max(...vals), true);
  return frame(sessions, series, group, scale, {
    mode: 'bar',
    draw: (xs, y) => {
      const groupW = PW / sessions.length;
      const barW = Math.min(34, (groupW * 0.8) / series.length);
      return series.map((s, si) => s.points.map((v, i) => {
        if (v === null) return '';
        const x = xs(i) + (si - (series.length - 1) / 2) * barW - barW / 2;
        return `<rect x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${(y(scale.lo) - y(v)).toFixed(1)}" rx="3" fill="${s.color}">
            <title>${s.side} - ${fmtDate(sessions[i].date)}: ${v}°</title></rect>` +
          `<text x="${(x + (barW - 2) / 2).toFixed(1)}" y="${(y(v) - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="#374151">${v}</text>`;
      }).join('')).join('');
    },
  });
};

/** First vs latest measurement of every movement, with the change. */
export const summaryTableHTML = (sessions) => {
  const rows = ROM_GROUPS.map((g) => {
    const cells = SIDES.map((side) => {
      const pts = sessions.map((s) => s.values[romKey(side, g)]).filter((v) => v !== undefined);
      if (pts.length === 0) return '<td>-</td><td>-</td><td>-</td>';
      const first = pts[0], last = pts[pts.length - 1], d = last - first;
      const change = pts.length < 2 ? '<span style="color:#9ca3af;">first check</span>'
        : d > 0 ? `<b style="color:#16a34a;">&#9650; +${d}°</b>`
          : d < 0 ? `<b style="color:#6b7280;">&#9660; ${d}°</b>` : '<span style="color:#6b7280;">no change</span>';
      return `<td>${first}°</td><td>${last}°</td><td>${change}</td>`;
    }).join('');
    return `<tr><th scope="row">${g.label}</th>${cells}</tr>`;
  }).join('');
  return `<table class="progress-table">
    <thead><tr><th rowspan="2"></th><th colspan="3" style="color:${COLORS.left}">Left</th><th colspan="3" style="color:${COLORS.right}">Right</th></tr>
    <tr><th>First</th><th>Latest</th><th>Change</th><th>First</th><th>Latest</th><th>Change</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
};

// ---------------------------------------------------------------- view wiring
export const initProgressView = ({ onBack }) => {
  const $ = (id) => document.getElementById(id);
  const select = $('progress-joint');
  const chart = $('progress-chart');
  const table = $('progress-table');
  const note = $('progress-note');
  const lineBtn = $('progress-line');
  const barBtn = $('progress-bar');
  const sampleBtn = $('progress-sample');
  const clearBtn = $('progress-clear');

  select.innerHTML = ROM_GROUPS.map((g) => `<option value="${g.id}">${g.label}</option>`).join('');
  const state = { type: 'line', sample: false };

  const render = () => {
    const sessions = state.sample ? sampleSessions() : toSessions(loadHistory());
    lineBtn.classList.toggle('active', state.type === 'line');
    barBtn.classList.toggle('active', state.type === 'bar');
    sampleBtn.textContent = state.sample ? 'Show my real data' : 'Preview with sample data';
    sampleBtn.style.display = !state.sample && sessions.length >= 2 ? 'none' : 'inline-block';
    clearBtn.style.display = state.sample || sessions.length === 0 ? 'none' : 'inline-block';

    if (sessions.length === 0) {
      note.textContent = 'No flexibility checks yet. Complete one from the menu and your results will appear here.';
      chart.innerHTML = '';
      table.innerHTML = '';
      return;
    }
    note.textContent = state.sample ? 'Sample data preview. These are not your results.'
      : sessions.length === 1 ? 'One check recorded so far. Repeat it in a week or two to see your progress.'
        : `${sessions.length} checks recorded. Showing ${Math.min(sessions.length, MAX_SESSIONS_SHOWN)} most recent.`;
    const group = ROM_GROUPS.find((g) => g.id === select.value) ?? ROM_GROUPS[0];
    const svg = state.type === 'line' ? lineChartSVG(sessions, group) : barChartSVG(sessions, group);
    chart.innerHTML = svg || '<p style="color:#6b7280;">This movement has not been measured yet.</p>';
    table.innerHTML = summaryTableHTML(sessions);
  };

  lineBtn.addEventListener('click', () => { state.type = 'line'; render(); });
  barBtn.addEventListener('click', () => { state.type = 'bar'; render(); });
  select.addEventListener('change', render);
  sampleBtn.addEventListener('click', () => { state.sample = !state.sample; render(); });
  clearBtn.addEventListener('click', () => {
    if (window.confirm('Delete all saved flexibility checks? This cannot be undone.')) { clearHistory(); render(); }
  });
  $('progress-back').addEventListener('click', onBack);

  return { open: () => { state.sample = false; render(); } };
};
