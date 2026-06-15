import { detectPlatform } from "@/lib/platform";
import {
  fetchFlipkartProductDetails,
  extractFlipkartProductId,
} from "@/lib/flipkart-api-checker";

export const dynamic = "force-dynamic";

/**
 * Generic product metadata scraper using HTTP fetch with proper headers
 * Works with Flipkart, Amazon India, and other e-commerce sites
 */
async function scrapeWithFetch(url: string, platform: string) {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };

  if (platform === "flipkart") {
    headers["Referer"] = "https://www.flipkart.com/";
    headers["Cookie"] = "T=1; SN=1;";
  } else if (platform === "amazon_india") {
    headers["Referer"] = "https://www.amazon.in/";
    headers["Cookie"] = "i18n-prefs=INR; lc-acbin=en_IN; gl=IN;";
  }

  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  return html;
}

function extractFromHtml(html: string, platform: string) {
  let name = "";
  let description = "";
  let imageUrl = "";
  let price = "";

  // === 1. JSON-LD Structured Data (most reliable across all sites) ===
  const jsonLdRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch;
  while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      const json = JSON.parse(jsonLdMatch[1]);
      const products = [];

      if (json["@type"] === "Product") products.push(json);
      if (Array.isArray(json["@graph"])) {
        products.push(...json["@graph"].filter((item: { "@type": string }) => item["@type"] === "Product"));
      }

      for (const product of products) {
        if (!name && product.name) name = product.name;
        if (!description && product.description) description = product.description;
        if (!imageUrl && product.image) {
          imageUrl = Array.isArray(product.image) ? product.image[0] : product.image;
        }
        if (!price && product.offers) {
          const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
          if (offer?.price) price = `₹${Math.round(offer.price).toLocaleString("en-IN")}`;
          else if (offer?.lowPrice) price = `₹${Math.round(offer.lowPrice).toLocaleString("en-IN")}`;
        }
        if (name) break;
      }
    } catch {
      // Continue to next tag
    }
  }

  // === 2. Open Graph Meta Tags ===
  const getMeta = (attrs: string[]): string => {
    for (const attr of attrs) {
      // property="og:title" content="..."
      let m = html.match(new RegExp(`property="${attr}"\\s+content="([^"]+)"`, "i")) ||
               html.match(new RegExp(`content="([^"]+)"\\s+property="${attr}"`, "i")) ||
               html.match(new RegExp(`name="${attr}"\\s+content="([^"]+)"`, "i")) ||
               html.match(new RegExp(`content="([^"]+)"\\s+name="${attr}"`, "i"));
      if (m?.[1]) return m[1].trim();
    }
    return "";
  };

  if (!name) name = getMeta(["og:title", "twitter:title"]);
  if (!description) description = getMeta(["og:description", "description", "Description"]);
  if (!imageUrl) imageUrl = getMeta(["og:image", "twitter:image"]);

  // === 3. Platform-specific selectors via regex ===
  if (platform === "flipkart") {
    // Flipkart price via regex (div.Nx9bqj or ._30jeq3)
    if (!price) {
      const priceMatch = html.match(/class="[^"]*Nx9bqj[^"]*"[^>]*>₹?([\d,]+)/i) ||
        html.match(/class="[^"]*_30jeq3[^"]*"[^>]*>₹?([\d,]+)/i) ||
        html.match(/"finalPrice"\s*:\s*\{\s*"value"\s*:\s*([\d.]+)/i) ||
        html.match(/"decimalValue"\s*:\s*([\d.]+)/i);
      if (priceMatch) price = `₹${Number(priceMatch[1].replace(/,/g, "")).toLocaleString("en-IN")}`;
    }

    // Try Flipkart's __INITIAL_STATE__ data for product details
    const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]+?\});?\s*<\/script>/);
    if (stateMatch) {
      try {
        const state = JSON.parse(stateMatch[1]);
        // Extract product data from Flipkart state
        const findProduct = (obj: unknown): Record<string, unknown> | null => {
          if (!obj || typeof obj !== "object") return null;
          const o = obj as Record<string, unknown>;
          if (o.productId && o.title) return o;
          for (const val of Object.values(o)) {
            const found = findProduct(val);
            if (found) return found;
          }
          return null;
        };

        const product = findProduct(state);
        if (product) {
          if (!name && product.title) name = String(product.title);
          if (!price && product.price) price = `₹${String(product.price)}`;
        }
      } catch {
        // Ignore parse errors
      }
    }
  } else if (platform === "amazon_india") {
    // Amazon title
    if (!name) {
      const titleMatch = html.match(/id="productTitle"[^>]*>\s*([\s\S]*?)\s*<\/span>/i);
      if (titleMatch) name = titleMatch[1].trim();
    }

    // Amazon price
    if (!price) {
      const priceMatch = html.match(/class="a-price-whole"[^>]*>([0-9,]+)/i);
      if (priceMatch) price = `₹${priceMatch[1].replace(/,/g, "")}`;
    }

    // Amazon image
    if (!imageUrl) {
      const imgMatch = html.match(/"large":"(https:[^"]+)"/);
      if (imgMatch) imageUrl = imgMatch[1];
    }

    // Amazon description from bullets
    if (!description) {
      const bulletsContent = html.match(/id="feature-bullets"[\s\S]*?<ul[\s\S]*?>([\s\S]*?)<\/ul>/i);
      if (bulletsContent) {
        const bullets = [...bulletsContent[1].matchAll(/<span[^>]*class="a-list-item"[^>]*>([\s\S]*?)<\/span>/gi)];
        const texts = bullets
          .map((b) => b[1].replace(/<[^>]+>/g, "").trim())
          .filter((t) => t.length > 5)
          .slice(0, 4);
        if (texts.length) description = texts.join(" • ");
      }
    }
  }

  // === 4. Page title fallback ===
  if (!name) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) name = titleMatch[1].trim();
  }

  // === 5. Clean up ===
  if (name) {
    // Remove common suffixes
    name = name
      .replace(/ - Buy .*/i, "")
      .replace(/ \| Flipkart.*/i, "")
      .replace(/ : Amazon.*/i, "")
      .replace(/ - Amazon.*/i, "")
      .replace(/ \| Amazon.*/i, "")
      .replace(/ - Flipkart.*/i, "")
      .trim();
  }

  // Check if we ended up with homepage content (not a real product)
  const isHomepage =
    description.includes("Leading E-commerce Company") ||
    description.includes("Buy Products Online at Best Price") ||
    name.includes("Buy Products Online at Best Price") ||
    name.includes("Online Shopping India");

  return {
    name: isHomepage ? "" : name,
    description: isHomepage ? "" : description,
    imageUrl,
    price,
    isHomepage,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return Response.json({ error: "Product URL is required" }, { status: 400 });
    }

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return Response.json({ error: "Invalid URL format" }, { status: 400 });
    }

    const platform = detectPlatform(url);

    let name = "";
    let description = "";
    let imageUrl = "";
    let price = "";
    let success = false;
    let method = "fetch";

    // === Flipkart-specific path: use dedicated fetcher ===
    if (platform === "flipkart") {
      try {
        const details = await fetchFlipkartProductDetails(url);
        if (details.name) {
          name = details.name;
          description = details.description || "";
          imageUrl = details.imageUrl || "";
          price = details.price || "";
          success = true;
          method = "flipkart-api";
        }
      } catch (err) {
        console.error("Flipkart dedicated fetch failed:", err);
      }
    }

    // === Generic fetch fallback for all platforms ===
    if (!success) {
      try {
        const html = await scrapeWithFetch(url, platform);
        const extracted = extractFromHtml(html, platform);

        if (extracted.name && !extracted.isHomepage) {
          name = extracted.name;
          description = extracted.description;
          imageUrl = extracted.imageUrl;
          price = extracted.price;
          success = true;
          method = "fetch";
        } else if (extracted.isHomepage) {
          // Product page blocked, return partial info
          success = false;
        }
      } catch (err) {
        console.error("Generic scrape failed:", err);
      }
    }

    // === Last resort: extract from URL itself ===
    if (!success || !name) {
      try {
        // Decode product name from URL slug
        const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
        // Most e-commerce URLs: /category/product-name-variant/p/ID
        const productSlug = pathParts.find(
          (part) => part.length > 10 && !part.startsWith("p") && !part.match(/^[A-Z0-9]{10,}$/)
        );
        if (productSlug) {
          const decodedName = decodeURIComponent(productSlug)
            .replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase())
            .trim();
          if (!name) name = decodedName;
          if (!description) description = `Product available on ${platform === "flipkart" ? "Flipkart" : platform === "amazon_india" ? "Amazon India" : "this platform"}. Click the link to see full details.`;
          success = true;
          method = "url-parse";
        }
      } catch {
        // Ignore
      }
    }

    return Response.json({
      success,
      name: name || "Product (details unavailable)",
      description: description || "",
      imageUrl: imageUrl || "",
      price: price || "",
      platform,
      method,
    });
  } catch (error) {
    console.error("Scraping error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to scrape product info" },
      { status: 500 }
    );
  }
}
