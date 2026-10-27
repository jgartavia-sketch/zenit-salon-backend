import { httpError } from "./security.js";
export function validDate(date) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T12:00:00Z`)) &&
    new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date
  );
}
export function minutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
export const clock = (n) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export const instant = (date, time) => new Date(`${date}T${time}:00-06:00`);
export const overlaps = (a, b, c, d) => +a < +d && +b > +c;
export const crDate = (value = new Date()) =>
  new Date(+value - 6 * 3600000).toISOString().slice(0, 10);
export function rangesFor(config, date) {
  const special = config.overrides.find((x) => x.date === date);
  return special
    ? special.ranges
    : config.weekly
        .filter((x) => x.day === new Date(`${date}T12:00:00Z`).getUTCDay())
        .flatMap((x) => x.ranges);
}
export function validateRanges(ranges) {
  const sorted = [...ranges].sort(
    (a, b) => minutes(a.start) - minutes(b.start),
  );
  if (
    sorted.some(
      (r, i) =>
        minutes(r.start) >= minutes(r.end) ||
        (i > 0 && minutes(sorted[i - 1].end) > minutes(r.start)),
    )
  )
    throw httpError(
      400,
      "Los horarios no pueden cruzarse ni terminar antes de empezar.",
    );
}
export function buildSlots(config, date, duration, busy, now = new Date()) {
  const slots = [];
  for (const range of rangesFor(config, date)) {
    for (
      let n = minutes(range.start);
      n + duration <= minutes(range.end);
      n += 15
    ) {
      const start = instant(date, clock(n)),
        end = new Date(+start + duration * 60000);
      if (+start < +now + config.noticeMinutes * 60000) continue;
      const occupied = busy.some((x) =>
        overlaps(start, end, x.startAt, x.endAt),
      );
      slots.push({
        time: clock(n),
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        available: !occupied,
      });
    }
  }
  return slots;
}
