export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class GitHubError extends Error {
  constructor(status, message, { requestId = null, retryDelayMs = null } = {}) {
    super(message);
    this.status = status;
    this.requestId = requestId;
    this.retryDelayMs = retryDelayMs;
  }
}
