import { ImageResponse } from "next/og";

// Icône de l'application (PNG) : « Y » blanc sur le dégradé Yónne. Tailles autorisées seulement.
const SIZES = new Set([180, 192, 512]);

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response("not found", { status: 404 });
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          background: "radial-gradient(circle at 30% 20%, #ffb36b 0%, #ff6a3d 45%, #e8366f 100%)",
          color: "#fff", fontSize: size * 0.62, fontWeight: 800, letterSpacing: "-0.06em",
        }}
      >
        Y
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
