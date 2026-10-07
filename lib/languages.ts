import { OFFLINE_BUILD } from "./offline";
export type TranscriptLanguage = "en" | "es" | "fr" | "de" | "pt" | "zh";

export interface TranscriptLanguageInfo {
  label: string;
  nativeLabel: string;
  /** Flag emoji shown beside the language name in the submenu. */
  flag: string;
  /** Short uppercase code shown in the model selector trigger. */
  code: string;
}

const LANGUAGE_STORAGE_KEY = "rescript.transcript-language";

export const DEFAULT_TRANSCRIPT_LANGUAGE: TranscriptLanguage = "en";

export const TRANSCRIPT_LANGUAGES: Record<
  TranscriptLanguage,
  TranscriptLanguageInfo
> = {
  en: {
    label: "English",
    nativeLabel: "English",
    flag: "🇺🇸",
    code: "EN",
  },
  es: {
    label: "Spanish",
    nativeLabel: "Español",
    flag: "🇪🇸",
    code: "ES",
  },
  fr: {
    label: "French",
    nativeLabel: "Français",
    flag: "🇫🇷",
    code: "FR",
  },
  de: {
    label: "German",
    nativeLabel: "Deutsch",
    flag: "🇩🇪",
    code: "DE",
  },
  pt: {
    label: "Portuguese",
    nativeLabel: "Português",
    flag: "🇧🇷",
    code: "PT",
  },
  zh: {
    label: "Chinese",
    nativeLabel: "中文",
    flag: "🇨🇳",
    code: "ZH",
  },
};

export const TRANSCRIPT_LANGUAGE_ORDER: TranscriptLanguage[] = [
  "en",
  "es",
  "fr",
  "de",
  "pt",
  "zh",
];

/**
 * What the language selector may offer. Only the English CTC aligner is
 * bundled (see scripts/fetch-models.mjs); another language would still
 * transcribe, but its word boundaries would fall back to the VAD/envelope
 * heuristic — which is exactly the precision the word-level editing depends
 * on, so the option is withheld rather than silently degraded.
 */
export const SELECTABLE_TRANSCRIPT_LANGUAGES: TranscriptLanguage[] =
  OFFLINE_BUILD ? ["en"] : TRANSCRIPT_LANGUAGE_ORDER;

export function isTranscriptLanguage(
  value: unknown
): value is TranscriptLanguage {
  return (
    value === "en" ||
    value === "es" ||
    value === "fr" ||
    value === "de" ||
    value === "pt" ||
    value === "zh"
  );
}

/** Read the last-selected transcript language from localStorage. */
export function loadTranscriptLanguagePreference(): TranscriptLanguage {
  if (typeof window === "undefined") return DEFAULT_TRANSCRIPT_LANGUAGE;
  try {
    const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    // Clamped: a preference from another build must not select a language
    // whose aligner this build does not ship.
    if (
      isTranscriptLanguage(raw) &&
      SELECTABLE_TRANSCRIPT_LANGUAGES.includes(raw)
    ) {
      return raw;
    }
  } catch {
    // private mode / disabled storage
  }
  return DEFAULT_TRANSCRIPT_LANGUAGE;
}

/** Persist the selected transcript language for the next visit. */
export function saveTranscriptLanguagePreference(language: TranscriptLanguage) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // private mode / disabled storage
  }
}
