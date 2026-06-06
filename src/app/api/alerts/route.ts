import { db } from "@/db";
import { alerts, products } from "@/db/schema";
import { detectPlatform } from "@/lib/platform";
import { eq, desc, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userName, email, pincode, productUrl, productName } = body;

    if (!userName || !email || !pincode || !productUrl) {
      return Response.json(
        { error: "Name, email, pincode, and product URL are required" },
        { status: 400 }
      );
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return Response.json({ error: "Invalid email address" }, { status: 400 });
    }

    // Validate pincode (6 digits for India)
    if (!/^\d{6}$/.test(pincode)) {
      return Response.json(
        { error: "Invalid pincode. Must be 6 digits." },
        { status: 400 }
      );
    }

    // Ensure product exists
    let productRecord = await db
      .select()
      .from(products)
      .where(eq(products.url, productUrl))
      .limit(1);

    if (productRecord.length === 0) {
      const platform = detectPlatform(productUrl);
      productRecord = await db
        .insert(products)
        .values({
          name: productName || "Unknown Product",
          url: productUrl,
          platform,
        })
        .returning();
    }

    const product = productRecord[0];

    // Check if alert already exists for this email + product + pincode
    const existingAlert = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.email, email),
          eq(alerts.productId, product.id),
          eq(alerts.pincode, pincode)
        )
      )
      .limit(1);

    if (existingAlert.length > 0) {
      // Reactivate if it was deactivated
      if (!existingAlert[0].active) {
        await db
          .update(alerts)
          .set({ active: true, notified: false })
          .where(eq(alerts.id, existingAlert[0].id));
      }
      return Response.json({
        alert: existingAlert[0],
        message: "Alert already exists for this product and pincode",
        alreadyExists: true,
      });
    }

    const newAlert = await db
      .insert(alerts)
      .values({
        userName,
        email,
        pincode,
        productId: product.id,
      })
      .returning();

    return Response.json({
      alert: newAlert[0],
      message: "Alert created successfully! We'll notify you when the product becomes available.",
      alreadyExists: false,
    });
  } catch (error) {
    console.error("Error creating alert:", error);
    return Response.json(
      { error: "Failed to create alert" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    let query = db
      .select({
        id: alerts.id,
        userName: alerts.userName,
        email: alerts.email,
        pincode: alerts.pincode,
        notified: alerts.notified,
        active: alerts.active,
        createdAt: alerts.createdAt,
        notifiedAt: alerts.notifiedAt,
        productId: alerts.productId,
        productName: products.name,
        productUrl: products.url,
        platform: products.platform,
        productPrice: products.price,
      })
      .from(alerts)
      .innerJoin(products, eq(alerts.productId, products.id))
      .orderBy(desc(alerts.createdAt))
      .limit(100);

    if (email) {
      query = query.where(eq(alerts.email, email)) as typeof query;
    }

    const allAlerts = await query;

    return Response.json({ alerts: allAlerts });
  } catch (error) {
    console.error("Error fetching alerts:", error);
    return Response.json(
      { error: "Failed to fetch alerts" },
      { status: 500 }
    );
  }
}
