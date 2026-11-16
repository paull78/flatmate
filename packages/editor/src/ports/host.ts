// Queries the core makes inside update (spec: editor). Everything here is synchronous; slow work goes through effects.

export interface Host {
  now(): number; // a monotonic clock in ms (timers, frames, toasts): not a calendar
  today(): string; // the local calendar date as YYYY-MM-DD (an export's title block, export.28)
  newId(): string;
}
