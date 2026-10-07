/**
 * End-to-end check of the reordering path: words -> cuts -> keep ranges ->
 * moves -> the ffmpeg filter graph that actually renders the file.
 *
 * This is the test that would have caught "the UI reorders but the export
 * doesn't", which is the whole point of the feature.
 *
 * Run: npx tsx tests/paste-integration-test.ts
 */

import { getCutRanges, getKeepRanges } from "../lib/edits";
import { applyMoves, orderWordsForDisplay } from "../lib/segments";
import { buildAudioExport } from "../lib/exportArgs";
import { serializeReaperRpp } from "../lib/serializeTimeline";
import type { EditMove, Word } from "../lib/types";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function word(
  id: number,
  text: string,
  start: number,
  end: number,
  deleted = false
): Word {
  return { id, text, start, end, speaker: 0, deleted };
}

// A sentence of four phrases, one second each, with a filler word deleted.
const DURATION = 4;
const words: Word[] = [
  word(1, "alpha", 0.0, 0.9),
  word(2, "bravo", 1.0, 1.9),
  word(3, "um", 2.0, 2.4, true), // deleted
  word(4, "charlie", 2.5, 2.9),
  word(5, "delta", 3.0, 3.9),
];

const cuts = getCutRanges(words, DURATION, []);
const keeps = getKeepRanges(cuts, DURATION);

// --- Baseline: no moves renders in source order ---
{
  const ordered = applyMoves(keeps, []);
  const plan = buildAudioExport(ordered, { format: "wav" });
  const starts = [...plan.filter.matchAll(/atrim=start=([0-9.]+)/g)].map((m) =>
    Number(m[1])
  );
  assert(
    starts.every((v, i) => i === 0 || v >= starts[i - 1]),
    `baseline should be ascending: ${starts.join(",")}`
  );
}

// --- Move "delta" (3.0-3.9) to the very front ---
const moves: EditMove[] = [
  { id: 1, srcStart: 3.0, srcEnd: 4.0, insertBeforeSrc: null },
];
const ordered = applyMoves(keeps, moves);

// --- The filter graph concatenates in moved order, not time order ---
{
  const plan = buildAudioExport(ordered, { format: "wav" });
  const starts = [...plan.filter.matchAll(/atrim=start=([0-9.]+)/g)].map((m) =>
    Number(m[1])
  );
  assert(starts.length > 1, `expected several segments, got ${starts.length}`);
  assert(
    Math.abs(starts[0] - 3.0) < 1e-3,
    `moved material must render first, got ${starts[0]}`
  );
  assert(
    starts.some((v, i) => i > 0 && v < starts[i - 1]),
    `graph should not be in ascending source order: ${starts.join(",")}`
  );
  // concat must be told about every segment, or ffmpeg drops material.
  const n = /concat=n=(\d+)/.exec(plan.filter);
  assert(
    !!n && Number(n[1]) === starts.length,
    `concat count ${n?.[1]} != segments ${starts.length}`
  );
}

// --- The deleted filler never comes back ---
{
  const plan = buildAudioExport(ordered, { format: "wav" });
  const spans = [
    ...plan.filter.matchAll(/atrim=start=([0-9.]+):end=([0-9.]+)/g),
  ].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
  const coversFiller = spans.some((s) => s.start < 2.4 && s.end > 2.0);
  assert(!coversFiller, "the deleted word must stay out of the render");
}

// --- The transcript reads in the new order ---
{
  const shown = orderWordsForDisplay(words, ordered)
    .filter((w) => !w.deleted)
    .map((w) => w.text)
    .join(" ");
  assert(
    shown === "delta alpha bravo charlie",
    `transcript should lead with the moved phrase: ${shown}`
  );
}

// --- The Reaper timeline export follows the same order ---
{
  const rpp = serializeReaperRpp({
    keepRanges: ordered,
    duration: DURATION,
    mediaFileName: "lesson.wav",
    projectName: "lesson",
    frameRate: "30",
    withVideo: false,
    withAudio: true,
  });
  const offsets = [...rpp.matchAll(/SOFFS ([0-9.]+)/g)].map((m) => Number(m[1]));
  assert(
    Math.abs(offsets[0] - 3.0) < 1e-3,
    `first Reaper item should be the moved audio, got ${offsets[0]}`
  );
  // Items are laid end to end on the timeline regardless of source order.
  const positions = [...rpp.matchAll(/POSITION ([0-9.]+)/g)].map((m) =>
    Number(m[1])
  );
  assert(
    positions.every((v, i) => i === 0 || v > positions[i - 1]),
    `Reaper positions must advance: ${positions.join(",")}`
  );
}

console.log("paste integration: all checks passed");
