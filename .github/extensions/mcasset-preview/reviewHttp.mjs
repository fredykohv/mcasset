export class ReviewHttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function readReviewRequest(req, serverUrl) {
  const origin = new URL(serverUrl).origin;
  if (req.headers.origin !== origin || req.headers.host !== new URL(serverUrl).host) {
    throw new ReviewHttpError(403, "Review submissions must come from this preview.");
  }
  if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ReviewHttpError(415, "Review submissions require application/json.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new ReviewHttpError(413, "Review submission is too large.");
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ReviewHttpError(400, "Request body must be valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ReviewHttpError(400, "Review submission must be a JSON object.");
  }
  return body;
}
