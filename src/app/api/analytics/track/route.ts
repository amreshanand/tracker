import { db } from "@/db";
import { analyticsEvents } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { event, email, productId, metadata } = body;

    if (!event) {
      return Response.json({ error: "Event name is required" }, { status: 400 });
    }

    const validEvents = [
      "install", "popup_open", "product_detected",
      "availability_checked", "alert_created", "alert_triggered",
    ];
    if (!validEvents.includes(event)) {
      return Response.json({ error: `Invalid event: ${event}` }, { status: 400 });
    }

    await db.insert(analyticsEvents).values({
      event,
      email: email || null,
      productId: productId ? parseInt(productId, 10) : null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Error tracking event:", error);
    return Response.json(
      { error: "Failed to track event" },
      { status: 500 }
    );
  }
}
