/**
 * Unified Product Availability Service
 *
 * IMPORTANT: This service strives to provide ACCURATE data, not fake estimates.
 * - Single pincode checks: uses real HTTP-based serviceability check
 * - Bulk checks: uses real checks per city (slower but accurate)
 * - When real check fails/is ambiguous: returns `available: false` with
 *   a clear note — we NEVER assume available when we can't confirm it
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
  available: boolean;
  deliveryInfo: string | null;
  checkedAt: Date;
  source: "real" | "simulated" | "unverified";
  confidence: "confirmed" | "likely" | "unknown";
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

/**
 * Global product availability cache per session
 * Key: productUrl, Value: global OOS status + HTML
 */
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

/**
 * Get cached product page data or fetch fresh
 */
async function getProductPageData(productUrl: string, platform: string) {
  const cached = productPageCache.get(productUrl);
  if (cached && (Date.now() - cached.fetchedAt.getTime()) < CACHE_TTL_MS) {
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

  // For other platforms, we don't pre-fetch
  return null;
}

/**
 * Check availability for a single pincode.
 * Uses real HTTP-based checks. Returns unverified if check fails.
 */
export async function checkSinglePincodeAvailability(
  productUrl: string,
  pincode: string,
  useRealCheck: boolean = false
): Promise<AvailabilityCheckResult> {
  const pincodeDetails = await lookupPincodeFromIndiaPost(pincode);
  const platform = detectPlatform(productUrl);

  let available = false;
  let deliveryInfo: string | null = null;
  let source: "real" | "simulated" | "unverified" = "unverified";
  let confidence: "confirmed" | "likely" | "unknown" = "unknown";

  if (useRealCheck || true) {
    // Always try real check — estimates are misleading
    if (platform === "flipkart") {
      try {
        // First: check if globally out of stock (product-level, not pincode-level)
        const productData = await getProductPageData(productUrl, platform);

        if (productData?.isGloballyOutOfStock) {
          return {
            pincode,
            pincodeDetails,
            available: false,
            deliveryInfo: "Product is currently out of stock (not available anywhere)",
            checkedAt: new Date(),
            source: "real",
            confidence: "confirmed",
          };
        }

        if (productData && !productData.globallyAvailable && !productData.html) {
          // Product page couldn't be fetched (bot protection)
          return {
            pincode,
            pincodeDetails,
            available: false,
            deliveryInfo: "Unable to verify — Flipkart blocked the request",
            checkedAt: new Date(),
            source: "unverified",
            confidence: "unknown",
          };
        }

        // Now check pincode-specific serviceability
        const result = await checkFlipkartPincodeServiceability(productUrl, pincode);

        if (result.success) {
          available = result.available;
          deliveryInfo = result.deliveryInfo;
          source = result.source === "api" ? "real" : "real";
          confidence = result.source === "api" ? "confirmed" : "likely";
        } else {
          // Could not determine serviceability — do NOT assume available
          available = false;
          source = "unverified";
          confidence = "unknown";
          deliveryInfo = result.error || "Serviceability could not be verified for this pincode";
        }
      } catch (err) {
        console.error("Flipkart serviceability check error:", err);
        available = false;
        source = "unverified";
        confidence = "unknown";
        deliveryInfo = "Check failed — please verify on Flipkart directly";
      }
    } else if (platform === "amazon_india") {
      try {
        const result = await checkAmazonAvailability(productUrl, pincode);
        available = result.available;
        deliveryInfo = result.deliveryInfo;
        source = result.source === "api" ? "real" : "real";
        confidence = result.source === "api" ? "confirmed" : "likely";
      } catch (err) {
        console.error("Amazon serviceability check error:", err);
        available = false;
        source = "unverified";
        confidence = "unknown";
        deliveryInfo = "Check failed — please verify on Amazon directly";
      }
    } else {
      // Unsupported platform — we cannot check serviceability
      available = false;
      source = "unverified";
      confidence = "unknown";
      deliveryInfo = `Real serviceability check not supported for this platform. Please check ${platform} directly.`;
    }
  }

  // Supplement delivery info with pincode location data
  if (!deliveryInfo && pincodeDetails?.isValid) {
    const loc = `${pincodeDetails.district}, ${pincodeDetails.state}`;
    if (available) {
      deliveryInfo = source === "real" ? `Deliverable to ${loc}` : `Estimated available in ${loc}`;
    } else {
      deliveryInfo = source === "real" ? `Not deliverable to ${loc}` : `Not available in ${loc}`;
    }
  }

  return {
    pincode,
    pincodeDetails,
    available,
    deliveryInfo,
    checkedAt: new Date(),
    source,
    confidence,
  };
}

/**
 * Bulk availability check across all major cities.
 * 
 * For Flipkart/Amazon: performs real HTTP checks per pincode.
 * Results are real — if we can't confirm availability, we report unknown.
 * Processes in small batches to avoid rate limiting.
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
    source: "real" | "simulated" | "unverified";
    confidence: "confirmed" | "likely" | "unknown";
    region: string;
    postOffices: number;
    deliveryInfo: string | null;
  }>;
  isGloballyOutOfStock: boolean;
  globallyUnavailable: boolean;
}> {
  // Step 1: Check global product status first (is it in stock at all?)
  let isGloballyOutOfStock = false;
  let globallyUnavailable = false;

  if (platform === "flipkart") {
    try {
      const productData = await getProductPageData(productUrl, platform);
      if (productData) {
        isGloballyOutOfStock = productData.isGloballyOutOfStock;
        // If we got the product page but no buy button, product may be unavailable
        globallyUnavailable = !productData.globallyAvailable && !productData.isGloballyOutOfStock && productData.html.length > 1000;
      }
    } catch (err) {
      console.error("Failed to fetch product page for global check:", err);
    }
  }

  // Step 2: If globally out of stock, mark all cities as unavailable immediately
  if (isGloballyOutOfStock) {
    return {
      results: cities.map(city => ({
        ...city,
        district: city.city,
        available: false,
        source: "real" as const,
        confidence: "confirmed" as const,
        region: city.state,
        postOffices: 0,
        deliveryInfo: "Product is out of stock (unavailable everywhere)",
      })),
      isGloballyOutOfStock: true,
      globallyUnavailable: false,
    };
  }

  // Step 3: Per-pincode serviceability checks in small batches
  // Use a delay between requests to avoid rate limiting
  const BATCH_SIZE = 3;
  const DELAY_MS = 500;

  const results: Array<{
    pincode: string;
    city: string;
    state: string;
    district: string;
    available: boolean;
    source: "real" | "simulated" | "unverified";
    confidence: "confirmed" | "likely" | "unknown";
    region: string;
    postOffices: number;
    deliveryInfo: string | null;
  }> = [];

  for (let i = 0; i < cities.length; i += BATCH_SIZE) {
    const batch = cities.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (cityInfo) => {
        let available = false;
        let source: "real" | "simulated" | "unverified" = "unverified";
        let confidence: "confirmed" | "likely" | "unknown" = "unknown";
        let deliveryInfo: string | null = null;

        if (platform === "flipkart") {
          try {
            const check = await checkFlipkartPincodeServiceability(productUrl, cityInfo.pincode);
            if (check.success) {
              available = check.available;
              deliveryInfo = check.deliveryInfo;
              source = check.source === "api" ? "real" : "real";
              confidence = check.source === "api" ? "confirmed" : "likely";
            } else {
              // Could not determine — mark as unverified, NOT as available
              source = "unverified";
              confidence = "unknown";
              deliveryInfo = "Could not verify — check Flipkart directly";
            }
          } catch {
            source = "unverified";
            confidence = "unknown";
          }
        } else if (platform === "amazon_india") {
          try {
            const check = await checkAmazonAvailability(productUrl, cityInfo.pincode);
            available = check.available;
            deliveryInfo = check.deliveryInfo;
            source = check.source === "api" ? "real" : "real";
            confidence = check.source === "api" ? "confirmed" : "likely";
          } catch {
            source = "unverified";
            confidence = "unknown";
          }
        } else {
          // Cannot check other platforms
          source = "unverified";
          confidence = "unknown";
          deliveryInfo = "Serviceability check not available for this platform";
        }

        // Get pincode region info from India Post
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
        };
      })
    );

    results.push(...batchResults);

    // Delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < cities.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  return { results, isGloballyOutOfStock: false, globallyUnavailable };
}

/**
 * Get major city pincodes for initial availability check
 */
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

/**
 * Find nearest available pincodes to a given pincode
 * Uses real checks — returns only confirmed available locations
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
    const result = await checkSinglePincodeAvailability(productUrl, city.pincode, true);
    if (result.available && result.confidence !== "unknown") {
      results.push(result);
    }
  }

  return results;
}
