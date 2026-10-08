/**
 * Checks for the join tool: sample order, channel handling, and a WAV header
 * a decoder will actually accept.
 *
 * The header is worth testing properly — a wrong byte rate or data size
 * produces a file that plays at the wrong speed or truncates, and the symptom
 * would show up much later as "my joined recording is broken".
 *
 * Run: npx tsx tests/join-audio-test.ts
 */

import {
  chunkDuration,
  encodeWav,
  joinChunks,
  joinedFileName,
  wavByteLength,
  type AudioChunk,
} from "../lib/joinAudio";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function expectThrows(fn: () => unknown, match: RegExp, label: string) {
  try {
    fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    assert(match.test(message), `${label}: unexpected message "${message}"`);
    return;
  }
  throw new Error(`${label}: expected a throw`);
}

/** A chunk whose every sample is `value`, so order is easy to verify. */
function flat(value: number, frames: number, channels = 1, rate = 48000): AudioChunk {
  return {
    channels: Array.from({ length: channels }, () => new Float32Array(frames).fill(value)),
    sampleRate: rate,
  };
}

// --- Chunks land end to end, in the order given ---
{
  const joined = joinChunks([flat(0.1, 3), flat(0.2, 2), flat(0.3, 4)]);
  assert(joined.channels.length === 1, "mono in, mono out");
  assert(joined.channels[0].length === 9, `frames: ${joined.channels[0].length}`);
  const shape = Array.from(joined.channels[0]).map((v) => v.toFixed(1)).join("");
  assert(shape === "0.10.10.10.20.20.30.30.30.3", `order: ${shape}`);
  assert(joined.sampleRate === 48000, "sample rate carried through");
}

// --- Reordering the inputs reorders the output ---
{
  const a = flat(0.1, 2);
  const b = flat(0.9, 2);
  const forward = Array.from(joinChunks([a, b]).channels[0]);
  const reversed = Array.from(joinChunks([b, a]).channels[0]);
  assert(forward[0] === reversed[3] && forward[3] === reversed[0], "order matters");
}

// --- Mono mixed with stereo widens to stereo, duplicating the mono side ---
{
  const joined = joinChunks([flat(0.5, 2, 1), flat(0.25, 2, 2)]);
  assert(joined.channels.length === 2, `channels: ${joined.channels.length}`);
  // The mono chunk must appear in BOTH channels, not just the left.
  assert(joined.channels[0][0] === 0.5, "mono reached the left channel");
  assert(joined.channels[1][0] === 0.5, "mono reached the right channel too");
  assert(joined.channels[1][2] === 0.25, "the stereo chunk follows it");
}

// --- Empty and mismatched inputs fail loudly ---
{
  expectThrows(() => joinChunks([]), /Nothing to join/, "no chunks");
  expectThrows(
    () => joinChunks([{ channels: [], sampleRate: 48000 }]),
    /Nothing to join/,
    "empty channels"
  );
  expectThrows(
    () => joinChunks([flat(0.1, 2, 1, 48000), flat(0.1, 2, 1, 44100)]),
    /Mismatched sample rates/,
    "rate mismatch"
  );
}

// --- Silent chunks are skipped rather than counted as content ---
{
  const joined = joinChunks([
    flat(0.1, 2),
    { channels: [new Float32Array(0)], sampleRate: 48000 },
    flat(0.2, 2),
  ]);
  assert(joined.channels[0].length === 4, `frames: ${joined.channels[0].length}`);
}

// --- Duration ---
{
  assert(chunkDuration(flat(0, 48000)) === 1, "one second");
  assert(chunkDuration({ channels: [], sampleRate: 48000 }) === 0, "empty");
}

// --- The WAV header describes the data that follows it ---
{
  const frames = 5;
  const wav = encodeWav([new Float32Array(frames).fill(0.5)], 16000);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (at: number, n: number) =>
    String.fromCharCode(...Array.from(wav.subarray(at, at + n)));

  assert(ascii(0, 4) === "RIFF", "RIFF marker");
  assert(ascii(8, 4) === "WAVE", "WAVE marker");
  assert(ascii(12, 4) === "fmt ", "fmt chunk");
  assert(ascii(36, 4) === "data", "data chunk");

  assert(view.getUint16(20, true) === 1, "PCM format");
  assert(view.getUint16(22, true) === 1, "channel count");
  assert(view.getUint32(24, true) === 16000, "sample rate");
  assert(view.getUint32(28, true) === 16000 * 2, "byte rate = rate * blockAlign");
  assert(view.getUint16(32, true) === 2, "block align");
  assert(view.getUint16(34, true) === 16, "bit depth");

  const dataBytes = frames * 2;
  assert(view.getUint32(40, true) === dataBytes, "data size");
  assert(view.getUint32(4, true) === 36 + dataBytes, "RIFF size");
  assert(wav.length === 44 + dataBytes, `file length: ${wav.length}`);
  assert(wav.length === wavByteLength(frames, 1), "wavByteLength agrees");
}

// --- Stereo is interleaved left/right, frame by frame ---
{
  const left = new Float32Array([1, 1]);
  const right = new Float32Array([-1, -1]);
  const wav = encodeWav([left, right], 8000);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert(view.getUint16(22, true) === 2, "two channels");
  assert(view.getUint16(32, true) === 4, "block align for stereo");
  assert(view.getInt16(44, true) === 32767, "frame 0 left at full scale");
  assert(view.getInt16(46, true) === -32768, "frame 0 right at full scale");
  assert(view.getInt16(48, true) === 32767, "frame 1 left");
}

// --- Peaks clamp instead of wrapping ---
{
  const wav = encodeWav([new Float32Array([2, -2, 0])], 8000);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert(view.getInt16(44, true) === 32767, "positive peak clamps");
  assert(view.getInt16(46, true) === -32768, "negative peak clamps");
  assert(view.getInt16(48, true) === 0, "silence stays silent");
}

// --- Encoding nothing is an error, not a zero-byte file ---
{
  expectThrows(() => encodeWav([], 48000), /Nothing to encode/, "no channels");
  expectThrows(
    () => encodeWav([new Float32Array(0)], 48000),
    /Nothing to encode/,
    "no frames"
  );
}

// --- Suggested filenames ---
{
  assert(joinedFileName("take1.wav") === "take1-joined.wav", joinedFileName("take1.wav"));
  assert(joinedFileName("a/b:c.m4a") === "a-b-c-joined.wav", joinedFileName("a/b:c.m4a"));
  assert(joinedFileName("") === "recording-joined.wav", joinedFileName(""));
}

console.log("join audio: all checks passed");
