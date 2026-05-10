const STORAGE_KEY = "sacred-timeline-institute-prompt-v1";
const EVENT_NAME = "sacred-timeline:institute-prompt";

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function createInstitutePromptPayload({ query, mode = "research", sourcePathname = "/" }) {
  return {
    id: `institute-${Date.now()}`,
    query: String(query || "").trim(),
    mode,
    sourcePathname,
    submittedAt: new Date().toISOString(),
  };
}

export function publishInstitutePrompt(input) {
  if (typeof window === "undefined") return null;
  const payload = createInstitutePromptPayload(input);
  if (!payload.query) return null;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
  return payload;
}

export function consumePendingInstitutePrompt() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  window.localStorage.removeItem(STORAGE_KEY);
  return safeJsonParse(raw);
}

export function subscribeInstitutePrompt(listener) {
  if (typeof window === "undefined") return () => {};
  function handleEvent(event) {
    listener?.(event.detail || null);
  }
  window.addEventListener(EVENT_NAME, handleEvent);
  return () => window.removeEventListener(EVENT_NAME, handleEvent);
}
