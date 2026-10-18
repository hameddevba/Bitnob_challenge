import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Si les clés Supabase ne sont pas encore configurées en environnement, ne pas bloquer
  if (!url || !anonKey || anonKey.startsWith("votre_") || anonKey.includes("...")) {
    return res;
  }

  try {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          list.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Pages protégées nécessitant une session active
    const p = req.nextUrl.pathname;
    if (!user && (p.startsWith("/send") || p.startsWith("/transfers"))) {
      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = "/login";
      return NextResponse.redirect(redirectUrl);
    }
  } catch (e) {
    console.warn("Proxy auth error:", e);
  }

  return res;
}

export const config = {
  // Exclut les endpoints machine-à-machine : worker et callback PayDunya ne doivent jamais être redirigés
  matcher: [
    "/((?!api/worker|api/paydunya|_next/static|_next/image|favicon.ico).*)",
  ],
};
