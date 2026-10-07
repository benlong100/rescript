/**
 * Portable project files (`.rescript`).
 *
 * The editor already autosaves into IndexedDB, but that copy is bound to one
 * machine's browser profile: it cannot be moved between computers, backed up to
 * a share, handed in, or survive the profile being cleared. A project file is
 * the same state as a single self-contained document on disk.
 *
 * The container is a store-only ZIP so it can be opened with ordinary tools. If
 * anything ever goes wrong with the format, the original recording is still
 * recoverable by unzipping it, which matters when the file is the only copy of
 * someone's work.
 *
 *   project.json      every field the editor restores
 *   media/<filename>  the original recording, byte for byte
 */

import { zipStore } from "./zipStore";
import { zipFind, zipRead } from "./zipRead";
import type { MediaKind } from "./media";
import type {
  EditMove,
  ManualCut,
  SceneBoundary,
  SpeakerInfo,
  Word,
} from "./types";

export const PROJECT_FILE_EXTENSION = ".rescript";
const MANIFEST_PATH = "project.json";
const MEDIA_PREFIX = "media/";
const FORMAT = "rescript-project";
/** Bump only for a breaking change; `readProjectFile` refuses what it cannot read. */
const FORMAT_VERSION = 1;

/** Everything needed to restore an editing session. */
export interface ProjectFileData {
  name: string;
  mediaFileName: string;
  mediaType: string;
  mediaKind: MediaKind;
  duration: number;
  source: string;
  transcriptLanguage: string;
  words: Word[];
  speakers: SpeakerInfo[];
  manualCuts: ManualCut[];
  sceneBoundaries: SceneBoundary[];
  moves: EditMove[];
  showDeleted: boolean;
}

interface Manifest extends ProjectFileData {
  format: string;
  version: number;
  savedAt: string;
  app: string;
}

/** Strip anything that could escape the media directory on the way back out. */
function safeMediaName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f]/g, "").trim();
  return cleaned.length > 0 ? cleaned : "media";
}

/** Serialize a project plus its media into one `.rescript` archive. */
export function writeProjectFile(
  data: ProjectFileData,
  media: Uint8Array,
  appVersion = ""
): Uint8Array<ArrayBuffer> {
  const mediaFileName = safeMediaName(data.mediaFileName);
  const manifest: Manifest = {
    ...data,
    mediaFileName,
    format: FORMAT,
    version: FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    app: appVersion,
  };
  return zipStore([
    { path: MANIFEST_PATH, data: JSON.stringify(manifest, null, 2) },
    { path: `${MEDIA_PREFIX}${mediaFileName}`, data: media },
  ]);
}

export interface ReadProjectFile {
  data: ProjectFileData;
  /**
   * Backed by its own ArrayBuffer (never the archive's), so it can go straight
   * into a Blob and the parsed archive can be released.
   */
  media: Uint8Array<ArrayBuffer>;
  savedAt: string | null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Parse a `.rescript` archive. Throws with a message fit for an alert when the
 * file is not one, is from a newer format, or has lost its media.
 */
export function readProjectFile(bytes: Uint8Array): ReadProjectFile {
  let files;
  try {
    files = zipRead(bytes);
  } catch {
    throw new Error("That file isn't a Rescript project.");
  }

  const manifestEntry = zipFind(files, MANIFEST_PATH);
  if (!manifestEntry) throw new Error("That file isn't a Rescript project.");

  let manifest: Partial<Manifest>;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
  } catch {
    throw new Error("This project file is damaged.");
  }

  if (manifest.format !== FORMAT) {
    throw new Error("That file isn't a Rescript project.");
  }
  if (typeof manifest.version !== "number" || manifest.version > FORMAT_VERSION) {
    throw new Error(
      "This project was saved by a newer version of Rescript. Update the app to open it."
    );
  }

  const mediaEntry = files.find((f) => f.path.startsWith(MEDIA_PREFIX));
  if (!mediaEntry || mediaEntry.data.length === 0) {
    throw new Error("This project file has no audio or video in it.");
  }

  const mediaFileName = safeMediaName(
    manifest.mediaFileName ?? mediaEntry.path.slice(MEDIA_PREFIX.length)
  );
  const words = asArray<Word>(manifest.words);
  if (words.length === 0) {
    throw new Error("This project file has no transcript in it.");
  }

  return {
    data: {
      name:
        typeof manifest.name === "string" && manifest.name
          ? manifest.name
          : mediaFileName,
      mediaFileName,
      mediaType: typeof manifest.mediaType === "string" ? manifest.mediaType : "",
      mediaKind: (manifest.mediaKind === "audio" ? "audio" : "video") as MediaKind,
      duration: typeof manifest.duration === "number" ? manifest.duration : 0,
      source: typeof manifest.source === "string" ? manifest.source : "base",
      transcriptLanguage:
        typeof manifest.transcriptLanguage === "string"
          ? manifest.transcriptLanguage
          : "en",
      words,
      speakers: asArray<SpeakerInfo>(manifest.speakers),
      manualCuts: asArray<ManualCut>(manifest.manualCuts),
      sceneBoundaries: asArray<SceneBoundary>(manifest.sceneBoundaries),
      moves: asArray<EditMove>(manifest.moves),
      showDeleted: manifest.showDeleted !== false,
    },
    // Copy out of the archive buffer so the whole file can be released.
    media: new Uint8Array(mediaEntry.data),
    savedAt: typeof manifest.savedAt === "string" ? manifest.savedAt : null,
  };
}

/** Suggested filename for a project. */
export function projectFileName(name: string): string {
  const base = (name || "project")
    .replace(/\.[^.]+$/, "")
    .replace(/[/\\:*?"<>|]/g, "-");
  return `${base || "project"}${PROJECT_FILE_EXTENSION}`;
}
