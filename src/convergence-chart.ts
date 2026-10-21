/**
 * The Pass-1 RTP convergence chart (outputs/rtp-convergence.html), rendered from the rows of
 * outputs/simulation-results.json.
 *
 * Moved here UNCHANGED from src/simulate.ts on 2026-09-24 so that ONE function draws the chart:
 * the generator calls it when it writes the artifact, and scored Step 16 calls it on the COMMITTED
 * artifact and requires the result to equal the committed HTML byte for byte (profile PLINKO-32).
 * A chart that is not a rendering of the committed traces then fails the audit, instead of being
 * "a presentation aid" that nothing checks (it was MANIFEST DL-10 until this date).
 */

export interface ChartRow {
  riskLevel: number;
  wtf: boolean;
  theoreticalRTP: number;
  convergence: number[];
}

export function renderConvergenceChart(
  rows_: ChartRow[],
  configs: number,
  roundsPerConfig: number,
  meanTheoreticalRTP: number,
  convergenceStep: number,
): string {
// The body below is the generator's code verbatim and deliberately NOT re-indented: the HTML
// template literal's own whitespace is part of the published bytes.
// ── RTP convergence chart (running mean RTP per config toward theory) ──────────
// One polyline per config: running mean simulated RTP sampled every convergenceStep
// rounds, over the full 1M-round run. As n grows each trace tightens onto its own
// theoretical RTP; the bold reference line is the equal-weighted theoretical mean.

const W = 920, H = 460, PAD_L = 64, PAD_R = 24, PAD_T = 48, PAD_B = 52;
const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
const allConv = rows_.flatMap(r => r.convergence);
const yMinData = Math.min(...allConv, ...rows_.map(r => r.theoreticalRTP));
const yMaxData = Math.max(...allConv, ...rows_.map(r => r.theoreticalRTP));
// Pad the y-range a touch so no trace touches the frame.
const yPad = (yMaxData - yMinData) * 0.12 || 0.001;
const yMin = yMinData - yPad, yMax = yMaxData + yPad;
const nPts = Math.max(...rows_.map(r => r.convergence.length), 1);
const xAt = (i: number) => PAD_L + (nPts <= 1 ? plotW : (i / (nPts - 1)) * plotW);
const yAt = (v: number) => PAD_T + (1 - (v - yMin) / (yMax - yMin)) * plotH;

const traceColor = (r: ChartRow) => r.wtf ? '#c0392b' : ['#3b82f6', '#8b5cf6', '#10b981'][r.riskLevel - 1] ?? '#888';
const polylines = rows_.map(r => {
  const pts = r.convergence.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
  return `<polyline points="${pts}" fill="none" stroke="${traceColor(r)}" stroke-width="1" opacity="0.5"/>`;
}).join('\n    ');
const meanTheoY = yAt(meanTheoreticalRTP);
// Y gridlines / labels at 5 evenly spaced RTP levels.
const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (i / 4) * (yMax - yMin));
const yGrid = yTicks.map(v => {
  const y = yAt(v).toFixed(1);
  return `<line x1="${PAD_L}" y1="${y}" x2="${PAD_L + plotW}" y2="${y}" stroke="#eee" stroke-width="1"/>` +
    `<text x="${PAD_L - 8}" y="${(Number(y) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#666">${(v * 100).toFixed(2)}%</text>`;
}).join('\n    ');
// X labels: rounds at start / mid / end (in thousands).
const xTicks = [0, Math.floor((nPts - 1) / 2), nPts - 1];
const xGrid = xTicks.map(i => {
  const x = xAt(i).toFixed(1);
  const rounds = ((i + 1) * convergenceStep / 1000);
  return `<text x="${x}" y="${(PAD_T + plotH + 20).toFixed(1)}" text-anchor="middle" font-size="11" fill="#666">${rounds}k</text>`;
}).join('\n    ');

const chartHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>LIQD PLINKO — PASS 1 RTP CONVERGENCE</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, sans-serif; background: #fafafa; padding: 24px; }
  .container { max-width: 980px; margin: 0 auto; background: #fff; border-radius: 12px; border: 1px solid #e0e0e0; padding: 32px; }
  h1 { text-align: center; font-size: 16px; font-weight: 600; color: #333; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px; }
  .sub { text-align: center; font-size: 12px; color: #777; margin-bottom: 16px; }
  svg { display: block; width: 100%; height: auto; }
  .legend { display: flex; gap: 18px; justify-content: center; font-size: 12px; color: #555; margin-top: 8px; flex-wrap: wrap; }
  .legend span::before { content: ''; display: inline-block; width: 14px; height: 3px; margin-right: 6px; vertical-align: middle; }
  .lo::before { background: #3b82f6; } .me::before { background: #8b5cf6; } .hi::before { background: #10b981; }
  .wt::before { background: #c0392b; } .th::before { background: #111; }
  .info { color: #555; font-size: 12px; margin-top: 14px; text-align: center; }
</style>
</head>
<body>
<div class="container">
  <h1>LIQD Plinko — Pass 1 RTP Convergence</h1>
  <div class="sub">Running mean simulated RTP per configuration vs cumulative rounds (${configs} configs × ${roundsPerConfig.toLocaleString()} rounds)</div>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Per-config RTP convergence traces">
    <rect x="${PAD_L}" y="${PAD_T}" width="${plotW}" height="${plotH}" fill="#fff" stroke="#ddd"/>
    ${yGrid}
    ${xGrid}
    ${polylines}
    <line x1="${PAD_L}" y1="${meanTheoY.toFixed(1)}" x2="${PAD_L + plotW}" y2="${meanTheoY.toFixed(1)}" stroke="#111" stroke-width="1.5" stroke-dasharray="6 4"/>
    <text x="${(PAD_L + plotW).toFixed(1)}" y="${(meanTheoY - 6).toFixed(1)}" text-anchor="end" font-size="11" fill="#111">mean theoretical ${(meanTheoreticalRTP * 100).toFixed(4)}%</text>
    <text x="${(PAD_L + plotW / 2).toFixed(1)}" y="${(H - 12).toFixed(1)}" text-anchor="middle" font-size="12" fill="#444">Cumulative rounds</text>
  </svg>
  <div class="legend">
    <span class="lo">Low (risk 1)</span><span class="me">Medium (risk 2)</span><span class="hi">High (risk 3)</span><span class="wt">WTF (risk 4)</span><span class="th">Equal-weighted theoretical mean</span>
  </div>
  <p class="info">Each trace is one config's running mean RTP, sampled every ${(convergenceStep / 1000)}k rounds. All ${configs} traces tighten onto their per-config theoretical RTP (band 98.9063%–99.1602%); the equal-weighted theoretical mean is ${(meanTheoreticalRTP * 100).toFixed(4)}%. Simulated seeds are fresh each run, so exact traces differ run to run while the convergence behaviour is stable.</p>
</div>
</body>
</html>`;
return chartHTML;
}
