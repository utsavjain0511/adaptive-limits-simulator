import { useEffect, useRef } from 'react';
import { createFlow, stepFlow, type FlowState, type Particle } from '../anim/flowModel';
import { contentWidth } from './contentWidth';
import type { TickMetrics } from '../sim/types';

export interface LaneView { label: string; color: string; latest?: TickMetrics; }
interface Props { lanes: LaneView[]; running: boolean; slaMs: number; height?: number; }

const INK = '#1c2430', MUTED = '#5f6873', LINE = '#d9dde2', GRAY = '#9aa1a9';
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export function FlowCanvas({ lanes, running, slaMs, height = 230 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ lanes, running, slaMs });
  useEffect(() => { propsRef.current = { lanes, running, slaMs }; });

  useEffect(() => {
    const flow = createFlow(propsRef.current.lanes.length);
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      const { lanes, running, slaMs } = propsRef.current;
      if (lanes.every((l) => !l.latest)) flow.particles.length = 0; // lab was reset
      if (running) {
        stepFlow(flow, lanes.map((l) => ({
          offeredRps: l.latest?.offeredRps ?? 0, admittedRps: l.latest?.admittedRps ?? 0,
          meanLatencyMs: l.latest?.meanLatencyMs ?? 0, slaMs,
        })), dt, Math.random);
      }
      draw(canvasRef.current, flow, lanes, height);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [height]);

  return <div className="flow"><canvas ref={canvasRef} /></div>;
}

interface Box { x: number; y: number; w: number; h: number; }
interface Geometry { laneY: number[]; client: Box; shaper: Box[]; backend: Box[]; exitX: number; }

function geometry(w: number, h: number, n: number): Geometry {
  const laneY = Array.from({ length: n }, (_, i) => (h * (i + 0.5)) / n);
  const boxH = Math.min(68, h / n - 20);
  const shaperW = Math.min(160, w * 0.22), backendW = Math.min(230, w * 0.3);
  const client: Box = { x: 8, y: laneY[0] - boxH / 2, w: Math.min(110, w * 0.15), h: laneY[n - 1] + boxH / 2 - (laneY[0] - boxH / 2) };
  const shaperX = w * 0.42 - shaperW / 2, backendX = Math.min(w * 0.77 - backendW / 2, w - backendW - 24);
  return {
    laneY, client,
    shaper: laneY.map((y) => ({ x: shaperX, y: y - boxH / 2, w: shaperW, h: boxH })),
    backend: laneY.map((y) => ({ x: backendX, y: y - boxH / 2, w: backendW, h: boxH })),
    exitX: w - 6,
  };
}

const fmt = (v: number) => Math.round(v).toLocaleString();

function draw(canvas: HTMLCanvasElement | null, flow: FlowState, lanes: LaneView[], height: number) {
  if (!canvas || !canvas.parentElement) return;
  const w = contentWidth(canvas.parentElement); // never wider than the column: the pane must not scroll sideways
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== w * dpr || canvas.height !== height * dpr) {
    canvas.width = w * dpr; canvas.height = height * dpr;
    canvas.style.width = `${w}px`; canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, height);
  const g = geometry(w, height, lanes.length);

  // lane rails
  ctx.strokeStyle = LINE; ctx.lineWidth = 1;
  g.laneY.forEach((y, i) => {
    ctx.beginPath();
    ctx.moveTo(g.client.x + g.client.w, y); ctx.lineTo(g.shaper[i].x, y);
    ctx.moveTo(g.shaper[i].x + g.shaper[i].w, y); ctx.lineTo(g.backend[i].x, y);
    ctx.moveTo(g.backend[i].x + g.backend[i].w, y); ctx.lineTo(g.exitX, y);
    ctx.stroke();
  });

  const offered = lanes[0]?.latest?.offeredRps ?? 0;
  drawBox(ctx, g.client, 'Client', [`${fmt(offered)} rps offered`]);
  lanes.forEach((lane, i) => {
    const m = lane.latest;
    const limit = m?.limit == null ? 'no concurrency limit' : `limit ${m.limit}`;
    drawBox(ctx, g.shaper[i], lane.label, [limit, `${fmt(m?.rejectedRps ?? 0)}/s rejected`], lane.color);
    const ratio = m ? m.inflight / Math.max(1, m.capacity) : 0;
    const capacityLine = `capacity ${fmt(m?.capacity ?? 0)}${ratio > 1 ? `, ${ratio.toFixed(1)}× over` : ''}`;
    drawBox(ctx, g.backend[i], 'Backend', [`${fmt(m?.inflight ?? 0)} in flight`, capacityLine], lane.color, Math.min(1, ratio), ratio > 1);
  });

  for (const p of flow.particles) {
    const { x, y, alpha, color } = particlePos(p, g, lanes[p.lane].color);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawBox(ctx: CanvasRenderingContext2D, b: Box, title: string, lines: string[], accent?: string, fill = 0, over = false) {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = over ? INK : LINE;
  ctx.lineWidth = over ? 1.5 : 1;
  roundRect(ctx, b.x, b.y, b.w, b.h, 6);
  ctx.fill(); ctx.stroke();
  if (accent) {
    ctx.fillStyle = accent;
    ctx.fillRect(b.x + 10, b.y + 12, 8, 8);
  }
  ctx.fillStyle = INK;
  ctx.font = `600 12px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(title, b.x + (accent ? 24 : 10), b.y + 20, b.w - 20);
  ctx.fillStyle = MUTED;
  ctx.font = `11px ${FONT}`;
  lines.forEach((l, i) => ctx.fillText(l, b.x + 10, b.y + 36 + i * 14, b.w - 20));
  if (accent && fill > 0) {
    ctx.fillStyle = LINE;
    ctx.fillRect(b.x + 10, b.y + b.h - 8, b.w - 20, 3);
    ctx.fillStyle = over ? INK : accent;
    ctx.fillRect(b.x + 10, b.y + b.h - 8, (b.w - 20) * fill, 3);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function particlePos(p: Particle, g: Geometry, laneColor: string): { x: number; y: number; alpha: number; color: string } {
  const y0 = g.laneY[p.lane] + (p.jy - 0.5) * 10;
  const s = g.shaper[p.lane], b = g.backend[p.lane];
  switch (p.stage) {
    case 'toShaper': return { x: g.client.x + g.client.w + (s.x - g.client.x - g.client.w) * p.t, y: y0, alpha: 1, color: laneColor };
    case 'rejected': return { x: s.x + 16 + p.jx * (s.w - 32), y: s.y + s.h + 2 + p.t * 22, alpha: 1 - p.t, color: INK };
    case 'toBackend': return { x: s.x + s.w + (b.x - s.x - s.w) * p.t, y: y0, alpha: 1, color: laneColor };
    case 'inBackend': {
      const left = b.x + b.w * 0.55; // labels occupy the left part of the box
      return {
        x: left + 4 + p.jx * (b.x + b.w - 12 - left),
        y: b.y + 10 + p.jy * (b.h - 26) + Math.sin(p.t * 12 + p.jx * 10) * 1.5,
        alpha: 0.9, color: laneColor,
      };
    }
    case 'exiting': return { x: b.x + b.w + (g.exitX - b.x - b.w) * p.t, y: y0, alpha: 1 - p.t, color: p.good ? laneColor : GRAY };
  }
}
