export class ApiError extends Error {
  constructor(message, { status, requestId = null, retryAfter = null } = {}) {
    super(message);
    this.status = status;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

export async function responseJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (response.ok) return payload;

  const requestId = payload.requestId || response.headers.get("x-request-id");
  const retryAfter = response.headers.get("retry-after");
  const retrySeconds = Number.parseInt(retryAfter ?? "", 10);
  const message = response.status === 401
    ? "Your GitHub session expired. Sign out, then reconnect GitHub."
    : response.status === 429
      ? Number.isInteger(retrySeconds)
        ? `GitHub is rate-limiting requests. Try again in ${retrySeconds} seconds.`
        : "Too many ChangePlane requests. Wait about a minute, then try again."
      : payload.error || "GitHub request failed.";

  throw new ApiError(`${message}${requestId ? ` Reference ${requestId}.` : ""}`, {
    status: response.status,
    requestId,
    retryAfter,
  });
}
