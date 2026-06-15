/**
 * Unified Product Availability Service
 *
 * ACCURACY POLICY:
 * - "available: true"   → We have a CONFIRMED delivery signal from Flipkart
 * - "available: false"  → We have a CONFIRMED "not serviceable" or OOS signal
 * - "available: false" + confidence:"unknown" → We COULD NOT verify (not the same
 *   as confirmed unavailable). The UI should show "Could not verify" — NOT "Not Available".
 *
 * We NEVER silently convert an unverified/ambiguous check into "Not Available".
 * That was the root cause of false negatives in the previous implementation.
 */

import { lookupPincodeFromIndiaPost, type PincodeDetails } from "./india-post-api";
import { detectPlatform } from "./platform";
import {
  checkFlipkartPincodeServiceability,
  checkAmazonAvailability,
  fetchFlipkartProductDetails,
} from "./flipkart-api-checker";

export interface AvailabilityCheckResult {
  pincode: string;
  pincodeDetails: PincodeDetails | null;
  /** True only when confirmed deliverable by a real check */
  available: boolean;
  deliveryInfo: string | null;
  deliveryDate: string | null;
  checkedAt: Date;
  /** Which method produced this result */
  source: "real" | "unverified";
  /** confirmed = explicit signal; unknown = could not determine */
  confidence: "confirmed" | "unknown";
}

export interface BulkAvailabilityResult {
  productUrl: string;
  productName: string;
  platform: string;
  results: AvailabilityCheckResult[];
  totalChecked: number;
  availableCount: number;
  unavailableCount: number;
  unverifiedCount: number;
  isGloballyOutOfStock: boolean;
}

// ---------------------------------------------------------------------------
// Product page cache (global stock status)
// ---------------------------------------------------------------------------

