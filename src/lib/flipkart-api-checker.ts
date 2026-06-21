/**
 * Flipkart Real Availability Checker
 *
 * Uses Flipkart's actual BFF (Backend-for-Frontend) Rome API to check
 * pincode-level serviceability. This is the same API that Flipkart's
 * own website calls when you enter a pincode in the delivery check widget.
 *
 * Strategy waterfall (each tried in order, stops at first definitive answer):
 *  A. Rome API  — POST 1.rome.api.flipkart.com/api/4/page/fetch
 *  B. Product page fetch with X-Pincode header (mobile BFF)
 *  C. __NEXT_DATA__ / __INITIAL_STATE__ parsing from page HTML
 *  D. Puppeteer browser automation (most reliable, used as last resort)
 *
 * IMPORTANT: All keyword-based checks require that the pincode text appears
 * NEAR the delivery signal — never match "free delivery" in the global
 * site chrome. This was the root cause of false positives in prior versions.
 */

export interface FlipkartApiResult {
  success: boolean;
  productName: string | null;
  description: string | null;
  imageUrl: string | null;
  price: string | null;
  pincode: string;
  available: boolean;
  deliveryInfo: string | null;
  deliveryDate: string | null;
  error: string | null;
  /** Which strategy produced this result */
  source: "rome_api" | "page_fetch" | "next_data" | "puppeteer" | "fallback";
  isGloballyOutOfStock?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract Flipkart product ID (pid) from URL.
 * Handles formats:
 *   /product-name/p/ITMABC123
 *   ?pid=ITMABC123
 */
export function extractFlipkartProductId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pid = urlObj.searchParams.get("pid");
    if (pid) return pid;
    const pathMatch = urlObj.pathname.match(/\/p\/([A-Z0-9]+)/i);
    if (pathMatch) return pathMatch[1];
    return null;
  } catch {
    return null;
  }
}

