/**
 * True in an air-gapped build (`npm run dist:offline`), where every model is
 * bundled under public/models/ and remote loading is switched off.
 *
 * Single source of truth: the worker, the model list and the language list all
 * read this, so a build either offers only what it ships or offers everything.
 */
export const OFFLINE_BUILD = process.env.NEXT_PUBLIC_OFFLINE_MODELS === "1";
