import { db } from "@/db";
import { alerts } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const alertId = parseInt(id, 10);

    if (isNaN(alertId)) {
      return Response.json({ error: "Invalid alert ID" }, { status: 400 });
    }

    await db.update(alerts).set({ active: false }).where(eq(alerts.id, alertId));

    return Response.json({ message: "Alert deactivated successfully" });
  } catch (error) {
    console.error("Error deleting alert:", error);
    return Response.json(
      { error: "Failed to delete alert" },
      { status: 500 }
    );
  }
}
