import type { FrozenEstimateDTO, ScheduleDateDTO, ScheduleDTO, StoreConfig } from "@/lib/types";
import { hourLabel } from "@/lib/types";
import { db } from "./store";

/*
 * Advance-ordering schedule.
 * Chilled: bookable delivery days and time slots, with order cut-offs and per-slot capacity.
 * Frozen: next courier dispatch day and an estimated delivery window.
 * Calendar dates are Europe/London dates, held as UTC-midnight timestamps for easy arithmetic.
 */

export const SLOT_HOLD_MINUTES = 30; // unpaid orders hold their slot for this long
const DAY = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const londonFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });

function londonNow(): { today: number; hour: number } {
  const p = Object.fromEntries(londonFormat.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { today: Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)), hour: Number(p.hour) };
}

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** 0 = Sunday … 6 = Saturday, the convention used in the configuration. */
const weekday = (ms: number) => new Date(ms).getUTCDay();

function fmt(ms: number, o: { weekday?: "long" | "short"; day?: boolean; month?: "long" | "short" }): string {
  const d = new Date(ms);
  const parts: string[] = [];
  if (o.weekday) parts.push(o.weekday === "long" ? WEEKDAYS[d.getUTCDay()] : WEEKDAYS[d.getUTCDay()].slice(0, 3));
  if (o.day) parts.push(String(d.getUTCDate()));
  if (o.month) parts.push(o.month === "long" ? MONTHS[d.getUTCMonth()] : MONTHS[d.getUTCMonth()].slice(0, 3));
  return parts.join(" ");
}

/** An order occupies its slot once paid, or while a recent checkout attempt is still in progress. */
export function slotsTaken(date: string, slotId: string): number {
  const holdFrom = Date.now() - SLOT_HOLD_MINUTES * 60_000;
  return db().orders.filter(
    (o) =>
      o.chilledDate === date &&
      o.chilledSlotId === slotId &&
      o.status !== "cancelled" &&
      (o.paymentStatus === "paid" || o.createdAt.getTime() > holdFrom),
  ).length;
}

export function getFrozenEstimate(config: StoreConfig): FrozenEstimateDTO {
  const f = config.frozenSchedule;
  const { today, hour } = londonNow();
  let dispatch = today;
  for (let i = 0; i < 21; i++) {
    const d = today + i * DAY;
    const pastCutoff = i === 0 && hour >= f.cutoffHour;
    if (f.dispatchWeekdays.includes(weekday(d)) && !pastCutoff) {
      dispatch = d;
      break;
    }
  }
  const start = dispatch + f.transitDaysMin * DAY;
  const end = dispatch + f.transitDaysMax * DAY;
  const short = (d: number) => fmt(d, { weekday: "short", day: true, month: "short" });
  return {
    dispatchDate: isoDate(dispatch),
    dispatchLabel: fmt(dispatch, { weekday: "long", day: true, month: "long" }),
    estimateLabel: start === end ? short(start) : `${short(start)} – ${short(end)}`,
    cutoffLabel: `Order by ${hourLabel(f.cutoffHour)} on ${fmt(dispatch, { weekday: "long" })} for this dispatch`,
  };
}

export function getChilledDates(config: StoreConfig): ScheduleDateDTO[] {
  const c = config.chilledSchedule;
  const { today, hour } = londonNow();
  const dates: ScheduleDateDTO[] = [];
  for (let i = 0; i <= c.horizonDays; i++) {
    if (dates.length >= 8) break;
    const d = today + i * DAY;
    if (!c.deliveryWeekdays.includes(weekday(d))) continue;
    const cutoff = d - c.cutoffDaysBefore * DAY;
    const open = today < cutoff || (today === cutoff && hour < c.cutoffHour);
    dates.push({
      date: isoDate(d),
      weekday: fmt(d, { weekday: "short" }),
      dayLabel: fmt(d, { day: true, month: "short" }),
      longLabel: fmt(d, { weekday: "long", day: true, month: "long" }),
      cutoffLabel: `Order by ${hourLabel(c.cutoffHour)} on ${fmt(cutoff, { weekday: "long", day: true, month: "short" })}`,
      open,
      slots: c.slots.map((s) => {
        const remaining = Math.max(0, c.capacityPerSlot - slotsTaken(isoDate(d), s.id));
        return { id: s.id, label: s.label, remaining, available: open && remaining > 0 };
      }),
    });
  }
  return dates;
}

export function getSchedule(config: StoreConfig): ScheduleDTO {
  return { chilled: getChilledDates(config), frozen: getFrozenEstimate(config) };
}
