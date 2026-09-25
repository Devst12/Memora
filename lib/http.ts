export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export function handleError(error: unknown) {
  if (error instanceof Response) return error;
  console.error(error);
  return jsonError("Something went wrong. Please try again.", 500);
}

export function safeText(value: unknown, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
