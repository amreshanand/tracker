import { db } from "@/db";
import { alerts, analyticsEvents } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return new Response(
        `<html><body><h1>Invalid verification link</h1><p>No verification token provided.</p></body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } }
      );
    }

    const [alert] = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.verificationToken, token), eq(alerts.emailVerified, false)))
      .limit(1);

    if (!alert) {
      return new Response(
        `<html><body><h1>Verification failed</h1><p>This link is invalid or the alert has already been verified.</p></body></html>`,
        { status: 404, headers: { "Content-Type": "text/html" } }
      );
    }

    await db
      .update(alerts)
      .set({
        emailVerified: true,
        active: true,
        verificationToken: null,
      })
      .where(eq(alerts.id, alert.id));

    await db.insert(analyticsEvents).values({
      event: "alert_activated",
      email: alert.email,
      productId: alert.productId,
      metadata: JSON.stringify({ traceId: alert.traceId }),
    });

    return new Response(
      `<html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f4f7fa}
        .card{background:#fff;padding:40px;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,.1);text-align:center;max-width:480px}
        h1{color:#16a34a;margin:0 0 12px}p{color:#475569;line-height:1.6;margin:0}</style></head>
        <body><div class="card"><h1>✅ Email Verified!</h1>
        <p>Your alert for <strong>${alert.userName}</strong> has been activated. You'll be notified when the product becomes available at your pincode.</p></div></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  } catch (error) {
    console.error("Error verifying email:", error);
    return new Response(
      `<html><body><h1>Verification failed</h1><p>An error occurred. Please try again.</p></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }
}
