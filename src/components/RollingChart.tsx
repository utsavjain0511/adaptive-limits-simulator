import { useEffect, useRef, useState } from 'react';
import { contentWidth } from './contentWidth';

export const WINDOW_POINTS = 600; // 60s at one point per 100ms
export interface Series { label: string; color: string; data: (number | null)[]; dashed?: boolean; }
export interface Threshold { value: number; label: string; color: string; }
// yMax fixes the axis top; yCap lets it auto-scale but never exceed the cap (values beyond are clipped).
interface Props { title: string; unit: string; series: Series[]; thresholds?: Threshold[]; yMax?: number; yCap?: number; height?: number; }

const PAD = { left: 48, right: 40, top: 10, bottom: 20 }; // right pad leaves room for "now" and threshold labels
const fmt = (v: number) => (Math.abs(v) >= 10 ? Math.round(v).toLocaleString() : v.toFixed(1));

function niceCeil(v: number): number {
  const mag = 10 ** Math.floor(Math.log10(v));
  const step = [1, 1.5, 2, 3, 4, 5, 6, 8, 10].find((s) => s * mag >= v) ?? 10;
  return step * mag;
}

export function RollingChart({ title, unit, series, thresholds = [], yMax, yCap, height = 170 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, bump] = useState(0);
  useEffect(() => {
    const onResize = () => bump((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;
    const width = contentWidth(canvas.parentElement);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, width, height, series, thresholds, yMax, yCap);
  });

  return (
    <div className="chart">
      <div className="chart-head">
        <span className="chart-title">{title}</span>
        <span className="chart-legend">
          {series.map((s) => {
            const v = s.data[s.data.length - 1];
            return (
              <span key={s.label}>
                <i className="swatch" style={{ borderTopColor: s.color, borderTopStyle: s.dashed ? 'dashed' : 'solid' }} />
                {s.label} <b>{v == null ? '–' : fmt(v)}{unit}</b>
              </span>
            );
          })}
        </span>
      </div>
      <canvas ref={canvasRef} />
    </div>
  );
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, series: Series[], thresholds: Threshold[], yMax?: number, yCap?: number) {
  ctx.clearRect(0, 0, w, h);
  const plotW = w - PAD.left - PAD.right, plotH = h - PAD.top - PAD.bottom;
  let top = yMax ?? 0;
  if (yMax == null) {
    for (const s of series) for (const v of s.data) if (v != null && v > top) top = v;
    for (const t of thresholds) if (t.value > top) top = t.value;
    top = top <= 0 ? 1 : niceCeil(top * 1.15);
    if (yCap != null) top = Math.min(top, yCap);
  }
  const y = (v: number) => PAD.top + plotH - (Math.min(v, top) / top) * plotH;
  const x = (i: number, n: number) => PAD.left + ((WINDOW_POINTS - n + i) / (WINDOW_POINTS - 1)) * plotW;

  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = '#6b7280';
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 3; g++) {
    const v = (top * g) / 3, yy = y(v);
    ctx.beginPath(); ctx.moveTo(PAD.left, yy); ctx.lineTo(w - PAD.right, yy); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(fmt(v), PAD.left - 6, yy + 4);
  }
  ctx.textAlign = 'left'; ctx.fillText('−60s', PAD.left, h - 5);
  ctx.textAlign = 'center'; ctx.fillText('now', w - PAD.right, h - 5);

  for (const t of thresholds) {
    ctx.save();
    ctx.setLineDash([6, 4]); ctx.strokeStyle = t.color; ctx.fillStyle = t.color;
    ctx.beginPath(); ctx.moveTo(PAD.left, y(t.value)); ctx.lineTo(w - PAD.right, y(t.value)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'left'; ctx.fillText(t.label, w - PAD.right + 6, y(t.value) + 4); // in the right margin, beside the line
    ctx.restore();
  }

  series.forEach((s, k) => {
    const n = s.data.length;
    if (n === 0) return;
    ctx.save();
    ctx.strokeStyle = s.color; ctx.lineWidth = 2;
    // Coincident dashed lines (e.g. a limit sitting exactly on capacity) interleave instead of hiding each other.
    if (s.dashed) { ctx.setLineDash([5, 4]); ctx.lineDashOffset = (k % 3) * 3; }
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < n; i++) {
      const v = s.data[i];
      if (v == null) { pen = false; continue; }
      if (!pen) { ctx.moveTo(x(i, n), y(v)); pen = true; } else ctx.lineTo(x(i, n), y(v));
    }
    ctx.stroke();
    ctx.restore();
  });

  // Where a later solid series exactly matches an earlier one it would hide it completely (both runs behave
  // identically until they diverge), so re-draw the hidden series' colour as dashes on top of that stretch.
  for (let a = 1; a < series.length; a++) {
    const top = series[a];
    if (top.dashed) continue;
    for (let b = 0; b < a; b++) {
      const under = series[b];
      if (under.dashed || under.color === top.color || under.data.length !== top.data.length) continue;
      drawOverlap(ctx, top, under, b, x, y);
    }
  }
}

function drawOverlap(ctx: CanvasRenderingContext2D, top: Series, under: Series, phase: number, x: (i: number, n: number) => number, y: (v: number) => number) {
  const n = top.data.length;
  ctx.save();
  ctx.strokeStyle = under.color; ctx.lineWidth = 2;
  ctx.setLineDash([4, 8]); ctx.lineDashOffset = phase * 4;
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i < n; i++) {
    const t = top.data[i], u = under.data[i];
    const same = t != null && u != null && Math.abs(t - u) <= 1e-6 * Math.max(1, Math.abs(t));
    if (!same) { pen = false; continue; }
    if (!pen) { ctx.moveTo(x(i, n), y(t)); pen = true; } else ctx.lineTo(x(i, n), y(t));
  }
  ctx.stroke();
  ctx.restore();
}
