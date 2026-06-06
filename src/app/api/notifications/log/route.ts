import { db } from "@/db";
import { notificationLog, products } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const logs = await db
      .select({
        id: notificationLog.id,
        email: notificationLog.email,
        subject: notificationLog.subject,
        body: notificationLog.body,
        sentAt: notificationLog.sentAt,
        status: notificationLog.status,
        productName: products.name,
        productUrl: products.url,
      })
      .from(notificationLog)
      .innerJoin(products, eq(notificationLog.productId, products.id))
      .orderBy(desc(notificationLog.sentAt))
      .limit(50);

    return Response.json({ logs });
  } catch (error) {
    console.error("Error fetching notification logs:", error);
    return Response.json(
      { error: "Failed to fetch logs" },
      { status: 500 }
    );
  }
}
