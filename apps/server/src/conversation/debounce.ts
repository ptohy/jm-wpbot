export const DEBOUNCE_MS = 4000;
export function debounceKey(conversationId: string) { return `conversation:${conversationId}`; }
export function debounceDueAt(now = new Date()) { return new Date(now.getTime() + DEBOUNCE_MS); }
