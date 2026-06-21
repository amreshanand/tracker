import { db } from "@/db";
import { alerts, userUsage } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

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

    const [alert] = await db
      .select({ email: alerts.email })
      .from(alerts)
      .where(eq(alerts.id, alertId))
      .limit(1);

    if (!alert) {
      return Response.json({ error: "Alert not found" }, { status: 404 });
    }

    await db.update(alerts).set({ active: false }).where(eq(alerts.id, alertId));

    await db
      .update(userUsage)
      .set({
        activeAlerts: sql`GREATEST(${userUsage.activeAlerts} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(userUsage.email, alert.email));

    return Response.json({ message: "Alert deactivated successfully" });
  } catch (error) {
    console.error("Error deleting alert:", error);
    return Response.json(
      { error: "Failed to delete alert" },
      { status: 500 }
    );
  }
}
