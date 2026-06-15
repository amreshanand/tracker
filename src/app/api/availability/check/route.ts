import { db } from "@/db";
import { products, availability } from "@/db/schema";
import { detectPlatform } from "@/lib/platform";
import { lookupPincodeFromIndiaPost } from "@/lib/india-post-api";
import {
  checkSinglePincodeAvailability,
  getMajorCityPincodes,
  findNearestAvailable,
} from "@/lib/availability-service";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { productUrl, productName, pincode, checkAll, imageUrl, price, description } = body;

    if (!productUrl) {
      return Response.json(
        { error: "Product URL is required" },
        { status: 400 }
      );
    }

    // Upsert product record
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
          imageUrl: imageUrl || null,
          price: price || null,
          description: description || null,
        })
        .returning();
    } else {
      const prod = productRecord[0];
      const shouldUpdate =
        (imageUrl && !prod.imageUrl) ||
        (price && !prod.price) ||
        (description && !prod.description) ||
        (productName &&
          productName !== "Unknown Product" &&
          productName !== prod.name);

      if (shouldUpdate) {
        productRecord = await db
          .update(products)
          .set({
            name:
              productName && productName !== "Unknown Product"
                ? productName
                : prod.name,
            imageUrl: imageUrl || prod.imageUrl,
            price: price || prod.price,
            description: description || prod.description,
            updatedAt: new Date(),
          })
          .where(eq(products.id, prod.id))
          .returning();
      }
    }

    const product = productRecord[0];

    // ── Check all major cities ──────────────────────────────────────────────
    if (checkAll) {
      const majorCities = getMajorCityPincodes();

      const results: Array<{
        pincode: string;
        city: string;
        state: string;
        district: string;
        available: boolean;
        confidence: string;
        source: string;
        deliveryInfo: string | null;
        deliveryDate: string | null;
        region: string;
        postOffices: number;
      }> = [];

      const failedCities: string[] = [];

      for (const cityInfo of majorCities) {
        try {
          const result = await checkSinglePincodeAvailability(
            productUrl,
            cityInfo.pincode
          );

          const pincodeData = result.pincodeDetails;

          results.push({
            pincode: cityInfo.pincode,
            city: cityInfo.city,
            state: pincodeData?.state || cityInfo.state,
            district: pincodeData?.district || cityInfo.city,
            available: result.available,
            confidence: result.confidence,
            source: result.source,
            deliveryInfo: result.deliveryInfo,
            deliveryDate: result.deliveryDate,
            region: pincodeData?.region || "Unknown",
            postOffices: pincodeData?.postOffices.length || 0,
          });

          // Only persist confirmed results to avoid polluting DB with noise
          if (result.confidence === "confirmed") {
            await db
              .insert(availability)
              .values({
                productId: product.id,
                pincode: cityInfo.pincode,
                city: cityInfo.city,
                state: pincodeData?.state || cityInfo.state,
                available: result.available,
                lastChecked: new Date(),
              })
              .onConflictDoUpdate({
                target: [availability.productId, availability.pincode],
                set: {
                  available: result.available,
                  lastChecked: new Date(),
                },
              });
          }
        } catch (error) {
          failedCities.push(cityInfo.city);
          console.error(`Failed to check ${cityInfo.city}:`, error);
        }
      }

      // Separate confirmed-available, confirmed-unavailable, and unverified
      const availableResults = results.filter(
        (r) => r.available && r.confidence === "confirmed"
      );
      const unavailableResults = results.filter(
        (r) => !r.available && r.confidence === "confirmed"
      );
      const unverifiedResults = results.filter(
        (r) => r.confidence === "unknown"
      );

      return Response.json({
        product,
        totalChecked: results.length + failedCities.length,
        availableCount: availableResults.length,
        unavailableCount: unavailableResults.length,
        unverifiedCount: unverifiedResults.length,
        available: availableResults,
        unavailable: unavailableResults,
        unverified: unverifiedResults,
        note: failedCities.length
          ? `Skipped due to error: ${failedCities.join(", ")}`
          : undefined,
      });
    }

    // ── Single pincode check ────────────────────────────────────────────────
    if (pincode) {
      if (!/^\d{6}$/.test(pincode)) {
        return Response.json(
          { error: "Invalid pincode. Must be 6 digits." },
          { status: 400 }
        );
      }

      const pincodeDetails = await lookupPincodeFromIndiaPost(pincode);

      if (!pincodeDetails?.isValid) {
        return Response.json({
          product,
          result: {
            pincode,
            city: "Unknown",
            state: "Unknown",
            available: false,
            confidence: "unknown",
            isValidPincode: false,
          },
          error: "Invalid or unknown pincode. Please check and try again.",
          nearestAvailable: [],
        });
      }

      const result = await checkSinglePincodeAvailability(productUrl, pincode);

      // Only persist confirmed results to DB
      if (result.confidence === "confirmed") {
        await db
          .insert(availability)
          .values({
            productId: product.id,
            pincode,
            city:
              pincodeDetails.deliveryPostOffice?.Name || pincodeDetails.district,
            state: pincodeDetails.state,
            available: result.available,
            lastChecked: new Date(),
          })
          .onConflictDoUpdate({
            target: [availability.productId, availability.pincode],
            set: {
              available: result.available,
              lastChecked: new Date(),
            },
          });
      }

      const nearest = await findNearestAvailable(productUrl, pincode, 5);

      return Response.json({
        product,
        result: {
          pincode,
          city:
            pincodeDetails.deliveryPostOffice?.Name || pincodeDetails.district,
          state: pincodeDetails.state,
          district: pincodeDetails.district,
          region: pincodeDetails.region,
          block: pincodeDetails.block,
          available: result.available,
          confidence: result.confidence,
          source: result.source,
          deliveryInfo: result.deliveryInfo,
          deliveryDate: result.deliveryDate,
          isValidPincode: true,
          postOffices: pincodeDetails.postOffices.slice(0, 5).map((po) => ({
            name: po.Name,
            type: po.BranchType,
            delivery: po.DeliveryStatus === "Delivery",
          })),
        },
        nearestAvailable: nearest.map((n) => ({
          pincode: n.pincode,
          city: n.pincodeDetails?.district || "Unknown",
          state: n.pincodeDetails?.state || "Unknown",
          available: n.available,
          deliveryInfo: n.deliveryInfo,
          deliveryDate: n.deliveryDate,
        })),
      });
    }

    return Response.json(
      { error: "Provide either pincode or set checkAll=true" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error checking availability:", error);
    return Response.json(
      { error: "Failed to check availability" },
      { status: 500 }
    );
  }
}