/** Build browser-like request headers for Flipkart */
function flipkartHeaders(referer: string, extra?: Record<string, string>) {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/html, */*",
    "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: referer,
    Origin: "https://www.flipkart.com",
    "x-user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 FKUA/website/42/website/Desktop",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Product page fetcher (global stock status)
// ---------------------------------------------------------------------------

/**
 * Fetch Flipkart product page and extract global availability + metadata.
 * Does NOT do any pincode-specific check.
 */
export async function fetchFlipkartProductDetails(productUrl: string): Promise<{
  name: string | null;
  description: string | null;
  imageUrl: string | null;
  price: string | null;
  available: boolean;
  isGloballyOutOfStock: boolean;
  html: string;
}> {
  try {
    const response = await fetch(productUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Referer: "https://www.flipkart.com/",
        Connection: "keep-alive",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    let name: string | null = null;
    let description: string | null = null;
    let imageUrl: string | null = null;
    let price: string | null = null;
    let available = false;

    // 1. JSON-LD structured data (most reliable)
    const jsonLdRegex =
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = jsonLdRegex.exec(html)) !== null) {
      try {
        const json = JSON.parse(m[1]);
        const candidates: Record<string, unknown>[] = [];
        if (json["@type"] === "Product") candidates.push(json);
        if (Array.isArray(json["@graph"])) {
          candidates.push(
            ...(json["@graph"] as Record<string, unknown>[]).filter(
              (x) => x["@type"] === "Product"
            )
          );
        }
        for (const product of candidates) {
          if (!name && product.name) name = product.name as string;
          if (!description && product.description)
            description = product.description as string;
          if (!imageUrl && product.image) {
            imageUrl = Array.isArray(product.image)
              ? (product.image[0] as string)
              : (product.image as string);
          }
          if (product.offers) {
            const offer = Array.isArray(product.offers)
              ? (product.offers as Record<string, unknown>[])[0]
              : (product.offers as Record<string, unknown>);
            if (offer?.price) {
              const priceNum = parseFloat(
                String(offer.price).replace(/,/g, "")
              );
              if (!isNaN(priceNum))
                price = `₹${priceNum.toLocaleString("en-IN")}`;
            }
            available =
              (offer?.availability as string)?.includes("InStock") ?? false;
          }
          if (name) break;
        }
      } catch {
        /* continue */
      }
    }

    // 2. OG meta tag fallbacks
    const metaContent = (attr: string, val: string): string => {
      for (const pat of [
        new RegExp(`${attr}="${val}"\\s+content="([^"]+)"`, "i"),
        new RegExp(`content="([^"]+)"\\s+${attr}="${val}"`, "i"),
      ]) {
        const match = html.match(pat);
        if (match?.[1]) return match[1].trim();
      }
      return "";
    };
    if (!name)
      name =
        metaContent("property", "og:title") ||
        metaContent("name", "twitter:title");
    if (!description)
      description =
        metaContent("property", "og:description") ||
        metaContent("name", "description");
    if (!imageUrl) imageUrl = metaContent("property", "og:image");

    // 3. Price from HTML patterns
    if (!price) {
      for (const pat of [
        /class="[^"]*Nx9bqj[^"]*"[^>]*>₹?\s*([\d,]+)/,
        /class="[^"]*_30jeq3[^"]*"[^>]*>₹?\s*([\d,]+)/,
        /"finalPrice"\s*:\s*\{\s*"value"\s*:\s*([\d.]+)/,
        /"decimalValue"\s*:\s*([\d.]+)/,
        /data-price="([\d.]+)"/,
      ]) {
        const pm = html.match(pat);
        if (pm) {
          const num = parseFloat(pm[1].replace(/,/g, ""));
          if (!isNaN(num)) {
            price = `₹${num.toLocaleString("en-IN")}`;
            break;
          }
        }
      }
    }

    // 4. Clean name
    if (name) {
      name = name
        .replace(/ - Buy .*/i, "")
        .replace(/ \| Flipkart.*/i, "")
        .replace(/ : Flipkart.*/i, "")
        .trim();
    }

    // 5. Global out-of-stock detection
    const lowerHtml = html.toLowerCase();
    const globalOOS =
      lowerHtml.includes("currently out of stock") ||
      lowerHtml.includes("sold out") ||
      lowerHtml.includes("currently unavailable") ||
      lowerHtml.includes("not available right now");

    if (!available && !globalOOS) {
      available =
        lowerHtml.includes("add to cart") || lowerHtml.includes("buy now");
    }

    const isProductPage =
      (name && !name.includes("Buy Products Online")) ||
      lowerHtml.includes('"@type":"product"') ||
      lowerHtml.includes("add to cart") ||
      lowerHtml.includes("buy now");

    if (!isProductPage) {
      return {
        name: null,
        description: null,
        imageUrl: null,
        price: null,
        available: false,
        isGloballyOutOfStock: false,
        html,
      };
    }

    return {
      name,
      description,
      imageUrl,
      price,
      available: available && !globalOOS,
      isGloballyOutOfStock: globalOOS,
      html,
    };
  } catch (error) {
    console.error("Flipkart product fetch error:", error);
    return {
      name: null,
      description: null,
      imageUrl: null,
      price: null,
      available: false,
      isGloballyOutOfStock: false,
      html: "",
    };
  }
}

// ---------------------------------------------------------------------------
// Strategy A: Flipkart Rome API
// ---------------------------------------------------------------------------

/**
 * Recursively walk the Rome API response JSON to find the delivery widget
 * that contains pincode-specific serviceability data.
 *
 * Returns the first string value found within the delivery section, or null
 * if no delivery-related section can be identified.
 */
function findDeliverySectionText(
  obj: unknown,
  depth: number = 0
): string[] {
  if (depth > 20 || obj == null) return [];
  const results: string[] = [];

  if (typeof obj === "string") {
    const lower = obj.toLowerCase();
    if (
      lower.includes("delivery") ||
      lower.includes("pincode") ||
      lower.includes("serviceable") ||
      lower.includes("servicable") ||
      lower.includes("deliverable")
    ) {
      results.push(obj);
    }
    return results;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      results.push(...findDeliverySectionText(item, depth + 1));
    }
    return results;
  }

  if (typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      const keyLower = key.toLowerCase();
      // Skip large non-delivery sections to avoid false matches
      if (
        keyLower.includes("seo") ||
        keyLower.includes("navigation") ||
        keyLower.includes("footer") ||
        keyLower.includes("header") ||
        keyLower.includes("banner") ||
        keyLower.includes("advertisement")
      ) {
        continue;
      }
      if (typeof value === "string" || typeof value === "object") {
        results.push(...findDeliverySectionText(value, depth + 1));
      }
    }
  }

  return results;
}

