"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import {
  encodeWav,
  joinChunks,
  joinedFileName,
  type AudioChunk,
} from "@/lib/joinAudio";
import { useI18n } from "./I18nProvider";

/**
 * Joins several recordings into one WAV, end to end, in the listed order.
 *
 * Decoding goes through an OfflineAudioContext rather than ffmpeg: it reads
 * every format the app already accepts, resamples everything to one rate on the
 * way in, and needs no native bridge or wasm core. One fixed rate also means
 * the result does not depend on the machine's audio hardware.
 */

/** Everything is resampled to this on decode, so joins are deterministic. */
const JOIN_SAMPLE_RATE = 48000;

/**
 * Rendered only while open, so closing unmounts it and the file list resets on
 * its own — no state to clear, and nothing to synchronise in an effect.
 */
export default function JoinAudioDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const addFiles = useCallback((picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    setError(null);
    setStatus(null);
    // Sorted by name so take1/take2/take3 arrive in a sensible order; the
    // numeric collator keeps take10 after take9 instead of after take1.
    const sorted = Array.from(picked).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );
    setFiles((prev) => [...prev, ...sorted]);
  }, []);

  const move = useCallback((from: number, to: number) => {
    setFiles((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }, []);

  const remove = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const run = useCallback(async () => {
    if (files.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);

    // OfflineAudioContext decodes without opening an output device, so this
    // never trips an autoplay policy.
    const ctx = new OfflineAudioContext({
      numberOfChannels: 1,
      length: 1,
      sampleRate: JOIN_SAMPLE_RATE,
    });

    try {
      const chunks: AudioChunk[] = [];
      for (const file of files) {
        setStatus(t("join.reading", { name: file.name }));
        // Yield so the status actually paints before a long decode.
        await new Promise((r) => setTimeout(r, 0));
        const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
        chunks.push({
          channels: Array.from({ length: buffer.numberOfChannels }, (_, ch) =>
            buffer.getChannelData(ch)
          ),
          sampleRate: buffer.sampleRate,
        });
      }

      setStatus(t("join.encoding"));
      await new Promise((r) => setTimeout(r, 0));
      const joined = joinChunks(chunks);
      const wav = encodeWav(joined.channels, joined.sampleRate);
      const name = joinedFileName(files[0]?.name ?? "");

      const url = URL.createObjectURL(
        new Blob([wav], { type: "audio/wav" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);

      setStatus(t("join.saved", { name }));
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error && /Mismatched|Nothing/.test(err.message)
          ? err.message
          : t("error.joinFailed")
      );
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [files, busy, t]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={t("join.title")}
        className="flex max-h-[80vh] w-full max-w-md flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("join.title")}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {t("join.description")}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            title={t("common.close")}
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X size={15} />
          </button>
        </div>

        {files.length > 0 && (
          <ol className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-zinc-100 dark:border-zinc-800">
            {files.map((file, i) => (
              <li
                key={`${file.name}-${i}`}
                className="flex items-center gap-1 border-b border-zinc-100 px-2 py-1.5 last:border-b-0 dark:border-zinc-800"
              >
                <span className="w-5 shrink-0 text-center text-[11px] tabular-nums text-zinc-400">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-700 dark:text-zinc-200">
                  {file.name}
                </span>
                <button
                  onClick={() => move(i, i - 1)}
                  disabled={busy || i === 0}
                  title={t("join.moveUp")}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-25 dark:hover:bg-zinc-800"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  onClick={() => move(i, i + 1)}
                  disabled={busy || i === files.length - 1}
                  title={t("join.moveDown")}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-25 dark:hover:bg-zinc-800"
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  onClick={() => remove(i)}
                  disabled={busy}
                  title={t("join.removeFile")}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-25 dark:hover:bg-red-950/40"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ol>
        )}

        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Plus size={14} />
          {t("join.addFiles")}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          multiple
          className="sr-only"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        {!error && status && (
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {status}
          </p>
        )}
        {!error && !status && files.length < 2 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            {t("join.needTwo")}
          </p>
        )}

        <button
          onClick={() => void run()}
          disabled={busy || files.length < 2}
          className="flex h-10 cursor-pointer items-center justify-center rounded-xl bg-zinc-900 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {busy ? t("join.joining") : t("join.run")}
        </button>
        <p className="text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
          {t("join.sizeNote")}
        </p>
      </div>
    </div>
  );
}
