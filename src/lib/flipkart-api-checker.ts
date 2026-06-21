/**
 * Flipkart Product Data + URL utilities
 */

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
