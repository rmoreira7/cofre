// Maturities as an iCalendar file: one all-day event per maturity group, a reminder 7 days before.
// UIDs are stable (due + bank + issuer), so importing a newer file updates events instead of duplicating them.
const esc = (s) => String(s).replace(/[\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
const day = (iso) => iso.slice(0, 10).replace(/-/g, "");
const next = (iso) => new Date(Date.parse(iso.slice(0, 10) + "T12:00:00Z") + 864e5).toISOString().slice(0, 10);
const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// RFC 5545: lines ≤ 75 octets, continuation lines start with a space.
function fold(line) {
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > 74) { out.push(cur); cur = " "; bytes = 1; }
    cur += ch; bytes += b;
  }
  return [...out, cur].join("\r\n");
}

export function maturitiesIcs(rows, { bankName = (b) => b, money = (n) => n.toFixed(2), now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const ev = rows.map((r) => {
    const who = `${r.issuer}${r.n > 1 ? ` ×${r.n}` : ""}`;
    const where = `${bankName(r.bank)}${r.joint ? " (conta conjunta)" : ""}`;
    return [
      "BEGIN:VEVENT",
      `UID:cofre-${r.due}-${slug(r.bank)}-${slug(r.issuer)}@cofre`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day(r.due)}`,
      `DTEND;VALUE=DATE:${day(next(r.due))}`,
      `SUMMARY:${esc(`Vence: ${who} · ${where}`)}`,
      `DESCRIPTION:${esc(`${money(r.balance)} · ${(r.rates || []).join(" / ")}${r.tag === "brb" ? "\nNão renovar no BRB." : ""}`)}`,
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(`Vence em 7 dias: ${who}`)}`, "TRIGGER:-P7D", "END:VALARM",
      "END:VEVENT",
    ];
  });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cofre//Vencimentos//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Cofre · Vencimentos", ...ev.flat(), "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
}
