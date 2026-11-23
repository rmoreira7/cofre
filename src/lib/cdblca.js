// CDB (taxed, regressive IR) vs LCA/LCI (tax-exempt): the LCA % of CDI that breaks even.
// Daily compounding at a % of the daily CDI; the IR bracket follows calendar days.

export const HORIZONS = [
  { id: "6m", label: "6 meses", bd: 126, days: 183 },
  { id: "9m", label: "9 meses", bd: 189, days: 274 },
  { id: "1a", label: "1 ano", bd: 252, days: 365 },
  { id: "18m", label: "18 meses", bd: 378, days: 548 },
  { id: "2a", label: "2 anos", bd: 504, days: 730 },
  { id: "3a", label: "3 anos", bd: 756, days: 1095 },
  { id: "5a", label: "5 anos", bd: 1260, days: 1826 },
];
export const CDB_RATES = [100, 105, 110, 115, 120, 125];
export const LCA_MIN_DAYS = 270;

export function irRate(days) {
  if (days <= 180) return 0.225;
  if (days <= 360) return 0.2;
  if (days <= 720) return 0.175;
  return 0.15;
}

// cdi: annual CDI as a fraction (0.1365). cdbPct: % of CDI (110). Returns LCA % of CDI.
export function breakEven(cdi, cdbPct, horizon) {
  const d = (1 + cdi) ** (1 / 252) - 1;
  const gross = (1 + d * (cdbPct / 100)) ** horizon.bd - 1;
  const net = 1 + gross * (1 - irRate(horizon.days));
  const lcaDaily = net ** (1 / horizon.bd) - 1;
  return (lcaDaily / d) * 100;
}

export function curves(cdi) {
  return CDB_RATES.map((c) => HORIZONS.map((h) => breakEven(cdi, c, h)));
}
