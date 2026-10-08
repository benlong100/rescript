/**
 * Round-trip and rejection checks for portable project files.
 *
 * A `.rescript` file may be the only copy of someone's work, so the bar here is
 * that everything the editor restores survives a save/open cycle byte for byte,
 * and that a bad file fails with a message a person can act on rather than
 * loading half a project.
 *
 * Run: npx tsx tests/project-file-test.ts
 */

import { zipStore } from "../lib/zipStore";
import { zipFind, zipRead } from "../lib/zipRead";
import {
  projectFileName,
  readProjectFile,
  writeProjectFile,
  type ProjectFileData,
} from "../lib/projectFile";
import type { Word } from "../lib/types";

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

function word(id: number, text: string, start: number, end: number): Word {
  return { id, text, start, end, speaker: 0, deleted: false };
}

const MEDIA = new Uint8Array([0, 1, 2, 253, 254, 255, 128, 64, 0, 7]);

const project: ProjectFileData = {
  name: "Lesson one",
  mediaFileName: "lesson.wav",
  mediaType: "audio/wav",
  mediaKind: "audio",
  duration: 8.4,
  source: "base",
  transcriptLanguage: "en",
  words: [
    word(1, "Here", 0, 0.4),
    word(2, "is", 0.45, 0.6),
    { ...word(3, "um", 0.65, 0.9), deleted: true },
    { ...word(4, "sentence", 1.0, 1.6), highlighted: true },
  ],
  speakers: [{ id: 0, name: "Student" }],
  manualCuts: [{ id: 1, start: 2.0, end: 2.5 }],
  sceneBoundaries: [{ id: 1, time: 4.0 }],
  moves: [{ id: 1, srcStart: 4.0, srcEnd: 6.2, insertBeforeSrc: 0.2 }],
  showDeleted: true,
};

// --- The ZIP reader is the inverse of the writer ---
{
  const archive = zipStore([
    { path: "a.txt", data: "hello" },
    { path: "nested/dir/b.bin", data: new Uint8Array([1, 2, 3, 250]) },
    { path: "unicode-ü-名.txt", data: "ok" },
  ]);
  const files = zipRead(archive);
  assert(files.length === 3, `expected 3 entries, got ${files.length}`);

  const a = zipFind(files, "a.txt");
  assert(!!a && new TextDecoder().decode(a.data) === "hello", "text entry");

  const b = zipFind(files, "nested/dir/b.bin");
  assert(!!b && b.data.length === 4 && b.data[3] === 250, "binary entry intact");

  const u = zipFind(files, "unicode-ü-名.txt");
  assert(!!u, "UTF-8 entry name round-trips");
}

// --- An empty archive reads as empty rather than throwing ---
{
  assert(zipRead(zipStore([])).length === 0, "empty archive");
}

// --- A full project survives save and open ---
{
  const bytes = writeProjectFile(project, MEDIA, "1.2.4");
  const { data, media, savedAt } = readProjectFile(bytes);

  assert(data.name === project.name, `name: ${data.name}`);
  assert(data.mediaFileName === "lesson.wav", `media name: ${data.mediaFileName}`);
  assert(data.mediaKind === "audio", `media kind: ${data.mediaKind}`);
  assert(data.duration === 8.4, `duration: ${data.duration}`);
  assert(data.transcriptLanguage === "en", "language");
  assert(data.showDeleted === true, "showDeleted");
  assert(!!savedAt && !Number.isNaN(Date.parse(savedAt)), `savedAt: ${savedAt}`);

  assert(data.words.length === 4, `words: ${data.words.length}`);
  assert(data.words[2].deleted === true, "a deleted word stays deleted");
  assert(data.words[3].text === "sentence", "word text");
  assert(data.words[0].start === 0 && data.words[1].end === 0.6, "word timings");

  assert(
    data.words[3].highlighted === true,
    "a highlight must survive save and open"
  );
  assert(
    data.words[0].highlighted === undefined,
    "unmarked words stay unmarked"
  );

  assert(data.speakers.length === 1 && data.speakers[0].name === "Student", "speakers");
  assert(data.manualCuts.length === 1 && data.manualCuts[0].end === 2.5, "manual cuts");
  assert(data.sceneBoundaries.length === 1, "scene boundaries");

  // The reordering is the whole point of this fork — it must persist.
  assert(data.moves.length === 1, `moves: ${data.moves.length}`);
  assert(
    data.moves[0].srcStart === 4.0 &&
      data.moves[0].srcEnd === 6.2 &&
      data.moves[0].insertBeforeSrc === 0.2,
    `move not preserved: ${JSON.stringify(data.moves[0])}`
  );

  assert(media.length === MEDIA.length, `media length: ${media.length}`);
  assert(
    MEDIA.every((b, i) => media[i] === b),
    "media bytes must be identical"
  );
}

