// Queries the core makes inside update (spec §5.2). Everything here is synchronous; slow work goes through effects.
export type FontSpec = { family: string; size: number; weight?: number }; // size in px

export interface Host {
  textMetrics(text: string, font: FontSpec): { width: number; ascent: number; descent: number };
  now(): number;
  newId(): string;
}
