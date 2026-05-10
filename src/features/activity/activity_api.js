async function parseJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  const text = await response.text();
  return text ? { message: text } : {};
}

async function request(pathname, options = {}) {
  const response = await fetch(pathname, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const detail = payload?.detail;
    const message = typeof detail === "string"
      ? detail
      : detail?.message || payload?.error || payload?.message || "Request failed.";
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function localRequest(pathname, options = {}) {
  const response = await fetch(pathname, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.message || "Local request failed.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function isAuthFailure(error) {
  return Boolean(error?.status === 401);
}

export async function fetchActivitySignals() {
  return request("/api/activity/signals");
}

export async function syncActivitySignals(items) {
  return request("/api/activity/signals/sync", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export async function reviewActivitySignal(signalId, payload) {
  return request(`/api/activity/reviews/${signalId}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchActivityReviewHistory(signalId) {
  return request(`/api/activity/review-history/${signalId}`);
}

export async function fetchActivityGitProfile() {
  const response = await request("/api/activity/git/profile");
  return response?.item || null;
}

export async function saveActivityGitProfile(payload) {
  return request("/api/activity/git/profile", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchActivityGitExports({ statusFilter } = {}) {
  const params = new URLSearchParams();
  if (statusFilter) {
    params.set("status_filter", statusFilter);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request(`/api/activity/git/exports${suffix}`);
}

export async function completeActivityGitExport(exportId, payload) {
  return request(`/api/activity/git/exports/${exportId}/complete`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function failActivityGitExport(exportId, payload) {
  return request(`/api/activity/git/exports/${exportId}/fail`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function validateActivityGitProfileLocal(payload) {
  return localRequest("/__activity/git/profile/validate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function commitActivityGitExportLocal(payload) {
  return localRequest("/__activity/git/commit", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
