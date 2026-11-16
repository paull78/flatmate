// The ids a command creates from its opId (cleanup step 09). Code that has the edit's patch reads the id from it;
// these are for code that has none: a refused command's toast, and the tools' previews.

/** The opening an addOpening with this opId creates. */
export const newOpeningId = (opId: string): string => `${opId}/d0`;

/** The wall an addWall with this opId creates (split fragments follow as /w1…, add-wall.ts). */
export const newWallId = (opId: string): string => `${opId}/w0`;
