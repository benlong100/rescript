# Fork notes — cut & paste reordering

Downstream change on top of upstream `v1.2.4`. Branch: `paste-reorder`.

## What it does

Select words in the transcript and **Move** them (⌘⇧X, the floating toolbar
button, or Edit › Move Selection), then click the word they should go in front
of and **Place here** (⌘⇧V, the toolbar button, or Edit › Place Moved Audio
Here). The audio follows: preview playback, the rendered export, and the DAW
timeline export all reflect the new order.

**Why not ⌘X / ⌘V:** on macOS a menu item's key equivalent is consumed by the
menu before the web page sees the keystroke, and the Edit menu's `role: "cut"`
and `role: "paste"` own ⌘X and ⌘V. Dropping those roles would break ordinary
text editing in the Correct popover and speaker rename fields, so the move
commands get ⇧ variants and real menu items of their own instead. The renderer
still listens for plain ⌘X / ⌘V, which work in the browser build where there is
no native menu.

## How it works

Reordering is a **move list applied on top of** the existing keep ranges, not a
replacement for them. Each move is addressed by *source time*, never by segment
index, because keep ranges are rebuilt from `Word.deleted` + `manualCuts` on
every edit — a source range survives that rebuild, an index does not.

With no moves recorded, `applyMoves()` returns the keep ranges unchanged, so
every existing code path behaves exactly as upstream.

- `lib/segments.ts` — the whole reordering layer (pure functions, no React).
- `hooks/useOrderedRanges.ts` — keep ranges with moves applied; what export and
  playback consume. `useCutRanges()` is still correct for "is this moment cut?".
- `components/MediaPreview.tsx` — follows the sequence when reordered; keeps the
  original, well-tested cut-skipping loop when not.
- `lib/store.ts` — `moves`, `nextMoveId`, `moveClipboard`; `moveRange()`,
  `clearMoves()`, `setMoveClipboard()`, `pasteMoveBefore()`. Moves are in the
  undo snapshot and the autosave record.

Tests: `npm run test:paste`.

## Boundary snapping (don't "simplify" this)

The lifted span is **not** `[min(word.start), max(word.end)]`. ASR word-end
timestamps land slightly before the audio actually stops, so that span leaves a
sliver of the last selected word behind — which, once the material moves away,
plays as a stutter at the seam: "…sentence two. sentence one. *two.* sentence
three." The trailing edge is snapped forward to the **onset of the next word**
so every sample belonging to the selection travels with it.

The leading edge is deliberately left at the first selected word's `start`.
Snapping it back to the previous word's `end` would steal that word's trailing
audio and clip it instead — the same bug one seam to the left.
`moveSpanForWords()` in `lib/segments.ts` carries the full reasoning, and
`tests/segments-test.ts` has the regression case with the exact transcript that
exposed it.

Residual: if the first moved word's *onset* timestamp is late, its start can
clip. That is true of every cut in the app already, and the timeline's
draggable word edges are the existing fix.

## Portable project files (`.rescript`)

Rescript already autosaved to IndexedDB with a File › Recent Projects list, but
that copy is bound to one machine's browser profile: it cannot move between
computers, reach a share, be handed in, or survive the profile being cleared.
A `.rescript` file is the same state as one self-contained document.

- **Save** — toolbar Save button, or File › Save Project As… (⌘S).
- **Open** — toolbar folder button, "Open a saved project" on the home screen,
  or File › Open Project File… (⌥⌘O).

`⌘O` is now labelled **Import Media…**, which is what it always did; the old
"Open Project…" label was simply wrong and is why the feature looked missing.

### Format

A store-only ZIP, so it opens with ordinary tools. If the format ever fails
someone, `unzip` still recovers the recording — which matters when the file is
the only copy of a student's work.

```
project.json      everything the editor restores, including `moves`
media/<filename>  the original recording, byte for byte
```

`lib/zipRead.ts` is the reader half of the existing `lib/zipStore.ts` writer.
`readProjectFile()` refuses a non-project, a damaged manifest, a newer format
version, a missing recording and an empty transcript, each with a message
written for the alert the user sees. Media filenames are reduced to a basename,
so a crafted `../../` path cannot escape the archive.

Opening writes the project into IndexedDB and then defers to the existing
`openProject()`, so media loading, waveform rebuilding and status transitions
all stay on one code path — and an opened file is autosaved locally from then on.

