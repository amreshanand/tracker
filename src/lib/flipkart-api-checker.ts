/**
 * Flipkart Real Availability Checker via API
 *
 * Strategy:
 * 1. Fetch product page to determine global stock status & product details
 * 2. For pincode-specific delivery checks, use Flipkart's internal
 *    serviceability widget API (real, not simulated)
 *
 * Note: Flipkart blocks Puppeteer/headless browsers. We use targeted HTTP
 * requests with appropriate headers to their API endpoints instead.
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
  error: string | null;
  source: "api" | "fallback" | "simulated";
  isGloballyOutOfStock?: boolean;
}

/**
 * Extract Flipkart product ID from URL
 * Flipkart URLs: /product-name/p/ITMABC123 or ?pid=ITMABC123
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

/**
 * Fetch Flipkart product details + global availability from product page
 * Returns whether the product is in stock at all (before pincode check)
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
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: "https://www.flipkart.com/",
    Connection: "keep-alive",
  };

  try {
    const response = await fetch(productUrl, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    let name: string | null = null;
    let description: string | null = null;
    let imageUrl: string | null = null;
    let price: string | null = null;
    let available = false;

    // 1. JSON-LD structured data (most reliable)
    const jsonLdRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = jsonLdRegex.exec(html)) !== null) {
      try {
        const json = JSON.parse(m[1]);
        const candidates = [];
        if (json["@type"] === "Product") candidates.push(json);
        if (Array.isArray(json["@graph"])) {
          candidates.push(...json["@graph"].filter((x: { "@type": string }) => x["@type"] === "Product"));
        }
        for (const product of candidates) {
          if (!name && product.name) name = product.name;
          if (!description && product.description) description = product.description;
          if (!imageUrl && product.image) {
            imageUrl = Array.isArray(product.image) ? product.image[0] : product.image;
          }
          if (product.offers) {
            const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
            if (offer?.price) {
              const priceNum = parseFloat(String(offer.price).replace(/,/g, ""));
              if (!isNaN(priceNum)) price = `₹${priceNum.toLocaleString("en-IN")}`;
            }
            available = offer?.availability?.includes("InStock") ?? false;
          }
          if (name) break;
        }
      } catch { /* continue */ }
    }

    // 2. OG meta tags fallback
    const getMetaContent = (attr: string, val: string): string => {
      const patterns = [
        new RegExp(`${attr}="${val}"\\s+content="([^"]+)"`, "i"),
        new RegExp(`content="([^"]+)"\\s+${attr}="${val}"`, "i"),
      ];
      for (const p of patterns) {
        const match = html.match(p);
        if (match?.[1]) return match[1].trim();
      }
      return "";
    };

    if (!name) name = getMetaContent("property", "og:title") || getMetaContent("name", "twitter:title");
    if (!description) description = getMetaContent("property", "og:description") || getMetaContent("name", "description");
    if (!imageUrl) imageUrl = getMetaContent("property", "og:image");

    // 3. Price patterns in HTML
    if (!price) {
      const pricePat = [
        /class="[^"]*Nx9bqj[^"]*"[^>]*>₹?\s*([\d,]+)/,
        /class="[^"]*_30jeq3[^"]*"[^>]*>₹?\s*([\d,]+)/,
        /"finalPrice"\s*:\s*\{\s*"value"\s*:\s*([\d.]+)/,
        /"decimalValue"\s*:\s*([\d.]+)/,
        /data-price="([\d.]+)"/,
      ];
      for (const pat of pricePat) {
        const pm = html.match(pat);
        if (pm) {
          const num = parseFloat(pm[1].replace(/,/g, ""));
          if (!isNaN(num)) { price = `₹${num.toLocaleString("en-IN")}`; break; }
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

    // 5. Detect global out-of-stock (before any pincode check)
    const lowerHtml = html.toLowerCase();
    const globalOOS =
      lowerHtml.includes("currently out of stock") ||
      lowerHtml.includes("sold out") ||
      lowerHtml.includes("currently unavailable") ||
      lowerHtml.includes("not available right now");

    // If JSON-LD didn't set available, check for cart/buy signals
    if (!available && !globalOOS) {
      available =
        lowerHtml.includes("add to cart") ||
        lowerHtml.includes("buy now");
    }

    // 6. Check if we even got the product page (not Flipkart homepage redirect)
    const isProductPage =
      (name && !name.includes("Buy Products Online")) ||
      lowerHtml.includes('"@type":"product"') ||
      lowerHtml.includes("add to cart") ||
      lowerHtml.includes("buy now");

    if (!isProductPage) {
      return { name: null, description: null, imageUrl: null, price: null, available: false, isGloballyOutOfStock: false, html };
    }

    return { name, description, imageUrl, price, available: available && !globalOOS, isGloballyOutOfStock: globalOOS, html };
  } catch (error) {
    console.error("Flipkart product fetch error:", error);
    return { name: null, description: null, imageUrl: null, price: null, available: false, isGloballyOutOfStock: false, html: "" };
  }
}

/**
 * Check Flipkart pincode serviceability using their internal widget API.
 *
 * Flipkart's serviceability widget endpoint:
 *   POST https://www.flipkart.com/api/4/page/fetch
 *   with pageUri (product page slug) and pincode cookie
 *
 * Also tries their delivery pincode check widget directly.
 */
export async function checkFlipkartPincodeServiceability(
  productUrl: string,
  pincode: string,
  productHtml?: string  // Pass pre-fetched HTML to avoid redundant requests
): Promise<FlipkartApiResult> {
  const productId = extractFlipkartProductId(productUrl);

  const result: FlipkartApiResult = {
    success: false,
    productName: null,
    description: null,
    imageUrl: null,
    price: null,
    pincode,
    available: false,
    deliveryInfo: null,
    error: null,
    source: "api",
  };

  // ─── Strategy 1: Flipkart's internal serviceability check API ───────────
  // Flipkart uses this endpoint to check if a product can be delivered to a pincode.
  // It requires the listing ID (lid) from the URL.
  const urlObj = new URL(productUrl);
  const lid = urlObj.searchParams.get("lid");
  const otracker = urlObj.searchParams.get("otracker");

  // Build the serviceability check URL using Flipkart's widget API
  // Their internal API checks serviceability for the seller/listing
  if (productId) {
    // Method A: Flipkart's delivery check endpoint (used by their own website)
    const checkUrl = `https://www.flipkart.com/api/4/product/delivery?pid=${productId}&pincode=${pincode}${lid ? `&lid=${lid}` : ""}`;

    try {
      const apiResponse = await fetch(checkUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-IN,en;q=0.9",
          Referer: productUrl,
          "x-user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 FKUA/website/42/website/Desktop",
        },
        signal: AbortSignal.timeout(8000),
      });

      if (apiResponse.ok) {
        const contentType = apiResponse.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = await apiResponse.json();
          // Parse various response shapes from Flipkart API
          const deliveryData =
            data?.data?.deliveryInfo ||
            data?.deliveryInfo ||
            data?.serviceabilityInfo;

          if (deliveryData !== undefined) {
            const isDeliverable =
              deliveryData?.isDeliverable ??
              deliveryData?.available ??
              (data?.statusCode === 200 && !data?.errorMessage);

            result.available = Boolean(isDeliverable);
            result.deliveryInfo = deliveryData?.message ||
              deliveryData?.deliveryMessage ||
              (result.available ? `Deliverable to ${pincode}` : `Not serviceable to ${pincode}`);
            result.success = true;
            result.source = "api";
            return result;
          }
        }
      }
    } catch (err) {
      console.log("Flipkart API endpoint A failed:", err);
    }

    // Method B: Flipkart's page widget serviceability check
    // This fetches the delivery widget HTML which shows real serviceability
    try {
      const widgetUrl = `https://www.flipkart.com/api/4/widget/page?pageUri=${encodeURIComponent(urlObj.pathname + urlObj.search)}&pincode=${pincode}&pid=${productId}`;

      const widgetResponse = await fetch(widgetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json, text/html, */*",
          "Accept-Language": "en-IN,en;q=0.9",
          Referer: productUrl,
        },
        signal: AbortSignal.timeout(8000),
      });

      if (widgetResponse.ok) {
        const text = await widgetResponse.text();
        const lowerText = text.toLowerCase();

        const notServiceable = [
          "not serviceable", "not deliverable", "delivery not available",
          "cannot be delivered", "pincode is not serviceable",
          "no sellers deliver to this pincode",
        ].some(p => lowerText.includes(p));

        if (notServiceable) {
          result.available = false;
          result.deliveryInfo = `Not serviceable to pincode ${pincode}`;
          result.success = true;
          result.source = "api";
          return result;
        }

        const isDeliverable = ["delivery by", "free delivery", "arrives by", "estimated delivery"]
          .some(p => lowerText.includes(p));

        if (isDeliverable) {
          result.available = true;
          result.deliveryInfo = `Delivery available to ${pincode}`;
          result.success = true;
          result.source = "api";
          return result;
        }
      }
    } catch (err) {
      console.log("Flipkart widget API failed:", err);
    }
  }

  // ─── Strategy 2: Fetch product page with pincode cookie set ─────────────
  // Setting the pincode cookie causes Flipkart to show delivery info for that location
  try {
    const pageResponse = await fetch(productUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
        // Setting pincode cookie is how Flipkart determines your delivery location
        Cookie: `pincode=${pincode}; T=1; SN=1; _session_id=1;`,
        Referer: "https://www.flipkart.com/",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    if (!pageResponse.ok) throw new Error(`HTTP ${pageResponse.status}`);
    const html = await pageResponse.text();
    const lowerHtml = html.toLowerCase();

    // Verify this is the actual product page, not homepage redirect
    const isProductPage =
      lowerHtml.includes('"@type":"product"') ||
      (productId && lowerHtml.includes(productId.toLowerCase())) ||
      lowerHtml.includes("add to cart") ||
      lowerHtml.includes("buy now") ||
      lowerHtml.includes("currently out of stock");

    if (!isProductPage) {
      result.error = "Redirected to Flipkart homepage — real check unavailable";
      result.source = "fallback";
      // Cannot determine serviceability without actual product page
      return result;
    }

    // Check for explicit not-serviceable signals
    const notServiceablePatterns = [
      "not serviceable",
      "not deliverable",
      "delivery not available",
      "cannot be delivered",
      "pin code is not serviceable",
      "pincode is not serviceable",
      "no sellers deliver to this pincode",
      "this product is not available in your area",
      "seller does not deliver to your location",
    ];
    const notServiceable = notServiceablePatterns.some(p => lowerHtml.includes(p));

    // Check for delivery available signals
    const deliverablePatterns = [
      "delivery by",
      "delivered by",
      "free delivery",
      "arrives by",
      "estimated delivery",
      "delivery in",
    ];
    const isDeliverable = deliverablePatterns.some(p => lowerHtml.includes(p));

    // Check global out-of-stock (different from serviceability)
    const isOutOfStock =
      lowerHtml.includes("currently out of stock") ||
      lowerHtml.includes("sold out") ||
      lowerHtml.includes("currently unavailable");

    if (notServiceable) {
      result.available = false;
      result.deliveryInfo = `Not serviceable to pincode ${pincode}`;
    } else if (isDeliverable) {
      result.available = true;
      const deliveryDateMatch = html.match(/[Dd]elivery by[^<>"]{0,50}?([A-Z][a-z]+ \d+)/);
      result.deliveryInfo = deliveryDateMatch
        ? `Delivery by ${deliveryDateMatch[1]}`
        : `Delivery available to ${pincode}`;
    } else if (isOutOfStock) {
      result.available = false;
      result.deliveryInfo = "Product is currently out of stock";
    } else {
      // Ambiguous — page loaded but no clear delivery signal found
      // This likely means Flipkart didn't honor the cookie pincode
      result.available = false;
      result.deliveryInfo = null;
      result.error = "Serviceability unclear — Flipkart requires login for accurate pincode check";
      result.source = "fallback";
      return result;
    }

    result.success = true;
    result.source = "fallback";
    return result;
  } catch (error) {
    result.error = `Check failed: ${error instanceof Error ? error.message : "Unknown error"}`;
    return result;
  }
}

/**
 * Amazon India serviceability check
 */
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

  // Amazon delivery check via their location API
  if (asin) {
    try {
      const apiUrl = `https://www.amazon.in/gp/product/ajax?asin=${asin}&deviceType=web&buyingShowHideCheckoutButton=0&merchantId=&locationId=${pincode}&ie=UTF8&action=display&featureId=glow-ingress-itm-offer`;
      const resp = await fetch(apiUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html, */*; q=0.01",
          "Accept-Language": "en-IN,en;q=0.9",
          "X-Requested-With": "XMLHttpRequest",
          Referer: productUrl,
        },
        signal: AbortSignal.timeout(8000),
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

        const deliveryMatch = html.match(/delivery\s+(on|by)\s+([A-Z][a-z]+[\s,\d]+)/i);
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

  // Fallback: fetch product page
  try {
    const resp = await fetch(productUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
        Cookie: `i18n-prefs=INR; lc-acbin=en_IN; gl=IN;`,
        Referer: "https://www.amazon.in/",
      },
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

    const bulletsMatch = html.match(/id="feature-bullets"[\s\S]*?<ul[\s\S]*?>([\s\S]*?)<\/ul>/i);
    if (bulletsMatch) {
      const bullets = [...bulletsMatch[1].matchAll(/<span[^>]*class="a-list-item"[^>]*>([\s\S]*?)<\/span>/gi)];
      const texts = bullets.map(b => b[1].replace(/<[^>]+>/g, "").trim()).filter(t => t.length > 5).slice(0, 4);
      if (texts.length) description = texts.join(" • ");
    }

    const available =
      (lowerHtml.includes("add to cart") || lowerHtml.includes("buy now")) &&
      !lowerHtml.includes("currently unavailable") &&
      !lowerHtml.includes("out of stock");

    return {
      available,
      deliveryInfo: available ? "Available on Amazon India" : "Currently unavailable",
      productName: name,
      price,
      description,
      imageUrl,
      source: "fallback",
    };
  } catch {
    return { available: false, deliveryInfo: null, productName: null, price: null, description: null, imageUrl: null, source: "fallback" };
  }
}
