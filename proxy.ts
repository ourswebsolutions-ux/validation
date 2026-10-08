import { NextResponse, type NextRequest } from "next/server";

const CLIENT_COOKIE = "wac_sid";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function basicAuthOk(req: NextRequest, user: string, pass: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return false;
  }
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  // Evaluate both comparisons to avoid leaking which part was wrong.
  const userOk = timingSafeEqual(decoded.slice(0, idx), user);
  const passOk = timingSafeEqual(decoded.slice(idx + 1), pass);
  return userOk && passOk;
}

/**
 * 1. Optional HTTP Basic auth for the whole site + API (BASIC_AUTH_USER / BASIC_AUTH_PASSWORD).
 * 2. Issues an anonymous, httpOnly browser id cookie used only to scope bulk jobs and rate limits.
 *    It is not a login and carries no personal data.
 */
export function proxy(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (user && pass && !basicAuthOk(req, user, pass)) {
    return new NextResponse("Authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="WhatsApp Number Checker", charset="UTF-8"' },
    });
  }

  const res = NextResponse.next();
  if (!req.cookies.get(CLIENT_COOKIE)) {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    res.cookies.set(CLIENT_COOKIE, id, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
