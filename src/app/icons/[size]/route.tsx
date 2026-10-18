import { ImageResponse } from "next/og";

// Icône de l'application (PNG) : « Y » doré sur fond anthracite. Tailles autorisées seulement.
const SIZES = new Set([180, 192, 512]);

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response("not found", { status: 404 });
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          background: "radial-gradient(circle at 50% 0%, #2a2b31 0%, #18191d 70%)",
          color: "#d4a86a", fontSize: size * 0.6, fontWeight: 500, letterSpacing: "-0.06em",
        }}
      >
        Y
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
