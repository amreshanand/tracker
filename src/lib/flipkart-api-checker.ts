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
 *  C. Puppeteer browser automation (most reliable, used as last resort)
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
  source: "rome_api" | "page_fetch" | "puppeteer" | "fallback";
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
 * Parse delivery info from Flipkart's Rome API JSON response.
 * The Rome API wraps page widgets as JSON — we look for the DELIVERY slot.
 */
function parseRomeApiResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  pincode: string
): { available: boolean; deliveryInfo: string | null; deliveryDate: string | null } | null {
  try {
    // The response is a deeply nested widget tree. We flatten and search.
    const json = JSON.stringify(data).toLowerCase();

    // Explicit not-serviceable signals
    const notServiceableKeywords = [
      "not serviceable",
      "not deliverable",
      "cannot be delivered",
      "no sellers deliver",
      "pincode is not serviceable",
      "delivery not available",
      "doesn't deliver to",
      "does not deliver to",
    ];
    if (notServiceableKeywords.some((k) => json.includes(k))) {
      return {
        available: false,
        deliveryInfo: `Not serviceable to pincode ${pincode}`,
        deliveryDate: null,
      };
    }

    // Look for delivery date patterns in the raw JSON
    const deliveryDateMatch = JSON.stringify(data).match(
      /(?:delivery by|deliverydate|estimated delivery)[^"]*"([^"]*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[^"]*\d{1,2}[^"]*\d{0,4})/i
    );
    const deliveryDate = deliveryDateMatch ? deliveryDateMatch[1].trim() : null;

    // Positive delivery signals
    const deliverableKeywords = [
      "delivery by",
      "free delivery",
      "arrives by",
      "estimated delivery",
      "delivery in",
      "delivered by",
    ];
    if (deliverableKeywords.some((k) => json.includes(k))) {
      return {
        available: true,
        deliveryInfo: deliveryDate
          ? `Delivery by ${deliveryDate}`
          : `Delivery available to ${pincode}`,
        deliveryDate,
      };
    }

    // Check for serviceability flags in structured data
    const dataStr = JSON.stringify(data);
    if (
      dataStr.includes('"isServiceable":true') ||
      dataStr.includes('"serviceable":true') ||
      dataStr.includes('"available":true')
    ) {
      return {
        available: true,
        deliveryInfo: `Delivery available to ${pincode}`,
        deliveryDate: null,
      };
    }
    if (
      dataStr.includes('"isServiceable":false') ||
      dataStr.includes('"serviceable":false')
    ) {
      return {
        available: false,
        deliveryInfo: `Not serviceable to pincode ${pincode}`,
        deliveryDate: null,
      };
    }

    // Out of stock signals
    if (
      json.includes("out of stock") ||
      json.includes("currently unavailable") ||
      json.includes("sold out")
    ) {
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

async function checkViaPageFetchWithPincode(
  productUrl: string,
  pincode: string
): Promise<FlipkartApiResult | null> {
  try {
    // Flipkart's mobile BFF respects X-Pincode and renders delivery info in HTML
    const response = await fetch(productUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
        "X-Pincode": pincode,
        "X-Location": pincode,
        // Cookie pincode value — some Flipkart servers still honour this
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

    // Verify we got the actual product page
    const productId = extractFlipkartProductId(productUrl);
    const isProductPage =
      lowerHtml.includes('"@type":"product"') ||
      (productId && lowerHtml.includes(productId.toLowerCase())) ||
      lowerHtml.includes("add to cart") ||
      lowerHtml.includes("buy now") ||
      lowerHtml.includes("currently out of stock");

    if (!isProductPage) return null;

    // Not-serviceable patterns
    const notServiceable = [
      "not serviceable",
      "not deliverable",
      "delivery not available",
      "cannot be delivered",
      "pin code is not serviceable",
      "pincode is not serviceable",
      "no sellers deliver to this pincode",
      "this product is not available in your area",
      "seller does not deliver to your location",
    ].some((p) => lowerHtml.includes(p));

    if (notServiceable) {
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

    // Delivery-available patterns
    const deliverablePatterns = [
      "delivery by",
      "delivered by",
      "free delivery",
      "arrives by",
      "estimated delivery",
      "delivery in",
    ];
    const isDeliverable = deliverablePatterns.some((p) => lowerHtml.includes(p));

    if (isDeliverable) {
      const deliveryDateMatch = html.match(
        /[Dd]elivery\s+by[^<>"]{0,60}?([A-Z][a-z]+\s+\d+)/
      );
      const deliveryDate = deliveryDateMatch ? deliveryDateMatch[1] : null;
      return {
        success: true,
        productName: null,
        description: null,
        imageUrl: null,
        price: null,
        pincode,
        available: true,
        deliveryInfo: deliveryDate
          ? `Delivery by ${deliveryDate}`
          : `Delivery available to ${pincode}`,
        deliveryDate,
        error: null,
        source: "page_fetch",
      };
    }

    const isOutOfStock =
      lowerHtml.includes("currently out of stock") ||
      lowerHtml.includes("sold out") ||
      lowerHtml.includes("currently unavailable");

    if (isOutOfStock) {
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

    // Page loaded but no delivery signal — ambiguous, return null so next strategy runs
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
 *   B → Product page with X-Pincode header
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

// ---------------------------------------------------------------------------
// Amazon India availability check
// ---------------------------------------------------------------------------

export async function checkAmazonAvailability(
  productUrl: string,
  pincode: string
): Promise<{
  available: boolean;
  deliveryInfo: string | null;
  productName: string | null;
  price: string | null;
  description: string | null;
  imageUrl: string | null;
  source: "api" | "fallback";
}> {
  const asinMatch =
    productUrl.match(/\/dp\/([A-Z0-9]{10})/i) ||
    productUrl.match(/\/gp\/product\/([A-Z0-9]{10})/i);
  const asin = asinMatch ? asinMatch[1] : null;

  // Strategy A: Amazon's AJAX location API
  if (asin) {
    try {
      const apiUrl = `https://www.amazon.in/gp/product/ajax?asin=${asin}&deviceType=web&buyingShowHideCheckoutButton=0&merchantId=&locationId=${pincode}&ie=UTF8&action=display&featureId=glow-ingress-itm-offer`;
      const resp = await fetch(apiUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html, */*; q=0.01",
          "Accept-Language": "en-IN,en;q=0.9",
          "X-Requested-With": "XMLHttpRequest",
          Referer: productUrl,
        },
        signal: AbortSignal.timeout(8_000),
      });

      if (resp.ok) {
        const html = await resp.text();
        const lowerHtml = html.toLowerCase();
        const notAvailable =
          lowerHtml.includes("doesn't deliver") ||
          lowerHtml.includes("not available in") ||
          lowerHtml.includes("this item cannot be shipped") ||
          lowerHtml.includes("not serviceable");
        const hasDelivery =
          lowerHtml.includes("delivery") || lowerHtml.includes("arrives");
        const available = !notAvailable && hasDelivery;

        const deliveryMatch = html.match(
          /delivery\s+(on|by)\s+([A-Z][a-z]+[\s,\d]+)/i
        );
        return {
          available,
          deliveryInfo: deliveryMatch
            ? `Delivery ${deliveryMatch[1]} ${deliveryMatch[2].trim()}`
            : available
            ? "Delivery available"
            : "Not deliverable to this pincode",
          productName: null,
          price: null,
          description: null,
          imageUrl: null,
          source: "api",
        };
      }
    } catch (err) {
      console.log("Amazon API check failed:", err);
    }
  }

  // Strategy B: Fetch product page
  try {
    const resp = await fetch(productUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
        Cookie: `i18n-prefs=INR; lc-acbin=en_IN; gl=IN;`,
        Referer: "https://www.amazon.in/",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await resp.text();
    const lowerHtml = html.toLowerCase();

    let name: string | null = null;
    let price: string | null = null;
    let imageUrl: string | null = null;
    let description: string | null = null;

    const titleMatch = html.match(/id="productTitle"[^>]*>\s*([\s\S]*?)\s*<\/span>/i);
    if (titleMatch) name = titleMatch[1].trim();

    const priceMatch = html.match(/class="a-price-whole"[^>]*>([0-9,]+)/i);
    if (priceMatch) price = `₹${priceMatch[1].replace(/,/g, "")}`;

    const imgMatch = html.match(/"large":"(https:[^"]+)"/);
    if (imgMatch) imageUrl = imgMatch[1];

    const bulletsMatch = html.match(
      /id="feature-bullets"[\s\S]*?<ul[\s\S]*?>([\s\S]*?)<\/ul>/i
    );
    if (bulletsMatch) {
      const bullets = [
        ...bulletsMatch[1].matchAll(
          /<span[^>]*class="a-list-item"[^>]*>([\s\S]*?)<\/span>/gi
        ),
      ];
      const texts = bullets
        .map((b) => b[1].replace(/<[^>]+>/g, "").trim())
        .filter((t) => t.length > 5)
        .slice(0, 4);
      if (texts.length) description = texts.join(" • ");
    }

    const available =
      (lowerHtml.includes("add to cart") || lowerHtml.includes("buy now")) &&
      !lowerHtml.includes("currently unavailable") &&
      !lowerHtml.includes("out of stock");

    return {
      available,
      deliveryInfo: available
        ? "Available on Amazon India"
        : "Currently unavailable",
      productName: name,
      price,
      description,
      imageUrl,
      source: "fallback",
    };
  } catch {
    return {
      available: false,
      deliveryInfo: null,
      productName: null,
      price: null,
      description: null,
      imageUrl: null,
      source: "fallback",
    };
  }
}
