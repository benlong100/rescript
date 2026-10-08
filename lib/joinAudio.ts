/**
 * Joining several recordings into one file.
 *
 * Deliberately not an ffmpeg job. Decoding happens in the renderer through
 * `AudioContext.decodeAudioData`, which already handles every format the app
 * accepts and resamples everything to one rate on the way in, so the only
 * thing left is to lay the samples end to end and write a WAV header. That
 * needs no native bridge, no ffmpeg.wasm load, and behaves identically in the
 * browser and in Electron.
 *
 * WAV because it is lossless: joining takes are the *start* of someone's work,
 * and re-encoding to a lossy format here would bake a generation of loss into
 * everything that follows.
 */

/** Decoded audio, one Float32Array per channel. */
export interface AudioChunk {
  channels: Float32Array[];
  sampleRate: number;
}

/** 16-bit PCM: what `encodeWav` writes, and what every decoder reads. */
const BYTES_PER_SAMPLE = 2;

/**
 * Lay chunks end to end.
 *
 * Mono mixed with stereo is normal when takes come from different apps, so the
 * result takes the widest channel count present and a mono chunk is duplicated
 * across channels rather than silencing one side.
 *
 * Every chunk must share a sample rate; decoding through a single AudioContext
 * guarantees that, and a mismatch is a programming error rather than something
 * to paper over by resampling here.
 */
export function joinChunks(chunks: AudioChunk[]): AudioChunk {
  const usable = chunks.filter(
    (c) => c.channels.length > 0 && c.channels[0].length > 0
  );
  if (usable.length === 0) {
    throw new Error("Nothing to join.");
  }

  const sampleRate = usable[0].sampleRate;
  for (const chunk of usable) {
    if (chunk.sampleRate !== sampleRate) {
      throw new Error(
        `Mismatched sample rates (${sampleRate} and ${chunk.sampleRate}).`
      );
    }
  }

  const channelCount = usable.reduce((n, c) => Math.max(n, c.channels.length), 1);
  const totalFrames = usable.reduce((n, c) => n + c.channels[0].length, 0);

  const out: Float32Array[] = Array.from(
    { length: channelCount },
    () => new Float32Array(totalFrames)
  );

  let offset = 0;
  for (const chunk of usable) {
    const frames = chunk.channels[0].length;
    for (let ch = 0; ch < channelCount; ch++) {
      // Fewer channels than the output: reuse the last one it does have, so
      // mono lands in both sides instead of only the left.
      const source = chunk.channels[Math.min(ch, chunk.channels.length - 1)];
      out[ch].set(source.subarray(0, frames), offset);
    }
    offset += frames;
  }

  return { channels: out, sampleRate };
}

/** Total length in seconds. */
export function chunkDuration(chunk: AudioChunk): number {
  if (chunk.channels.length === 0) return 0;
  return chunk.channels[0].length / chunk.sampleRate;
}

function writeAscii(view: DataView, at: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(at + i, text.charCodeAt(i));
  }
}

/** Clamp and scale one float sample to signed 16-bit. */
function toInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  // Asymmetric on purpose: int16 reaches -32768 but only +32767, and scaling
  // both directions by 32768 would wrap full-scale positive peaks to negative.
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

/** Encode interleaved 16-bit PCM into a complete WAV file. */
export function encodeWav(
  channels: Float32Array[],
  sampleRate: number
): Uint8Array<ArrayBuffer> {
  if (channels.length === 0 || channels[0].length === 0) {
    throw new Error("Nothing to encode.");
  }
  const channelCount = channels.length;
  const frames = channels[0].length;
  const blockAlign = channelCount * BYTES_PER_SAMPLE;
  const dataBytes = frames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);

  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let at = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let ch = 0; ch < channelCount; ch++) {
      view.setInt16(at, toInt16(channels[ch][frame]), true);
      at += BYTES_PER_SAMPLE;
    }
  }

  return new Uint8Array(buffer);
}

/** Bytes a join would produce, for warning before the work starts. */
export function wavByteLength(
  frames: number,
  channelCount: number
): number {
  return 44 + frames * channelCount * BYTES_PER_SAMPLE;
}

/** Suggested filename for a joined recording. */
export function joinedFileName(firstName: string): string {
  const base = (firstName || "recording")
    .replace(/\.[^.]+$/, "")
    .replace(/[/\\:*?"<>|]/g, "-");
  return `${base || "recording"}-joined.wav`;
}