### Verification

`npm run test:project` covers the format: round-trip of words, speakers, manual
cuts, scene boundaries, **moves** and the media bytes, plus every rejection and
the path-traversal case.

`npm run test:e2e-offline` covers the wiring in the packaged app — it
transcribes, clicks Save, confirms a real `.rescript` lands on disk with both
parts, reloads to an empty screen, hands the file to the project input, and
checks the transcript comes back.

## Export had to be unblocked in two places, not one

Wiring `applyMoves()` into the ranges the export dialog hands to ffmpeg was not
enough. On the desktop the render runs through the **native ffmpeg** path in the
main process, and `parseExportRequest()` validated that keep ranges arrived in
ascending, non-overlapping source order:

```js
if (end <= start || start < previousEnd) return null;   // removed
```

That invariant was free when keep ranges were the complement of sorted cuts.
Reordering breaks it by design, so every moved export was rejected at the
process boundary while the preview played the move correctly — a split-brain
failure that only shows up in the rendered file.

Out-of-order ranges are now explicitly valid, and overlapping ones are accepted
too, which is what a future copy/paste that *duplicates* material would need.
Per-range validation (finite, non-negative, non-empty, count capped) is what
actually keeps the filtergraph well-formed.

`tests/export-args-test.ts` previously asserted the old rule; it now asserts the
new one, including that the sequence is preserved rather than sorted.

### `npm run test:render` — the test that would have caught it

`tests/paste-integration-test.ts` checks the *shape* of the filtergraph, which
is necessary but not sufficient: it passes even if something downstream
reorders, drops or normalises the ranges, which is exactly what happened.

`tests/render-order-test.ts` renders real audio with real ffmpeg instead. It
builds three one-second sine tones at 440/880/1320 Hz, moves the third to the
front, renders through the same plan the app uses (via `parseExportRequest`, so
the gate is exercised), then counts zero crossings per second of the decoded
output:

```
measured: 1320, 440, 879 Hz -> 1320, 440, 880
```

No transcription and no listening required. When touching anything in the
export path, run this.

## Known gaps

- **The timeline canvas is still a source-time view.** Word pills and the
  waveform are drawn in original order; it does not show the moved sequence.
  The transcript and playback are the reordered views.
- **The elapsed-time readout** on the timeline uses `originalToEdited()`, which
  subtracts cuts and so is wrong once order changes. Total duration is correct.
- **Move, not duplicate.** ⌘X/⌘V relocates material; there is no copy/paste that
  makes a second copy. That needs the sequence to allow a source range to appear
  more than once.
- No drag-to-reorder in the transcript; use the toolbar buttons or the menu.
- **A selection that is contiguous on screen may not be contiguous in source
  time** once something has already been moved. A move is a single source span,
  so such a selection lifts everything between its extremes, including material
  that only looks adjacent. Moving one sentence at a time avoids this.
- New UI strings are English in all 9 locale catalogs (marked `TODO: translate`).

## Rebasing onto upstream

The risky files are `lib/store.ts` (state/history wiring, several reset sites)
and `components/MediaPreview.tsx` (playback loop). `lib/segments.ts` and the
tests are additive and should carry over cleanly.

---

# Air-gapped build (bundled models)

The stock app downloads its models from Hugging Face on first transcription, so
a machine that has never transcribed while online cannot transcribe at all.
`npm run dist:offline` produces a build with every model inside the `.app`.

## Build it

```bash
npm run fetch:models    # ~900 MB into public/models/ (needs internet, once)
npm run dist:offline    # unsigned installers into dist/
```

`public/models/` is gitignored. `fetch:models` is incremental — files already
present are skipped, so a failed run can just be re-run.

## The four models

A single English transcription touches all four. Missing any one of them
degrades or fails:

| Model | Purpose | If absent |
| --- | --- | --- |
| `onnx-community/whisper-base_timestamped` | speech recognition (default) | transcription fails |
| `onnx-community/whisper-small_timestamped` | speech recognition (noisier audio) | that option fails |
| `onnx-community/pyannote-segmentation-3.0` | speaker labels | falls back to one speaker |
| `onnx-community/silero-vad` | silence / voice activity | falls back to energy detection |
| `Xenova/wav2vec2-base-960h` | English word-boundary alignment | word timings get sloppy |