// --- A project with no reordering round-trips too ---
{
  const bytes = writeProjectFile({ ...project, moves: [] }, MEDIA);
  assert(readProjectFile(bytes).data.moves.length === 0, "empty moves");
}

// --- The media is recoverable with ordinary tools ---
{
  const bytes = writeProjectFile(project, MEDIA);
  const entry = zipRead(bytes).find((f) => f.path.startsWith("media/"));
  assert(!!entry, "a plain unzip finds the recording");
  assert(entry.path === "media/lesson.wav", `media path: ${entry.path}`);
}

// --- A media filename cannot escape the archive directory ---
{
  const bytes = writeProjectFile(
    { ...project, mediaFileName: "../../../etc/passwd" },
    MEDIA
  );
  const { data } = readProjectFile(bytes);
  assert(data.mediaFileName === "passwd", `traversal not stripped: ${data.mediaFileName}`);
  const paths = zipRead(bytes).map((f) => f.path);
  assert(
    !paths.some((p) => p.includes("..")),
    `archive contains a traversal path: ${paths.join(", ")}`
  );
}

// --- Rejections carry an actionable message ---
{
  expectThrows(
    () => readProjectFile(new Uint8Array([1, 2, 3, 4])),
    /isn't a Rescript project/,
    "not a zip"
  );

  expectThrows(
    () => readProjectFile(zipStore([{ path: "notes.txt", data: "hi" }])),
    /isn't a Rescript project/,
    "zip without a manifest"
  );

  expectThrows(
    () =>
      readProjectFile(
        zipStore([{ path: "project.json", data: "{not json" }])
      ),
    /damaged/,
    "unparseable manifest"
  );

  expectThrows(
    () =>
      readProjectFile(
        zipStore([
          {
            path: "project.json",
            data: JSON.stringify({ format: "something-else", version: 1 }),
          },
        ])
      ),
    /isn't a Rescript project/,
    "wrong format marker"
  );

  expectThrows(
    () =>
      readProjectFile(
        zipStore([
          {
            path: "project.json",
            data: JSON.stringify({
              format: "rescript-project",
              version: 99,
              words: [word(1, "a", 0, 1)],
            }),
          },
          { path: "media/x.wav", data: MEDIA },
        ])
      ),
    /newer version/,
    "future format version"
  );

  expectThrows(
    () =>
      readProjectFile(
        zipStore([
          {
            path: "project.json",
            data: JSON.stringify({
              format: "rescript-project",
              version: 1,
              words: [word(1, "a", 0, 1)],
            }),
          },
        ])
      ),
    /no audio or video/,
    "manifest without media"
  );

  expectThrows(
    () =>
      readProjectFile(
        zipStore([
          {
            path: "project.json",
            data: JSON.stringify({
              format: "rescript-project",
              version: 1,
              words: [],
            }),
          },
          { path: "media/x.wav", data: MEDIA },
        ])
      ),
    /no transcript/,
    "manifest without a transcript"
  );
}

// --- Suggested filenames are safe and readable ---
{
  assert(projectFileName("Lesson one.wav") === "Lesson one.rescript", projectFileName("Lesson one.wav"));
  assert(projectFileName("a/b:c") === "a-b-c.rescript", projectFileName("a/b:c"));
  assert(projectFileName("") === "project.rescript", projectFileName(""));
}

console.log("project file: all checks passed");
