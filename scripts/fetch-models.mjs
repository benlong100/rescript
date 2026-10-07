/**
 * Download the speech models into public/models/ for an air-gapped build.
 *
 * transformers.js resolves a local model as `localModelPath + <hf id> + <file>`,
 * so the directory layout here mirrors the Hugging Face repo paths exactly and
 * no model id anywhere in the app has to change.
 *
 * The file list is resolved from the Hub API rather than hardcoded, so a
 * renamed ONNX export fails loudly here instead of at runtime on a machine
 * with no network.
 *
 * Run: npm run fetch:models
 */

import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const OUT_ROOT = join(process.cwd(), "public", "models");

/**
 * Every model a transcription touches. Sources, so this stays checkable:
 * - Whisper + dtypes ...... lib/models.ts (MODELS.base, WHISPER_DTYPE)
 * - Diarization ........... workers/transcription.worker.ts (DIARIZATION_MODEL)
 * - Voice activity ........ workers/transcription.worker.ts (VAD_MODEL)
 * - Forced aligner ........ lib/alignModels.ts (ALIGN_MODELS.en)
 *
 * `onnx` lists the exact weight files needed. transformers.js maps dtype to a
 * filename suffix: fp32 is unsuffixed, everything else is `_<dtype>`.
 */
const MODELS = [
  {
    id: "onnx-community/whisper-base_timestamped",
    why: "speech recognition (Whisper Base)",
    // WHISPER_DTYPE: fp32 encoder, q4 merged decoder, on both webgpu and wasm.
    onnx: ["encoder_model.onnx", "decoder_model_merged_q4.onnx"],
  },
  {
    id: "onnx-community/whisper-small_timestamped",
    why: "speech recognition (Whisper Small — noisier / longer audio)",
    // Same WHISPER_DTYPE pair as Base.
    onnx: ["encoder_model.onnx", "decoder_model_merged_q4.onnx"],
  },
  {
    id: "onnx-community/pyannote-segmentation-3.0",
    why: "speaker diarization",
    onnx: ["model.onnx"], // loaded dtype: fp32
  },
  {
    id: "onnx-community/silero-vad",
    why: "silence / voice-activity detection",
    onnx: ["model.onnx"], // loaded dtype: fp32
  },
  {
    id: "Xenova/wav2vec2-base-960h",
    why: "English word-boundary alignment (CTC)",
    onnx: ["model_q4.onnx"], // alignerModel() pins q4
  },
];

/** Small sidecar files (configs, tokenizers, vocabularies) worth taking whole. */
const SIDECAR = /\.(json|txt|model)$/i;
/** Never pull training weights — these repos also ship torch / safetensors. */
const WEIGHTS = /\.(bin|safetensors|pt|pth|h5|ckpt|msgpack)$/i;

function human(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function listRepo(id) {
  const res = await fetch(`https://huggingface.co/api/models/${id}`);
  if (!res.ok) {
    throw new Error(`Hub listing failed for ${id}: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return (data.siblings ?? []).map((s) => s.rfilename);
}

async function download(id, rfilename, dest) {
  const url = `https://huggingface.co/${id}/resolve/main/${rfilename}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${id}/${rfilename}: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return buf.byteLength;
}

async function alreadyHave(dest) {
  try {
    const s = await stat(dest);
    return s.isFile() && s.size > 0 ? s.size : 0;
  } catch {
    return 0;
  }
}

let grandTotal = 0;
let failures = 0;

for (const model of MODELS) {
  console.log(`\n${model.id}  —  ${model.why}`);
  let files;
  try {
    files = await listRepo(model.id);
  } catch (err) {
    console.error(`  ! ${err.message}`);
    failures++;
    continue;
  }

  const wanted = new Set();

  // Sidecars at any depth, but never the training weights.
  for (const f of files) {
    if (SIDECAR.test(f) && !WEIGHTS.test(f)) wanted.add(f);
  }

  // The specific ONNX exports, verified to exist in the repo.
  for (const basename of model.onnx) {
    const match = files.find((f) => f === `onnx/${basename}` || f === basename);
    if (!match) {
      console.error(
        `  ! ${basename} is not in this repo. Available ONNX files:\n` +
          files.filter((f) => f.endsWith(".onnx")).map((f) => `      ${f}`).join("\n")
      );
      failures++;
      continue;
    }
    wanted.add(match);
  }

  let modelTotal = 0;
  for (const f of [...wanted].sort()) {
    const dest = join(OUT_ROOT, model.id, f);
    const have = await alreadyHave(dest);
    if (have) {
      modelTotal += have;
      console.log(`  = ${f}  (${human(have)}, already present)`);
      continue;
    }
    try {
      const size = await download(model.id, f, dest);
      modelTotal += size;
      console.log(`  + ${f}  (${human(size)})`);
    } catch (err) {
      console.error(`  ! ${err.message}`);
      failures++;
    }
  }
  grandTotal += modelTotal;
  console.log(`  ${human(modelTotal)} total`);
}

console.log(`\n${human(grandTotal)} in public/models/`);
if (failures > 0) {
  console.error(`\n${failures} file(s) failed — the offline build is NOT complete.`);
  process.exit(1);
}
console.log("All models present. Build with: npm run dist:offline");