That last one is the trap: it is fetched *during* transcription, not up front,
and its absence is quiet — transcription still completes, with worse word
boundaries. Since word-accurate cuts are the entire point of the app, treat it
as required.

Switching Whisper **Small** or another UI language needs more weights:
`transcript-language` selects a different CTC aligner (see `lib/alignModels.ts`),
so add the model to `scripts/fetch-models.mjs` and re-run it.

## How it works

`scripts/fetch-models.mjs` mirrors each Hub repo into
`public/models/<hf id>/`, because transformers.js resolves a local model as
`localModelPath + <id> + <file>` — so no model id in the app has to change. The
file list is resolved from the Hub API, not hardcoded, so a renamed ONNX export
fails loudly at fetch time rather than at runtime on an offline machine.

With `NEXT_PUBLIC_OFFLINE_MODELS=1` the worker sets `allowLocalModels = true`,
`localModelPath = "/models/"`, and `allowRemoteModels = **false**`. Remote
loading is disabled rather than merely deprioritised so a missing file fails
immediately instead of hanging on a fetch that cannot succeed.

The auto-updater is also disabled in this build: there is no route to GitHub,
and a surprise update would replace the bundled models the install depends on.

## The build only offers what it ships

Remote loading is off, so an unbundled model or language would be a dead end.
`lib/offline.ts` carries the single `OFFLINE_BUILD` flag; the worker, the model
list and the language list all read it.

| | Normal build | Offline build |
| --- | --- | --- |
| Models | Base, Small, Parakeet | **Base, Small** |
| Languages | en, es, fr, de, pt, zh | **en** |

Parakeet is withheld because it is 1.3 GB and loads through parakeet.js, which
reaches for the network regardless of the transformers.js setting. Non-English
languages are withheld because only the English CTC aligner is bundled — they
would still transcribe, but word boundaries would fall back to the
VAD/envelope heuristic, and word-boundary precision is the thing the editing
depends on.

Saved preferences are clamped to the selectable set, so a `rescript.model` or
`rescript.transcript-language` value left by another build cannot resurrect an
option this one cannot load.

`npm run test:offline` fails if the selectable list and
`scripts/fetch-models.mjs` ever drift apart — the failure mode that would
otherwise surface as a dead transcription on an offline machine mid-class.

## Why `env.useBrowserCache = false` is load-bearing

Do not remove it. Without it an air-gapped build **cannot load any model**, and
the symptom is a "Downloading models" bar that never moves.

After a successful *local* read, transformers.js caches what it just read
(`storeCachedResource`, awaited inline, no try/catch). The weights are served
over Electron's `app://` scheme, and the Cache API only accepts http/https
requests, so the write throws:

```
TypeError: Failed to execute 'put' on 'Cache': Request scheme 'app' is unsupported
```

…and takes the model load down with it. Caching is pointless here regardless:
the weights are already on local disk inside the app bundle.

**This is why wifi-off testing is not a valid check.** A machine that has ever
run a build which downloaded from the Hub keeps those weights in Cache Storage,
stored under `https://` URLs — so the lookup hits, the bundled copies are never
touched, and the failing `put` is never reached. The app looks perfectly
air-gapped while being entirely dependent on a cache you cannot ship.

Use `npm run test:e2e-offline` instead. It runs the packaged app against a
**clean** Electron profile, hands it a WAV through the real file input, and
waits for rendered words. That is the condition that matters, and it is what
caught this.

`bundledLocally()` in the worker also reports bundled models as cached, so the
progress label reads "Loading speech model from cache…" rather than claiming a
download that is really a disk read.

## Expected side effects

- **The app is unsigned.** First launch on each Mac needs a right-click → Open,
  or `xattr -dr com.apple.quarantine /Applications/Rescript.app`.
- **Telemetry and crash reporting are inert** — both read build-time env vars
  that a local build does not set, so they are compiled out.
- Benign console warnings: "Unable to determine content-length from response
  headers. Will expand buffer when needed." A local read has no content-length,
  which is also why model progress is indeterminate rather than a percentage.
- The installer is roughly 400 MB larger than stock (DMG ~399 MB, installed
  app ~908 MB).

## Distributing it over the internet (signing)

