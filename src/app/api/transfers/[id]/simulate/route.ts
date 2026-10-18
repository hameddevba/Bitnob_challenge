import { isSimulationEnabled } from "@/lib/environment";
import { getTransferForViewer, simulateSandboxPayment } from "@/lib/transfers";

// POST /api/transfers/:id/simulate?token=… — sandbox uniquement (voir isSimulationEnabled)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isSimulationEnabled())) return Response.json({ error: "Introuvable" }, { status: 404 });

  const { id } = await params;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!(await getTransferForViewer(id, token))) return Response.json({ error: "Introuvable" }, { status: 404 });

  try {
    return Response.json({ status: await simulateSandboxPayment(id) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
}
