import { NextResponse, type NextRequest } from "next/server";

// Coarse gate only: cookie presence. Pages and API routes re-check the session and role.
export function proxy(req: NextRequest) {
  if (!req.cookies.get("session")?.value) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*", "/responses/:path*", "/cases/:path*", "/admin/:path*"] };
