/** Emoji picker data and caret-aware insertion (pure). Curated set: no external picker dependency. */

export const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: 'Smileys', emojis: ['😀', '😃', '😄', '😁', '😊', '🙂', '😉', '😍', '🤩', '😎', '🤔', '😅', '😂', '🙃', '😌', '😴', '😢', '😮', '😬', '🙏'] },
  { label: 'Gestures', emojis: ['👍', '👎', '👌', '👏', '🙌', '🤝', '✌️', '👋', '💪', '☝️', '👉', '🫡'] },
  { label: 'Business', emojis: ['✅', '❌', '⚠️', '📦', '🚚', '✈️', '🚢', '📄', '📊', '💰', '💵', '🧾', '📅', '⏰', '📍', '🔒', '📞', '📧'] },
  { label: 'Symbols', emojis: ['❤️', '🔥', '⭐', '🎉', '💯', '❓', '❗', '➡️', '🆗', '🆕'] },
];

/** Insert `insert` over the selection [start, end); returns the new text and where to put the caret. */
export function insertAtCursor(text: string, start: number | null | undefined, end: number | null | undefined, insert: string) {
  const s = Math.min(Math.max(0, start ?? text.length), text.length);
  const e = Math.min(Math.max(s, end ?? s), text.length);
  return { text: text.slice(0, s) + insert + text.slice(e), caret: s + insert.length };
}
