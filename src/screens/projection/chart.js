import { brl, ddmm, MES } from "../../lib/format.js";
import { nextLevels } from "../../lib/projection.js";

// Every scenario to December of `y1`, the chosen one in brand; the real points (since the projection's start) first.
export function chart(scns, chosen, run, start, today, y1, rr) {
  const W = 340, H = 170, m = { l: 4, r: 40, t: 20, b: 22 };
  const ms = (d) => Date.parse(d + "T12:00:00Z");
  const from = rr?.from && rr.from < today ? rr.from : today, to = `${y1}-12-31`;
  const end = (mo) => { const [y, mm] = mo.split("-").map(Number); return `${mo}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, "0")}`; };
  const lines = scns.map(([k, label, sp]) => [k, label, [{ d: today, v: start }, ...run(sp).path.map((q) => ({ d: end(q.month), v: q.worth }))]]);
  const vals = [...lines.flatMap((l) => l[2].map((q) => q.v)), ...(rr?.actual || []).map((a) => a.real)];
  const lo = Math.min(...vals) * 0.97, hi = Math.max(...vals);
  const x = (d) => m.l + ((ms(d) - ms(from)) / (ms(to) - ms(from))) * (W - m.l - m.r);
  const y = (val) => m.t + (1 - (val - lo) / (hi - lo || 1)) * (H - m.t - m.b);
  let g = "";
  for (const k of nextLevels(lo, 6).filter((k) => k <= hi)) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(k)}" y2="${y(k)}" stroke="var(--line)"/><text x="${W - m.r + 4}" y="${y(k) + 3}" font-size="9.5" fill="var(--ink-3)">${k / 1000}k</text>`;
  for (const [k, label, pts] of [...lines].sort((a, b) => (a[0] === chosen) - (b[0] === chosen))) {
    const on = k === chosen, last = pts.at(-1);
    g += `<polyline points="${pts.map((q) => `${x(q.d)},${y(q.v)}`).join(" ")}" fill="none" stroke="var(${on ? "--brand" : "--ink-3"})" stroke-width="${on ? 3 : 1.5}" opacity="${on ? 1 : 0.55}" stroke-linejoin="round"/>
      <text x="${x(last.d) - 2}" y="${y(last.v) - 5}" text-anchor="end" font-size="9.5" font-weight="${on ? 700 : 400}" fill="var(${on ? "--brand" : "--ink-3"})">${label}</text>`;
  }
  for (const a of rr?.actual || []) g += `<circle cx="${x(a.d)}" cy="${y(a.real)}" r="3" fill="var(--c-travel)"><title>${ddmm(a.d)} · ${brl(a.real)}</title></circle>`;
  const t = (d, lab, anchor) => `<text x="${x(d)}" y="${H - 6}" text-anchor="${anchor}" font-size="10" fill="var(--ink-3)">${lab}</text>`;
  g += t(from, `${MES[Number(from.slice(5, 7)) - 1]}/${from.slice(2, 4)}`, "start") + t(`${y1 - 1}-12-31`, `dez/${String(y1 - 1).slice(2)}`, "middle") + t(to, `dez/${String(y1).slice(2)}`, "end");
  return g;
}

// Real × projetado: the chosen scenario from the projection's start date against what happened, same banks.
