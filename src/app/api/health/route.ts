import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const start = Date.now();
    const result = await db.execute(sql`SELECT 1 as test`);
    return Response.json({
      ok: true,
      queryTimeMs: Date.now() - start,
      result: result.rows[0],
    });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: e.message, code: e.code },
      { status: 500 }
    );
  }
}
