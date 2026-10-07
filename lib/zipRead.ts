/**
 * Minimal ZIP reader for archives written by {@link zipStore} — the other half
 * of that writer, used to open saved project files.
 *
 * Store-only (compression method 0), which is all our writer produces. An
 * archive compressed by some other tool is rejected with a clear message
 * rather than silently yielding garbage.
 */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
/** The End of Central Directory record, with no archive comment. */
const EOCD_MIN = 22;

export interface ZipFile {
  path: string;
  data: Uint8Array;
}

function u16(b: Uint8Array, at: number): number {
  return b[at] | (b[at + 1] << 8);
}

function u32(b: Uint8Array, at: number): number {
  return (
    (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
  );
}

/** Scan backwards for the End of Central Directory signature. */
function findEocd(b: Uint8Array): number {
  for (let i = b.length - EOCD_MIN; i >= 0; i--) {
    if (u32(b, i) === EOCD_SIG) return i;
  }
  return -1;
}

/** Read every entry out of a store-only ZIP archive. */
export function zipRead(bytes: Uint8Array): ZipFile[] {
  if (bytes.length < EOCD_MIN) throw new Error("Not a ZIP archive.");
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new Error("Not a ZIP archive.");

  const count = u16(bytes, eocd + 10);
  let cursor = u32(bytes, eocd + 16);
  const decoder = new TextDecoder();
  const out: ZipFile[] = [];

  for (let i = 0; i < count; i++) {
    if (cursor + 46 > bytes.length || u32(bytes, cursor) !== CENTRAL_SIG) {
      throw new Error("Damaged ZIP central directory.");
    }
    const method = u16(bytes, cursor + 10);
    const size = u32(bytes, cursor + 24);
    const nameLen = u16(bytes, cursor + 28);
    const extraLen = u16(bytes, cursor + 30);
    const commentLen = u16(bytes, cursor + 32);
    const localAt = u32(bytes, cursor + 42);
    const path = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));

    if (method !== 0) {
      throw new Error(`"${path}" is compressed; only stored entries are supported.`);
    }
    if (u32(bytes, localAt) !== LOCAL_SIG) {
      throw new Error(`Damaged ZIP entry for "${path}".`);
    }

    // The local header repeats the name and may carry different extra data.
    const localNameLen = u16(bytes, localAt + 26);
    const localExtraLen = u16(bytes, localAt + 28);
    const start = localAt + 30 + localNameLen + localExtraLen;
    if (start + size > bytes.length) {
      throw new Error(`"${path}" is truncated.`);
    }

    out.push({ path, data: bytes.subarray(start, start + size) });
    cursor += 46 + nameLen + extraLen + commentLen;
  }

  return out;
}

/** Find one entry by exact path. */
export function zipFind(files: ZipFile[], path: string): ZipFile | undefined {
  return files.find((f) => f.path === path);
}
