// Decisions: what is open, what was decided, and how it turned out. Pure, no DOM; shared by the app and the watcher.
import { daysBetween } from "./format.js";

// Renewals (subscriptions, annual plans) come from the rules file's `renewals`: [{ name, date: "YYYY-MM-DD", note?,
// amount?, every?: "month" | "year" }]. The personal list lives on the laptop, never in this repository.
export function validRenewals(list) {
  return Array.isArray(list) && list.every((r) => r && typeof r.name === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date)
    && (r.note == null || typeof r.note === "string") && (r.amount == null || Number.isFinite(r.amount)));
}

// The renewals still ahead, nearest first, with the days left; `within` days at most.
export function upcomingRenewals(list, today, within = 60) {
  return (list || []).map((r) => ({ ...r, days: daysBetween(today, r.date) }))
    .filter((r) => r.days >= 0 && r.days <= within)
    .sort((a, b) => a.days - b.days);
}

// What money parked in a checking account costs per business day at today's CDI (% per business day).
export const idleCost = (amount, cdiDaily) => (cdiDaily ? (amount * cdiDaily) / 100 : null);
