import { NextResponse } from "next/server";
import { getPublicService } from "@/lib/registry";

export async function GET(_request: Request, { params }: { params: Promise<{ serviceId: string }> }) {
  const { serviceId } = await params;
  const service = await getPublicService(serviceId);

  if (!service) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  return NextResponse.json({ service });
}
