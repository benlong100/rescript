/**
 * Proves a reordered edit actually renders in the moved order, by running real
 * ffmpeg over real audio and measuring what comes out.
 *
 * Why this exists: `tests/paste-integration-test.ts` asserts the *shape* of the
 * filtergraph, which is necessary but not sufficient — it would still pass if
 * something downstream reordered, dropped or normalised the ranges. The desktop
 * export did exactly that: `parseExportRequest` rejected any non-ascending
 * range list, so a moved edit silently failed to render even though the preview
 * played it correctly.
 *
 * Method: build three one-second sine tones at distinct frequencies, move the
 * third to the front, render with the plan the app actually uses, then count
 * zero crossings per second of the decoded output. A 440 Hz tone crosses zero
 * ~880 times a second, so the frequencies are unambiguous — no transcription or
 * human listening required.
 *
 * Run: npx tsx tests/render-order-test.ts
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAudioExport, parseExportRequest } from "../lib/exportArgs";
import { applyMoves } from "../lib/segments";
import type { EditMove, TimeRange } from "../lib/types";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const FFMPEG = ["build/ffmpeg/mac-arm64/ffmpeg", "build/ffmpeg/mac-x64/ffmpeg"].find(
  (p) => existsSync(p)
);
if (!FFMPEG) {
  console.log("render order: skipped (no bundled ffmpeg — run `npm run fetch:ffmpeg`)");
  process.exit(0);
}

const TONES = [440, 880, 1320];
const SAMPLE_RATE = 16000;
const work = mkdtempSync(join(tmpdir(), "rescript-render-"));

try {
  // --- A three-second source: one second per tone, in ascending order ---
  const source = join(work, "tones.wav");
  execFileSync(
    FFMPEG,
    [
      "-hide_banner", "-loglevel", "error",
      ...TONES.flatMap((f) => ["-f", "lavfi", "-i", `sine=frequency=${f}:duration=1`]),
      "-filter_complex", `[0][1][2]concat=n=${TONES.length}:v=0:a=1[out]`,
      "-map", "[out]", "-ar", String(SAMPLE_RATE), "-ac", "1",
      "-y", source,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  // --- Move the third second to the front: expect 1320, 440, 880 ---
  const keeps: TimeRange[] = [{ start: 0, end: 3 }];
  const moves: EditMove[] = [
    { id: 1, srcStart: 2, srcEnd: 3, insertBeforeSrc: null },
  ];
  const ordered = applyMoves(keeps, moves);
  assert(
    ordered.length === 2 && Math.abs(ordered[0].start - 2) < 1e-6,
    `unexpected sequence: ${JSON.stringify(ordered)}`
  );

  // The desktop path validates the request before rendering; a reordered edit
  // must survive that gate, or the render never happens at all.
  const request = parseExportRequest({
    kind: "audio",
    keepRanges: ordered,
    editedDuration: 3,
    options: { format: "wav" },
  });
  assert(request !== null, "parseExportRequest rejected a reordered edit");
  assert(
    request.keepRanges.length === ordered.length &&
      Math.abs(request.keepRanges[0].start - ordered[0].start) < 1e-6,
    "parseExportRequest altered the sequence order"
  );

  // --- Render with the plan the app uses ---
  const plan = buildAudioExport(request.keepRanges, { format: "wav" });
  const rendered = join(work, `out.${plan.ext}`);
  execFileSync(
    FFMPEG,
    [
      "-hide_banner", "-loglevel", "error",
      "-i", source,
      "-filter_complex", plan.filter,
      ...plan.streamArgs,
      ...plan.codecArgs,
      "-y", rendered,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  // --- Decode to raw mono PCM and measure each second ---
  const raw = join(work, "out.pcm");
  execFileSync(
    FFMPEG,
    [
      "-hide_banner", "-loglevel", "error", "-i", rendered,
      "-f", "s16le", "-acodec", "pcm_s16le",
      "-ar", String(SAMPLE_RATE), "-ac", "1", "-y", raw,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  const pcm = readFileSync(raw);
  const samples = new Int16Array(
    pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)
  );
  const seconds = Math.floor(samples.length / SAMPLE_RATE);
  assert(seconds === 3, `expected 3 seconds of output, got ${seconds}`);

  /**
   * Dominant frequency of one window, from zero crossings.
   *
   * Counts sign changes on the raw signal. An amplitude gate would be wrong
   * here: a crossing passes *through* small values, so skipping those skips
   * the very samples being counted and biases every frequency low. Silence is
   * excluded by window RMS instead.
   */
  function frequencyOf(window: Int16Array): number {
    let sumSquares = 0;
    for (let i = 0; i < window.length; i++) {
      sumSquares += window[i] * window[i];
    }
    const rms = Math.sqrt(sumSquares / window.length);
    if (rms < 100) return 0;

    let crossings = 0;
    for (let i = 1; i < window.length; i++) {
      if ((window[i] < 0) !== (window[i - 1] < 0)) crossings++;
    }
    return (crossings / 2) * (SAMPLE_RATE / window.length);
  }

  const measured: number[] = [];
  for (let s = 0; s < seconds; s++) {
    // Trim the window edges: a segment boundary lands mid-cycle and would
    // otherwise register as a spurious crossing.
    const from = s * SAMPLE_RATE + 800;
    const to = (s + 1) * SAMPLE_RATE - 800;
    measured.push(frequencyOf(samples.subarray(from, to)));
  }

  const nearest = measured.map(
    (hz) => TONES.reduce((a, b) => (Math.abs(b - hz) < Math.abs(a - hz) ? b : a))
  );
  const expected = [1320, 440, 880];

  console.log(
    `  measured: ${measured.map((h) => h.toFixed(0)).join(", ")} Hz -> ${nearest.join(", ")}`
  );
  console.log(`  expected: ${expected.join(", ")}`);

  measured.forEach((hz, i) => {
    assert(
      Math.abs(hz - expected[i]) < 60,
      `second ${i} measured ${hz.toFixed(0)}Hz, expected ~${expected[i]}Hz — ` +
        `the render did not follow the move order`
    );
  });

  console.log("render order: reordered edit renders in the moved order");
} finally {
  rmSync(work, { recursive: true, force: true });
}
