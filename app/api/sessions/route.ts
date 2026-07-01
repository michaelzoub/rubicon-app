import { NextResponse } from "next/server";
import { getServiceForSession } from "@/lib/registry";

type SessionRequest = {
  serviceId?: string;
  input?: unknown;
  maxSpend?: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as SessionRequest;

  if (!body.serviceId) {
    return NextResponse.json({ error: "serviceId is required" }, { status: 400 });
  }

  if (!body.maxSpend) {
    return NextResponse.json({ error: "maxSpend is required" }, { status: 400 });
  }

  const match = await getServiceForSession(body.serviceId);
  if (!match) {
    return NextResponse.json({ error: "Active service not found" }, { status: 404 });
  }

  const { service, provider } = match;
  const sessionId = `sess_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;

  return NextResponse.json(
    {
      session: {
        id: sessionId,
        serviceId: service.id,
        providerId: provider.id,
        status: "created",
        maxSpend: body.maxSpend,
        meteringUnit: service.meteringUnit,
        pricing: service.pricing,
        quote: {
          service: service.name,
          provider: provider.name,
          pricePerUnit: service.pricing.pricePerUnit,
          gatewayFeePercent: service.pricing.gatewayFeePercent,
          expiresInSeconds: 90
        },
        streamUrl: `/api/sessions/${sessionId}/stream`
      }
    },
    { status: 201 }
  );
}
