// Tiny fetch wrapper with CSRF handling.

let csrfToken: string | null = null;

export function setCsrf(t: string | null) {
  csrfToken = t;
}
export function getCsrf() {
  return csrfToken;
}

async function request<T>(method: string, url: string, body?: any, raw = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (body && !(body instanceof FormData)) headers["content-type"] = "application/json";
  if (csrfToken) headers["x-csrf-token"] = csrfToken;
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    // Surface to caller
    throw new ApiError("unauthenticated", 401);
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch {}
    throw new ApiError(msg, res.status);
  }
  if (raw) return res as any;
  if (res.headers.get("content-type")?.includes("application/json")) return res.json();
  return undefined as any;
}

export class ApiError extends Error {
  constructor(msg: string, public status: number) {
    super(msg);
  }
}

export const api = {
  get: <T>(u: string) => request<T>("GET", u),
  post: <T>(u: string, b?: any) => request<T>("POST", u, b),
  put: <T>(u: string, b?: any) => request<T>("PUT", u, b),
  del: <T>(u: string, b?: any) => request<T>("DELETE", u, b),
  raw: (u: string) => request<Response>("GET", u, undefined, true),
};
