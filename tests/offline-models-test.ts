/**
 * Guard against the bundle drifting from the UI.
 *
 * An air-gapped build can only load what scripts/fetch-models.mjs downloads.
 * If someone adds a model to the selectable list without adding it to the
 * fetch script (or vice versa), students get a transcription that dies several
 * seconds in — on a machine with no network, in front of a class. Cheaper to
 * fail here.
 *
 * Run: npx tsx tests/offline-models-test.ts
 */

import { readFileSync } from "node:fs";
import { MODELS, MODEL_ORDER } from "../lib/models";
import { ALIGN_MODELS } from "../lib/alignModels";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const script = readFileSync("scripts/fetch-models.mjs", "utf8");
const fetched = new Set(
  [...script.matchAll(/^\s*id:\s*"([^"]+)"/gm)].map((m) => m[1])
);

assert(fetched.size > 0, "no model ids found in scripts/fetch-models.mjs");

// The offline build's selectable models, mirrored from lib/models.ts. Read via
// the env var so this test does not depend on how it was invoked.
const BUNDLED: Array<keyof typeof MODELS> = ["base", "small"];

for (const key of BUNDLED) {
  const info = MODELS[key];
  assert(
    fetched.has(info.id),
    `${String(key)} (${info.id}) is offered offline but not fetched by scripts/fetch-models.mjs`
  );
}

// Everything a transcription touches beyond the ASR model.
for (const id of [
  "onnx-community/pyannote-segmentation-3.0", // diarization
  "onnx-community/silero-vad", // silence detection
  ALIGN_MODELS.en!.id, // English word-boundary alignment
]) {
  assert(fetched.has(id), `${id} is required at runtime but never fetched`);
}

// Anything fetched should correspond to something real, so a typo in an id
// cannot sit there quietly downloading nothing useful.
const known = new Set<string>([
  ...MODEL_ORDER.map((id) => MODELS[id].id),
  "onnx-community/pyannote-segmentation-3.0",
  "onnx-community/silero-vad",
  ...Object.values(ALIGN_MODELS).map((m) => m!.id),
]);
for (const id of fetched) {
  assert(known.has(id), `scripts/fetch-models.mjs fetches "${id}", which nothing uses`);
}

console.log("offline models: bundle and UI agree");