const productPageCache = new Map<string, {
  isGloballyOutOfStock: boolean;
  globallyAvailable: boolean;
  html: string;
  name: string | null;
  price: string | null;
  imageUrl: string | null;
  description: string | null;
  fetchedAt: Date;
}>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getProductPageData(productUrl: string, platform: string) {
  const cached = productPageCache.get(productUrl);
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return cached;
  }

  if (platform === "flipkart") {
    const details = await fetchFlipkartProductDetails(productUrl);
    const data = {
      isGloballyOutOfStock: details.isGloballyOutOfStock,
      globallyAvailable: details.available,
      html: details.html,
      name: details.name,
      price: details.price,
      imageUrl: details.imageUrl,
      description: details.description,
      fetchedAt: new Date(),
    };
    productPageCache.set(productUrl, data);
    return data;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Single pincode check
// ---------------------------------------------------------------------------

/**
 * Check availability for a single pincode using real HTTP checks.
 *
 * KEY CHANGE: When the check is ambiguous / all strategies fail,
 * we return confidence:"unknown" and a clear deliveryInfo message
 * INSTEAD of silently reporting available:false.
 */
export async function checkSinglePincodeAvailability(
  productUrl: string,
  pincode: string
): Promise<AvailabilityCheckResult> {
  const pincodeDetails = await lookupPincodeFromIndiaPost(pincode);
  const platform = detectPlatform(productUrl);

  if (platform === "flipkart") {
    try {
      // Step 1: Check if globally out of stock (no point checking pincode)
      const productData = await getProductPageData(productUrl, platform);

      if (productData?.isGloballyOutOfStock) {
        return {
          pincode,
          pincodeDetails,
          available: false,
          deliveryInfo: "Product is currently out of stock (not available anywhere)",
          deliveryDate: null,
          checkedAt: new Date(),
          source: "real",
          confidence: "confirmed",
        };
      }

      // Step 2: Pincode-specific serviceability check (Rome API → page fetch → Puppeteer)
      const result = await checkFlipkartPincodeServiceability(productUrl, pincode);

      if (result.success) {
        // We got a definitive answer
        return {
          pincode,
          pincodeDetails,
          available: result.available,
          deliveryInfo: result.deliveryInfo,
          deliveryDate: result.deliveryDate,
          checkedAt: new Date(),
          source: "real",
          confidence: "confirmed",
        };
      } else {
        // All strategies exhausted — mark as unverified, NOT as "not available"
        const loc = pincodeDetails?.isValid
          ? `${pincodeDetails.district}, ${pincodeDetails.state}`
          : pincode;
        return {
          pincode,
          pincodeDetails,
          available: false, // default to false but confidence is unknown
          deliveryInfo:
            result.error ||
            `Could not verify delivery to ${loc}. Please check Flipkart directly.`,
          deliveryDate: null,
          checkedAt: new Date(),
          source: "unverified",
          confidence: "unknown",
        };
      }
    } catch (err) {
      console.error("Flipkart serviceability check error:", err);
      const loc = pincodeDetails?.isValid
        ? `${pincodeDetails.district}, ${pincodeDetails.state}`
        : pincode;
      return {
        pincode,
        pincodeDetails,
        available: false,
        deliveryInfo: `Check failed — please verify on Flipkart directly (${loc})`,
        deliveryDate: null,
        checkedAt: new Date(),
        source: "unverified",
        confidence: "unknown",
      };
    }
  }

  if (platform === "amazon_india") {
    try {
      const result = await checkAmazonAvailability(productUrl, pincode);
      return {
        pincode,
        pincodeDetails,
        available: result.available,
        deliveryInfo: result.deliveryInfo,
        deliveryDate: null,
        checkedAt: new Date(),
        source: "real",
        confidence: result.source === "api" ? "confirmed" : "confirmed",
      };
    } catch (err) {
      console.error("Amazon serviceability check error:", err);
      return {
        pincode,
        pincodeDetails,
        available: false,
        deliveryInfo: "Check failed — please verify on Amazon directly",
        deliveryDate: null,
        checkedAt: new Date(),
        source: "unverified",
        confidence: "unknown",
      };
    }
  }

  // Unsupported platform
  return {
    pincode,
    pincodeDetails,
    available: false,
    deliveryInfo: `Real availability checks are not supported for this platform (${platform}). Please check the website directly.`,
    deliveryDate: null,
    checkedAt: new Date(),
    source: "unverified",
    confidence: "unknown",
  };
}

// ---------------------------------------------------------------------------
// Bulk check across major cities
// ---------------------------------------------------------------------------

/**
 * Bulk availability check across major cities.
 * Uses real checks per pincode. Processes in small batches to avoid rate limiting.
 *
 * KEY CHANGE: Unverified results are kept separate from confirmed-unavailable
 * so the UI can show "Could not verify" instead of "Not Available".
 */
export async function checkBulkAvailabilityReal(
  productUrl: string,
  platform: string,
  cities: { pincode: string; city: string; state: string }[]
): Promise<{
  results: Array<{
    pincode: string;
    city: string;
    state: string;
    district: string;
    available: boolean;
    source: "real" | "unverified";
    confidence: "confirmed" | "unknown";
    region: string;
    postOffices: number;
    deliveryInfo: string | null;
    deliveryDate: string | null;
  }>;
  isGloballyOutOfStock: boolean;
  globallyUnavailable: boolean;
}> {
  let isGloballyOutOfStock = false;
  let globallyUnavailable = false;

  if (platform === "flipkart") {
    try {
      const productData = await getProductPageData(productUrl, platform);
      if (productData) {
        isGloballyOutOfStock = productData.isGloballyOutOfStock;
        globallyUnavailable =
          !productData.globallyAvailable &&
          !productData.isGloballyOutOfStock &&
          productData.html.length > 1000;
      }
    } catch (err) {
      console.error("Failed to fetch product page for global check:", err);
    }
  }

  if (isGloballyOutOfStock) {
    return {
      results: cities.map((city) => ({
        ...city,
        district: city.city,
        available: false,
        source: "real" as const,
        confidence: "confirmed" as const,
        region: city.state,
        postOffices: 0,
        deliveryInfo: "Product is out of stock (unavailable everywhere)",
        deliveryDate: null,
      })),
      isGloballyOutOfStock: true,
      globallyUnavailable: false,
    };
  }

  const BATCH_SIZE = 3;
  const DELAY_MS = 600; // slightly longer to reduce rate-limit risk

  const results: Array<{
    pincode: string;
    city: string;
    state: string;
    district: string;
    available: boolean;
    source: "real" | "unverified";
    confidence: "confirmed" | "unknown";
    region: string;
    postOffices: number;
    deliveryInfo: string | null;
    deliveryDate: string | null;
  }> = [];

  for (let i = 0; i < cities.length; i += BATCH_SIZE) {
    const batch = cities.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (cityInfo) => {
        let available = false;
        let source: "real" | "unverified" = "unverified";
        let confidence: "confirmed" | "unknown" = "unknown";
        let deliveryInfo: string | null = null;
        let deliveryDate: string | null = null;

        if (platform === "flipkart") {
          try {
            const check = await checkFlipkartPincodeServiceability(
              productUrl,
              cityInfo.pincode
            );
            if (check.success) {
              // Definitive answer from one of the real strategies
              available = check.available;
              deliveryInfo = check.deliveryInfo;
              deliveryDate = check.deliveryDate;
              source = "real";
              confidence = "confirmed";
            } else {
              // Could not verify — do NOT mark as "not available"
              source = "unverified";
              confidence = "unknown";
              deliveryInfo = check.error || "Could not verify — check Flipkart directly";
            }
          } catch {
            source = "unverified";
            confidence = "unknown";
            deliveryInfo = "Check failed — try again or visit Flipkart";
          }
        } else if (platform === "amazon_india") {
          try {
            const check = await checkAmazonAvailability(productUrl, cityInfo.pincode);
            available = check.available;
            deliveryInfo = check.deliveryInfo;
            source = "real";
            confidence = "confirmed";
          } catch {
            source = "unverified";
            confidence = "unknown";
          }
        } else {
          source = "unverified";
          confidence = "unknown";
          deliveryInfo = "Availability check not supported for this platform";
        }

        let region = cityInfo.state;
        let postOffices = 0;
        try {
          const pincodeData = await lookupPincodeFromIndiaPost(cityInfo.pincode);
          if (pincodeData) {
            region = pincodeData.region || cityInfo.state;
            postOffices = pincodeData.postOffices.length;
          }
        } catch {
          // Ignore pincode lookup errors
        }

        return {
          pincode: cityInfo.pincode,
          city: cityInfo.city,
          state: cityInfo.state,
          district: cityInfo.city,
          available,
          source,
          confidence,
          region,
          postOffices,
          deliveryInfo,
          deliveryDate,
        };
      })
    );

    results.push(...batchResults);

    if (i + BATCH_SIZE < cities.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  return { results, isGloballyOutOfStock: false, globallyUnavailable };
}

// ---------------------------------------------------------------------------
// Major city pincodes
// ---------------------------------------------------------------------------

export function getMajorCityPincodes(): { pincode: string; city: string; state: string }[] {
  return [
    { pincode: "110001", city: "New Delhi", state: "Delhi" },
    { pincode: "122001", city: "Gurgaon", state: "Haryana" },
    { pincode: "201301", city: "Noida", state: "Uttar Pradesh" },
    { pincode: "201001", city: "Ghaziabad", state: "Uttar Pradesh" },
    { pincode: "121001", city: "Faridabad", state: "Haryana" },
    { pincode: "400001", city: "Mumbai", state: "Maharashtra" },
    { pincode: "400076", city: "Navi Mumbai", state: "Maharashtra" },
    { pincode: "411001", city: "Pune", state: "Maharashtra" },
    { pincode: "440001", city: "Nagpur", state: "Maharashtra" },
    { pincode: "560001", city: "Bangalore", state: "Karnataka" },
    { pincode: "560100", city: "Electronic City", state: "Karnataka" },
    { pincode: "600001", city: "Chennai", state: "Tamil Nadu" },
    { pincode: "641001", city: "Coimbatore", state: "Tamil Nadu" },
    { pincode: "500001", city: "Hyderabad", state: "Telangana" },
    { pincode: "500036", city: "Secunderabad", state: "Telangana" },
    { pincode: "700001", city: "Kolkata", state: "West Bengal" },
    { pincode: "700091", city: "Salt Lake", state: "West Bengal" },
    { pincode: "380001", city: "Ahmedabad", state: "Gujarat" },
    { pincode: "395001", city: "Surat", state: "Gujarat" },
    { pincode: "390001", city: "Vadodara", state: "Gujarat" },
    { pincode: "302001", city: "Jaipur", state: "Rajasthan" },
    { pincode: "313001", city: "Udaipur", state: "Rajasthan" },
    { pincode: "342001", city: "Jodhpur", state: "Rajasthan" },
    { pincode: "226001", city: "Lucknow", state: "Uttar Pradesh" },
    { pincode: "208001", city: "Kanpur", state: "Uttar Pradesh" },
    { pincode: "221001", city: "Varanasi", state: "Uttar Pradesh" },
    { pincode: "282001", city: "Agra", state: "Uttar Pradesh" },
    { pincode: "462001", city: "Bhopal", state: "Madhya Pradesh" },
    { pincode: "452001", city: "Indore", state: "Madhya Pradesh" },
    { pincode: "682001", city: "Kochi", state: "Kerala" },
    { pincode: "695001", city: "Thiruvananthapuram", state: "Kerala" },
    { pincode: "160001", city: "Chandigarh", state: "Chandigarh" },
    { pincode: "141001", city: "Ludhiana", state: "Punjab" },
    { pincode: "143001", city: "Amritsar", state: "Punjab" },
    { pincode: "800001", city: "Patna", state: "Bihar" },
    { pincode: "834001", city: "Ranchi", state: "Jharkhand" },
    { pincode: "751001", city: "Bhubaneswar", state: "Odisha" },
    { pincode: "781001", city: "Guwahati", state: "Assam" },
    { pincode: "793001", city: "Shillong", state: "Meghalaya" },
    { pincode: "795001", city: "Imphal", state: "Manipur" },
    { pincode: "171001", city: "Shimla", state: "Himachal Pradesh" },
    { pincode: "248001", city: "Dehradun", state: "Uttarakhand" },
    { pincode: "403001", city: "Panaji", state: "Goa" },
  ];
}

// ---------------------------------------------------------------------------
// Find nearest available pincodes
// ---------------------------------------------------------------------------

/**
 * Find nearest available pincodes to a given pincode.
 * Only returns confirmed-available locations (confidence !== "unknown").
 */
export async function findNearestAvailable(
  productUrl: string,
  userPincode: string,
  limit: number = 5
): Promise<AvailabilityCheckResult[]> {
  const majorCities = getMajorCityPincodes();
  const userPincodeNum = parseInt(userPincode, 10);

  const sorted = [...majorCities].sort((a, b) => {
    const distA = Math.abs(parseInt(a.pincode, 10) - userPincodeNum);
    const distB = Math.abs(parseInt(b.pincode, 10) - userPincodeNum);
    return distA - distB;
  });

  const results: AvailabilityCheckResult[] = [];

  for (const city of sorted) {
    if (results.length >= limit) break;
    const result = await checkSinglePincodeAvailability(productUrl, city.pincode);
    // Only include confirmed-available results (not unverified ones)
    if (result.available && result.confidence === "confirmed") {
      results.push(result);
    }
  }

  return results;
}
