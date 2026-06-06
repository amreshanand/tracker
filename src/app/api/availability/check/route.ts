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

    // Ensure product exists in DB
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
      if ((imageUrl && !prod.imageUrl) || (price && !prod.price) || (description && !prod.description) || (productName && productName !== "Unknown Product" && productName !== prod.name)) {
        productRecord = await db
          .update(products)
          .set({
            name: productName && productName !== "Unknown Product" ? productName : prod.name,
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

    // Check all major cities
    if (checkAll) {
      const majorCities = getMajorCityPincodes();
      const results: Array<{
        pincode: string;
        city: string;
        state: string;
        district: string;
        available: boolean;
        region: string;
        postOffices: number;
      }> = [];

      // Process in batches for performance
      for (const cityInfo of majorCities) {
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
          region: pincodeData?.region || "Unknown",
          postOffices: pincodeData?.postOffices.length || 0,
        });

        // Store in DB
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

      const availableResults = results.filter((r) => r.available);
      const unavailableResults = results.filter((r) => !r.available);

      return Response.json({
        product,
        totalChecked: results.length,
        availableCount: availableResults.length,
        unavailableCount: unavailableResults.length,
        available: availableResults,
        unavailable: unavailableResults,
        note: "Availability is simulated. For real data, integrate with Flipkart/Amazon APIs or use browser automation.",
      });
    }

    // Check single pincode
    if (pincode) {
      // Validate pincode format
      if (!/^\d{6}$/.test(pincode)) {
        return Response.json(
          { error: "Invalid pincode. Must be 6 digits." },
          { status: 400 }
        );
      }

      // Get REAL pincode details from India Post
      const pincodeDetails = await lookupPincodeFromIndiaPost(pincode);

      if (!pincodeDetails?.isValid) {
        return Response.json({
          product,
          result: {
            pincode,
            city: "Unknown",
            state: "Unknown",
            available: false,
            isValidPincode: false,
          },
          error: "Invalid or unknown pincode. Please check and try again.",
          nearestAvailable: [],
        });
      }

      const result = await checkSinglePincodeAvailability(productUrl, pincode, true);


      // Store in DB
      await db
        .insert(availability)
        .values({
          productId: product.id,
          pincode: pincode,
          city: pincodeDetails.deliveryPostOffice?.Name || pincodeDetails.district,
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

      // Find nearest available locations
      const nearest = await findNearestAvailable(productUrl, pincode, 5);

      return Response.json({
        product,
        result: {
          pincode,
          city: pincodeDetails.deliveryPostOffice?.Name || pincodeDetails.district,
          state: pincodeDetails.state,
          district: pincodeDetails.district,
          region: pincodeDetails.region,
          block: pincodeDetails.block,
          available: result.available,
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
        })),
        note: "Availability is simulated. For real data, connect Flipkart/Amazon APIs.",
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