`pack:offline` produces an **unsigned, ad-hoc signed** app. That is fine for
copying from a local share or USB, which is how the lab gets it: quarantine is
applied by whatever *downloads* a file, so a share copy is never marked.

Anything that downloads it — Dropbox, a browser, Mail, AirDrop — stamps
`com.apple.quarantine`, and macOS then reports **"damaged and should be moved to
the Trash"**. Nothing is damaged; Gatekeeper is refusing an ad-hoc signature
(`spctl` says "code has no resources but signature indicates they must be
present"). The recipient can clear it with:

```
xattr -dr com.apple.quarantine /Applications/Rescript.app
```

Always archive the app with `ditto`, never `zip -r` — the bundle contains 14
symlinks inside `Electron Framework.framework` and friends, and flattening them
breaks the app for real, with the same misleading error:

```
ditto -c -k --sequesterRsrc --keepParent dist/mac-arm64/Rescript.app Rescript.zip
```

### "Damaged" is usually an invalid signature, not quarantine

`pack:offline` must finish with a deep ad-hoc re-seal, and it does:

```
codesign --force --deep --sign - dist/mac-arm64/Rescript.app
```

Without it the bundle's signature is **invalid**, not merely absent:

```
code has no resources but signature indicates they must be present
```

electron-builder with `identity=null` skips signing, but the Electron binaries
arrive linker-signed; swapping in our own asar breaks that seal, leaving a
signature that claims resources it can no longer validate. macOS reports an
invalid signature as **"damaged and should be moved to the Trash"**, and that
verdict has nothing to do with quarantine — so `xattr -dr com.apple.quarantine`
does not help, which is a very confusing dead end.

After the re-seal, `codesign --verify --deep --strict` reports "valid on disk"
and "satisfies its Designated Requirement", and `codesign -dv` shows
`Sealed Resources version=2 rules=13 files=15`. A quarantined copy is then
merely `rejected` by policy — the ordinary "Apple cannot check it for malicious
software" dialog, which the recipient can get past via System Settings →
Privacy & Security → Open Anyway.

**Testing caveat, learned twice now:** a machine that has already launched the
app has accepted it, so adding a quarantine attribute by hand does not
reproduce a recipient's first-launch verdict. Check `codesign --verify` and
`spctl -a -vv` for the objective state instead of trusting a local launch.

### Deploying to the lab

Put the **ditto zip** on the share and expand it on each machine, rather than
copying the `.app` bundle directly. An SMB/AFP round trip can mangle the 14
framework symlinks depending on the server, and the resulting breakage reports
itself as "damaged" — indistinguishable from the signature problem above.
Double-clicking the zip in Finder (Archive Utility) preserves them.

```
ditto -c -k --sequesterRsrc --keepParent dist/mac-arm64/Rescript.app Rescript-lab.zip
```

Quarantine is applied by whatever *downloads* a file, so a copy off the share
is never marked and Gatekeeper is never consulted. No Terminal command is
needed on the student machines.

Verify on the first machine before doing the rest:

```
codesign --verify --deep --strict /Applications/Rescript.app   # silent = good
find /Applications/Rescript.app -type l | wc -l                # must be 14
```

### The real fix: `npm run dist:signed`

The build is already configured for it — `hardenedRuntime`, `notarize: true`,
and entitlements covering JIT, unsigned executable memory, library validation
and `device.audio-input`. It needs two things this machine does not have yet:

1. A **Developer ID Application** certificate. An "Apple Development"
   certificate is not enough: it cannot be notarized and will not pass
   Gatekeeper on anyone else's Mac. Create it at developer.apple.com →
   Certificates → `+` → Developer ID Application (Account Holder only), then
   install the downloaded `.cer`. Verify with
   `security find-identity -v -p codesigning`.
2. Notarization credentials in the environment, either
   `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` (App Store Connect
   API key), or `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`.

Note the cost: notarization uploads the **whole 1.4 GB app** to Apple on every
build and waits for a verdict, so a signed build is much slower than
`pack:offline`. Keep the unsigned path for iterating.

## Where the app keeps per-user state

`~/Library/Application Support/rescript/` — **lowercase**, from package.json
`name`, not the `Rescript` productName. Preferences (model choice, language,
appearance, telemetry opt-out) live in the Chromium `Local Storage` LevelDB
under it, which is why seeding them means copying that directory from a
configured machine rather than writing keys with a script.
