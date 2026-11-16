import { INTER_FAMILY } from "@fm/editor";
import interUrl from "@fm/editor/fonts/Inter-Regular.ttf?url";

/**
 * Loads the bundled Inter (render.15) into the page's font set, so the canvas draws text in the font the core measured
 * it with. Same-origin, from the editor's own file. A failure leaves the generic sans-serif fallback and says so once;
 * past `timeoutMs` the app starts anyway (the face still joins the set when it arrives, and later frames use it).
 */
export async function loadInter(fonts: FontFaceSet = document.fonts, timeoutMs = 3000): Promise<void> {
  const face = new FontFace(INTER_FAMILY, `url(${interUrl})`);
  const loaded = face.load().then(
    () => {
      fonts.add(face);
    },
    (error: unknown) => {
      console.warn("Inter failed to load: canvas text uses the sans-serif fallback", error);
    },
  );
  await Promise.race([loaded, new Promise<void>((done) => setTimeout(done, timeoutMs))]);
}
