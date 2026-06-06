import { db } from "@/db";
import { products } from "@/db/schema";
import { detectPlatform } from "@/lib/platform";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, url, price, imageUrl, description } = body;

    if (!name || !url) {
      return Response.json(
        { error: "Product name and URL are required" },
        { status: 400 }
      );
    }

    const platform = detectPlatform(url);

    // Check if product already exists by URL
    const existing = await db
      .select()
      .from(products)
      .where(eq(products.url, url))
      .limit(1);

    if (existing.length > 0) {
      // Update the product info
      const updated = await db
        .update(products)
        .set({
          name,
          platform,
          price: price || existing[0].price,
          imageUrl: imageUrl || existing[0].imageUrl,
          description: description || existing[0].description,
          updatedAt: new Date(),
        })
        .where(eq(products.id, existing[0].id))
        .returning();

      return Response.json({ product: updated[0], created: false });
    }

    const newProduct = await db
      .insert(products)
      .values({
        name,
        url,
        platform,
        price: price || null,
        imageUrl: imageUrl || null,
        description: description || null,
      })
      .returning();

    return Response.json({ product: newProduct[0], created: true });
  } catch (error) {
    console.error("Error creating product:", error);
    return Response.json(
      { error: "Failed to create product" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const allProducts = await db
      .select()
      .from(products)
      .orderBy(desc(products.createdAt))
      .limit(50);

    return Response.json({ products: allProducts });
  } catch (error) {
    console.error("Error fetching products:", error);
    return Response.json(
      { error: "Failed to fetch products" },
      { status: 500 }
    );
  }
}
