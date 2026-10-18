
import { NextResponse } from "next/server";
import { getBtcXofRate } from "@/lib/yadio";



export async function GET() {
  try {
    const rateBtcXof = await getBtcXofRate();

    return NextResponse.json(
      {
        success: true,
        rateBtcXof,
        minimumAmountXof: 100,
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    console.error("Erreur récupération taux BTC/XOF:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Impossible de récupérer le taux Bitcoin actuellement.",
      },
      { status: 503 },
    );
  }
}
