import { db } from "@/db";
import { products, availability } from "@/db/schema";
import { detectPlatform } from "@/lib/platform";
import { lookupPincodeFromIndiaPost } from "@/lib/india-post-api";
import {
  checkSinglePincodeAvailability,
  checkBulkAvailabilityReal,
  getMajorCityPincodes,
  findNearestAvailable,
} from "@/lib/availability-service";
import { apiLimiter, productLimiter, getClientIp } from "@/lib/rate-limit";
import { isCircuitAvailable, recordSuccess, recordFailure } from "@/lib/circuit-breaker";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const ROUTE_TIMEOUT_MS = 12_000;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function corsJson(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: { ...init?.headers, ...CORS_HEADERS },
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), ms)
    ),
  ]);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const { allowed, retryAfter } = await apiLimiter.check(`check:${ip}`);
    if (!allowed) {
      return corsJson(
        { error: `Too many requests. Try again in ${retryAfter}s.` },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }

    const body = await request.json();
    const { productUrl, productName, pincode, checkAll, imageUrl, price, description } = body;

    if (!productUrl) {
      return corsJson(
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
    const platform = detectPlatform(productUrl);

    // Circuit breaker check
    if (platform === "flipkart" || platform === "amazon_india") {
      const available = await isCircuitAvailable(platform);
      if (!available) {
        return corsJson({
          product,
          circuitBreakerOpen: true,
          error: `Availability checks for ${platform} are temporarily disabled due to repeated failures. Please try again later.`,
          platform,
        });
      }
    }

    // Per-product rate limiting
    const productLimitKey = `product:${product.id}:${ip}`;
    const { allowed: prodAllowed, retryAfter: prodRetryAfter } = await productLimiter.check(productLimitKey);
    if (!prodAllowed) {
      return corsJson(
        { error: `Too many requests for this product. Try again in ${prodRetryAfter}s.` },
        { status: 429, headers: { "Retry-After": String(prodRetryAfter) } }
      );
    }

    // Data freshness: include metadata about last scrape
    const dataFreshness = product.lastScrapedAt
      ? {
          lastUpdated: product.lastScrapedAt,
          ageHours: Math.round((Date.now() - new Date(product.lastScrapedAt).getTime()) / (1000 * 60 * 60)),
          isStale: product.lastScrapedAt
            ? (Date.now() - new Date(product.lastScrapedAt).getTime()) > 24 * 60 * 60 * 1000
            : true,
        }
      : { lastUpdated: null, ageHours: null, isStale: true };

    // ── Check all major cities ──────────────────────────────────────────────
    if (checkAll) {
      const majorCities = getMajorCityPincodes();

      const platform = detectPlatform(productUrl) || "";
      const { results: bulkResults } = await checkBulkAvailabilityReal(
        productUrl,
        platform,
        majorCities
      );

      const results = bulkResults;

      // Persist confirmed results to DB
      for (const r of results) {
        if (r.confidence === "confirmed") {
          await db
            .insert(availability)
            .values({
              productId: product.id,
              pincode: r.pincode,
              city: r.city,
              state: r.state,
              available: r.available,
              lastChecked: new Date(),
            })
            .onConflictDoUpdate({
              target: [availability.productId, availability.pincode],
              set: {
                available: r.available,
                lastChecked: new Date(),
              },
            });
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

      return corsJson({
        product,
        dataFreshness,
        totalChecked: results.length,
        availableCount: availableResults.length,
        unavailableCount: unavailableResults.length,
        unverifiedCount: unverifiedResults.length,
        available: availableResults,
        unavailable: unavailableResults,
        unverified: unverifiedResults,
      });
    }

    // ── Single pincode check ────────────────────────────────────────────────
    if (pincode) {
      if (!/^\d{6}$/.test(pincode)) {
        return corsJson(
          { error: "Invalid pincode. Must be 6 digits." },
          { status: 400 }
        );
      }

      const result = await withTimeout(
        (async () => {
          const details = await lookupPincodeFromIndiaPost(pincode);

          if (!details?.isValid) {
            return corsJson({
              product,
              dataFreshness,
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

          const availabilityResult = await checkSinglePincodeAvailability(productUrl, pincode);

          // Track circuit breaker
          if (platform === "flipkart" || platform === "amazon_india") {
            if (availabilityResult.confidence === "confirmed") {
              await recordSuccess(platform);
            } else if (availabilityResult.source === "unverified") {
              await recordFailure(platform);
            }
          }

          // Only persist confirmed results to DB
          if (availabilityResult.confidence === "confirmed") {
            await db
              .insert(availability)
              .values({
                productId: product.id,
                pincode,
                city:
                  details.deliveryPostOffice?.Name || details.district,
                state: details.state,
                available: availabilityResult.available,
                lastChecked: new Date(),
              })
              .onConflictDoUpdate({
                target: [availability.productId, availability.pincode],
                set: {
                  available: availabilityResult.available,
                  lastChecked: new Date(),
                },
              });
          }

          const nearest = await findNearestAvailable(productUrl, pincode, 5);

          return corsJson({
            product,
            dataFreshness,
            result: {
              pincode,
              city:
                details.deliveryPostOffice?.Name || details.district,
              state: details.state,
              district: details.district,
              region: details.region,
              block: details.block,
              available: availabilityResult.available,
              confidence: availabilityResult.confidence,
              source: availabilityResult.source,
              deliveryInfo: availabilityResult.deliveryInfo,
              deliveryDate: availabilityResult.deliveryDate,
              isValidPincode: true,
              postOffices: details.postOffices.slice(0, 5).map((po) => ({
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
        })(),
        ROUTE_TIMEOUT_MS
      );

      return result;
    }

    return corsJson(
      { error: "Provide either pincode or set checkAll=true" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error checking availability:", error);
    const isTimeout = error instanceof Error && error.message === "Request timed out";
    return corsJson(
      { error: isTimeout ? "Request timed out. Try again later." : "Failed to check availability" },
      { status: isTimeout ? 503 : 500 }
    );
  }
}
