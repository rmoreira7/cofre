// Maturities as an iCalendar file: one all-day event per maturity group, a reminder 7 days before.
// Color: Google Calendar ignores colors in an imported file (import into a "Cofre" calendar colored Tangerina);
// COLOR (RFC 7986) and X-APPLE-CALENDAR-COLOR are honoured by Apple Calendar and others.
// UIDs are stable (due + bank + issuer), so importing a newer file updates events instead of duplicating them.
export const TANGERINA = "#F4511E";
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

// One maturity group as a calendar event, shared by the .ics file and the Google Calendar sync.
export function maturityEvent(r, { bankName = (b) => b, money = (n) => n.toFixed(2) } = {}) {
  const who = `${r.issuer}${r.n > 1 ? ` ×${r.n}` : ""}`;
  const where = `${bankName(r.bank)}${r.joint ? " (conta conjunta)" : ""}`;
  return {
    uid: `cofre-${r.due}-${slug(r.bank)}-${slug(r.issuer)}@cofre`,
    date: r.due.slice(0, 10),
    end: next(r.due),
    summary: `Vence: ${who} · ${where}`,
    description: `${money(r.balance)} · ${(r.rates || []).join(" / ")}${r.tag === "brb" ? "\nNão renovar no BRB." : ""}`,
    alarm: `Vence em 7 dias: ${who}`,
  };
}

export function maturitiesIcs(rows, { bankName = (b) => b, money = (n) => n.toFixed(2), now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const ev = rows.map((r) => {
    const e = maturityEvent(r, { bankName, money });
    return [
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day(e.date)}`,
      `DTEND;VALUE=DATE:${day(e.end)}`,
      `SUMMARY:${esc(e.summary)}`,
      `DESCRIPTION:${esc(e.description)}`,
      "COLOR:orangered",
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.alarm)}`, "TRIGGER:-P7D", "END:VALARM",
      "END:VEVENT",
    ];
  });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cofre//Vencimentos//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Cofre · Vencimentos", "COLOR:orangered", `X-APPLE-CALENDAR-COLOR:${TANGERINA}`, ...ev.flat(), "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
}