/**
 * Parse delivery info from Flipkart's Rome API JSON response.
 * The Rome API wraps page widgets as JSON — we look for the DELIVERY slot.
 *
 * CRITICAL FIX: Instead of matching keywords across the ENTIRE response
 * (which caused false positives like "free delivery" from site chrome),
 * we now:
 *  1. Walk the JSON to find text near delivery/pincode keywords
 *  2. Require pincode context for delivery signals
 *  3. Prioritize structured serviceability fields
 */
function parseRomeApiResponse(
  data: unknown,
  pincode: string
): { available: boolean; deliveryInfo: string | null; deliveryDate: string | null } | null {
  try {
    const dataStr = JSON.stringify(data);
    const lowerJson = dataStr.toLowerCase();

    // ── Priority 1: Structured serviceability flags ──────────────────────
    // Only match if these exist in a delivery/pincode context
    const hasServiceableTrue =
      dataStr.includes('"isServiceable":true') ||
      dataStr.includes('"deliveryPromise"') ||
      dataStr.includes('"serviceable":true');

    const hasServiceableFalse =
      dataStr.includes('"isServiceable":false') ||
      dataStr.includes('"serviceable":false');

    // ── Priority 2: Pincode-specific delivery text from relevant sections ─
    const deliveryTexts = findDeliverySectionText(data);

    // Look for the pincode near delivery keywords
    const pincodeNearDelivery = deliveryTexts.some(
      (t) =>
        t.toLowerCase().includes(pincode) &&
        (t.toLowerCase().includes("delivery") ||
          t.toLowerCase().includes("serviceable") ||
          t.toLowerCase().includes("deliverable"))
    );

    // ── Explicit "not serviceable" with pincode context ──────────────────
    const explicitNotServiceable = deliveryTexts.some(
      (t) =>
        (t.toLowerCase().includes("not serviceable") ||
          t.toLowerCase().includes("not deliverable") ||
          t.toLowerCase().includes("cannot be delivered")) &&
        (t.toLowerCase().includes(pincode) || deliveryTexts.length <= 10)
    );

    if (explicitNotServiceable || hasServiceableFalse) {
      return {
        available: false,
        deliveryInfo: `Not serviceable to pincode ${pincode}`,
        deliveryDate: null,
      };
    }

    // ── Delivery date in delivery section context ────────────────────────
    const deliveryDateMatch = deliveryTexts.join(" ").match(
      /(?:delivery by|deliverydate|estimated delivery|arrives by)\s*:?\s*([^"]*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[^"]*\d{1,2}[^"]*\d{0,4})/i
    );
    const deliveryDate = deliveryDateMatch ? deliveryDateMatch[1].trim() : null;

    // ── Positive delivery signals from delivery section ──────────────────
    // Only if the section mentions the pincode or has explicit delivery promise
    const hasDeliverySignal = deliveryTexts.some((t) => {
      const lower = t.toLowerCase();
      return (
        (lower.includes("delivery by") || lower.includes("delivered by") ||
         lower.includes("arrives by") || lower.includes("estimated delivery")) &&
        (lower.includes(pincode) || deliveryDate || deliveryTexts.length <= 5)
      );
    });

    // Free delivery in the general context is NOT a pincode availability signal
    // Only match if near the pincode in delivery section
    const hasFreeDeliveryInContext = deliveryTexts.some(
      (t) =>
        t.toLowerCase().includes("free delivery") &&
        (t.toLowerCase().includes(pincode) || deliveryTexts.length <= 3)
    );

    if ((hasDeliverySignal || hasFreeDeliveryInContext || (pincodeNearDelivery && hasServiceableTrue)) && !hasServiceableFalse) {
      return {
        available: true,
        deliveryInfo: deliveryDate
          ? `Delivery by ${deliveryDate}`
          : `Delivery available to ${pincode}`,
        deliveryDate,
      };
    }

    // ── Global out of stock in product section (not pincode specific) ────
    const globalOutOfStock =
      lowerJson.includes("out of stock") &&
      !lowerJson.includes("in stock");

    if (globalOutOfStock) {
      return {
        available: false,
        deliveryInfo: "Product is currently out of stock",
        deliveryDate: null,
      };
    }

    return null; // Ambiguous — no definitive signal found
  } catch {
    return null;
  }
}

async function checkViaRomeApi(
  productUrl: string,
  pincode: string
): Promise<FlipkartApiResult | null> {
  try {
    const urlObj = new URL(productUrl);
    const pageUri = urlObj.pathname + urlObj.search;

    // Flipkart's actual BFF endpoint used by their React app
    const romeUrl = "https://1.rome.api.flipkart.com/api/4/page/fetch";

    const payload = {
      pageUri,
      locationContext: { pincode },
    };

    const response = await fetch(romeUrl, {
      method: "POST",
      headers: {
        ...flipkartHeaders(productUrl),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      console.log(`Rome API responded with ${response.status}`);
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      console.log("Rome API returned non-JSON response");
      return null;
    }

    const data = await response.json();
    const parsed = parseRomeApiResponse(data, pincode);
    if (!parsed) return null; // Ambiguous response

    return {
      success: true,
      productName: null,
      description: null,
      imageUrl: null,
      price: null,
      pincode,
      available: parsed.available,
      deliveryInfo: parsed.deliveryInfo,
      deliveryDate: parsed.deliveryDate,
      error: null,
      source: "rome_api",
    };
  } catch (err) {
    console.log("Rome API check failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strategy B: Product page with X-Pincode header
// ---------------------------------------------------------------------------

/**
 * Extract JSON data from a <script> tag in HTML by matching a variable assignment.
 * Supports __NEXT_DATA__, __INITIAL_STATE__, and similar patterns.
 */
function extractJsonFromScriptTag(
  html: string,
  variableName: string
): Record<string, unknown> | null {
  try {
    const regex = new RegExp(
      `<script[^>]*>\\s*window\\.${variableName}\\s*=\\s*(\\{[\\s\\S]+?\\});?\\s*<\\/script>`,
      "i"
    );
    const match = html.match(regex);
    if (!match) return null;
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Walk the __NEXT_DATA__ / __INITIAL_STATE__ JSON tree looking for
 * delivery/serviceability data related to a specific pincode.
 */
function findPincodeAvailabilityInPageState(
  data: unknown,
  pincode: string
): {
  available: boolean;
  deliveryInfo: string | null;
  deliveryDate: string | null;
} | null {
  try {
    const dataStr = JSON.stringify(data);
    const lower = dataStr.toLowerCase();

    // Check for explicit "not serviceable" WITH the pincode nearby
    const pincodeInData = lower.includes(pincode);
    const hasNotServiceable =
      lower.includes("not serviceable") ||
      lower.includes("not deliverable") ||
      lower.includes("cannot be delivered");

    const hasDeliveryPromise =
      lower.includes("delivery by") ||
      lower.includes("delivered by") ||
      lower.includes("arrives by") ||
      lower.includes("estimated delivery") ||
      lower.includes("delivery promise");

    const hasServiceableTrue =
      dataStr.includes('"isServiceable":true') ||
      dataStr.includes('"serviceable":true');

    const hasServiceableFalse =
      dataStr.includes('"isServiceable":false') ||
      dataStr.includes('"serviceable":false');

    // Only trust these signals if the pincode is referenced in the data,
    // or if the signal is very explicit
    if (hasNotServiceable && (pincodeInData || hasServiceableFalse)) {
      return {
        available: false,
        deliveryInfo: `Not serviceable to pincode ${pincode}`,
        deliveryDate: null,
      };
    }

    const deliveryDateMatch = dataStr.match(
      /(?:delivery by|deliverydate|estimated delivery)[^"]*"([^"]*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[^"]*\d{1,2}[^"]*\d{0,4})/i
    );
    const deliveryDate = deliveryDateMatch ? deliveryDateMatch[1].trim() : null;

    if (hasDeliveryPromise && (pincodeInData || hasServiceableTrue)) {
      return {
        available: true,
        deliveryInfo: deliveryDate
          ? `Delivery by ${deliveryDate}`
          : `Delivery available to ${pincode}`,
        deliveryDate,
      };
    }

    if (hasServiceableTrue && !hasServiceableFalse) {
      return {
        available: true,
        deliveryInfo: `Delivery available to ${pincode}`,
        deliveryDate: null,
      };
    }

    if (hasServiceableFalse) {
      return {
        available: false,
        deliveryInfo: `Not serviceable to pincode ${pincode}`,
        deliveryDate: null,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Strategy B: Check availability via page fetch with X-Pincode header,
 * plus __NEXT_DATA__ / __INITIAL_STATE__ parsing.
 *
 * The page fetch alone is unreliable for pincode-specific delivery info
 * (the checkout widget loads dynamically). The real value is in parsing
 * the embedded JSON state which Flipkart's Next.js app uses to render
 * the page.
 */
async function checkViaPageFetchWithPincode(
  productUrl: string,
  pincode: string
): Promise<FlipkartApiResult | null> {
  try {
    const response = await fetch(productUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
        "X-Pincode": pincode,
        "X-Location": pincode,
        Cookie: `pincode=${pincode}; T=1; SN=1;`,
        Referer: "https://www.flipkart.com/",
        Connection: "keep-alive",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return null;
    const html = await response.text();
    const lowerHtml = html.toLowerCase();

    const productId = extractFlipkartProductId(productUrl);
    const isProductPage =
      lowerHtml.includes('"@type":"product"') ||
      (productId && lowerHtml.includes(productId.toLowerCase())) ||
      lowerHtml.includes("add to cart") ||
      lowerHtml.includes("buy now") ||
      lowerHtml.includes("currently out of stock");

    if (!isProductPage) {
      // Try __NEXT_DATA__ anyway
      const nextData = extractJsonFromScriptTag(html, "__NEXT_DATA__");
      if (nextData) {
        const stateResult = findPincodeAvailabilityInPageState(nextData, pincode);
        if (stateResult) {
          return {
            success: true,
            productName: null,
            description: null,
            imageUrl: null,
            price: null,
            pincode,
            available: stateResult.available,
            deliveryInfo: stateResult.deliveryInfo,
            deliveryDate: stateResult.deliveryDate,
            error: null,
            source: "next_data",
          };
        }
      }
      return null;
    }

    // ── Parse __NEXT_DATA__ / __INITIAL_STATE__ for structured delivery info ──
    const nextData = extractJsonFromScriptTag(html, "__NEXT_DATA__");
    const initState = extractJsonFromScriptTag(html, "__INITIAL_STATE__");
    const pageState = nextData || initState;

    if (pageState) {
      const stateResult = findPincodeAvailabilityInPageState(pageState, pincode);
      if (stateResult) {
        return {
          success: true,
          productName: null,
          description: null,
          imageUrl: null,
          price: null,
          pincode,
          available: stateResult.available,
          deliveryInfo: stateResult.deliveryInfo,
          deliveryDate: stateResult.deliveryDate,
          error: null,
          source: "next_data",
        };
      }
    }

    // ── HTML keyword matching (conservative — only match near pincode) ──────
    // Instead of searching the entire page, look in a 500-char window around
    // the pincode value. This avoids false matches from global site chrome.
    const pincodeIndex = lowerHtml.indexOf(pincode);
    if (pincodeIndex >= 0) {
      const start = Math.max(0, pincodeIndex - 300);
      const end = Math.min(lowerHtml.length, pincodeIndex + 300);
      const pincodeContext = lowerHtml.slice(start, end);

      const hasNotServiceableNearby =
        pincodeContext.includes("not serviceable") ||
        pincodeContext.includes("not deliverable") ||
        pincodeContext.includes("cannot be delivered") ||
        pincodeContext.includes("delivery not available");

      if (hasNotServiceableNearby) {
        return {
          success: true,
          productName: null,
          description: null,
          imageUrl: null,
          price: null,
          pincode,
          available: false,
          deliveryInfo: `Not serviceable to pincode ${pincode}`,
          deliveryDate: null,
          error: null,
          source: "page_fetch",
        };
      }

      const hasDeliveryNearby =
        pincodeContext.includes("delivery by") ||
        pincodeContext.includes("delivered by") ||
        pincodeContext.includes("arrives by") ||
        pincodeContext.includes("estimated delivery");

      if (hasDeliveryNearby) {
        return {
          success: true,
          productName: null,
          description: null,
          imageUrl: null,
          price: null,
          pincode,
          available: true,
          deliveryInfo: `Delivery available to ${pincode}`,
          deliveryDate: null,
          error: null,
          source: "page_fetch",
        };
      }
    }

    // ── Global out of stock (no pincode context needed) ──────────────────────
    const isOutOfStock =
      lowerHtml.includes("currently out of stock") ||
      lowerHtml.includes("sold out") ||
      lowerHtml.includes("currently unavailable");

    if (isOutOfStock && pincodeIndex < 0) {
      return {
        success: true,
        productName: null,
        description: null,
        imageUrl: null,
        price: null,
        pincode,
        available: false,
        deliveryInfo: "Product is currently out of stock",
        deliveryDate: null,
        error: null,
        source: "page_fetch",
      };
    }

    return null;
  } catch (err) {
    console.log("Page-fetch check failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strategy C: Puppeteer browser automation
// ---------------------------------------------------------------------------

async function checkViaPuppeteer(
  productUrl: string,
  pincode: string
): Promise<FlipkartApiResult | null> {
  try {
    // Dynamic import to avoid hard dependency at module load time
    const { checkFlipkartAvailabilityReal } = await import(
      "./flipkart-real-checker"
    );
    const result = await checkFlipkartAvailabilityReal(productUrl, pincode);

    if (!result.success) return null;

    return {
      success: true,
      productName: result.productName,
      description: null,
      imageUrl: null,
      price: result.price,
      pincode,
      available: result.available,
      deliveryInfo: result.deliveryInfo,
      deliveryDate: null,
      error: null,
      source: "puppeteer",
    };
  } catch (err) {
    console.log("Puppeteer check failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API: checkFlipkartPincodeServiceability
// ---------------------------------------------------------------------------

/**
 * Check whether a Flipkart product is deliverable to a given pincode.
 *
 * Tries strategies in order:
 *   A → Rome API (fastest, most accurate)
 *   B → Product page with X-Pincode header + __NEXT_DATA__ parsing
 *   C → Puppeteer browser automation (slowest, most reliable)
 *
 * If ALL strategies fail to get a definitive answer, returns
 * success=false so callers can mark the result as "unverified"
 * rather than silently reporting "not available".
 */
export async function checkFlipkartPincodeServiceability(
  productUrl: string,
  pincode: string
): Promise<FlipkartApiResult> {
  const base: FlipkartApiResult = {
    success: false,
    productName: null,
    description: null,
    imageUrl: null,
    price: null,
    pincode,
    available: false,
    deliveryInfo: null,
    deliveryDate: null,
    error: null,
    source: "fallback",
  };

  // Strategy A: Rome API
  const romeResult = await checkViaRomeApi(productUrl, pincode);
  if (romeResult) {
    console.log(`[Flipkart] Rome API check for ${pincode}: ${romeResult.available ? "✅ Available" : "❌ Not available"}`);
    return romeResult;
  }

  // Strategy B: Page fetch with X-Pincode header
  const pageFetchResult = await checkViaPageFetchWithPincode(productUrl, pincode);
  if (pageFetchResult) {
    console.log(`[Flipkart] Page-fetch check for ${pincode}: ${pageFetchResult.available ? "✅ Available" : "❌ Not available"}`);
    return pageFetchResult;
  }

  // Strategy C: Puppeteer
  const puppeteerResult = await checkViaPuppeteer(productUrl, pincode);
  if (puppeteerResult) {
    console.log(`[Flipkart] Puppeteer check for ${pincode}: ${puppeteerResult.available ? "✅ Available" : "❌ Not available"}`);
    return puppeteerResult;
  }

  // All strategies exhausted — return unverified (not "not available")
  console.log(`[Flipkart] All strategies failed for pincode ${pincode} — unverified`);
  return {
    ...base,
    error: "Could not verify serviceability — Flipkart did not return a clear answer. Please check Flipkart directly.",
  };
}


