import { extractFlipkartProductId } from "./flipkart-api-checker";
import { fetchWithProxy } from "./scrapingbee";

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
  source: "rome_api" | "page_fetch" | "next_data" | "puppeteer" | "fallback";
  isGloballyOutOfStock?: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T | null>, retries = 0): Promise<T | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      const result = await fn();
      if (result !== null && result !== undefined) return result;
    } catch {
      // Ignore and retry
    }
    if (i < retries) await delay(500);
  }
  return null;
}

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

function parseRomeApiResponse(
  data: unknown,
  pincode: string
): { available: boolean; deliveryInfo: string | null; deliveryDate: string | null } | null {
  try {
    const dataStr = JSON.stringify(data);
    const lowerJson = dataStr.toLowerCase();

    const hasServiceableTrue =
      dataStr.includes('"isServiceable":true') ||
      dataStr.includes('"deliveryPromise"') ||
      dataStr.includes('"serviceable":true');

    const hasServiceableFalse =
      dataStr.includes('"isServiceable":false') ||
      dataStr.includes('"serviceable":false');

    const deliveryTexts = findDeliverySectionText(data);

    const pincodeNearDelivery = deliveryTexts.some(
      (t) =>
        t.toLowerCase().includes(pincode) &&
        (t.toLowerCase().includes("delivery") ||
          t.toLowerCase().includes("serviceable") ||
          t.toLowerCase().includes("deliverable"))
    );

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

    const deliveryDateMatch = deliveryTexts.join(" ").match(
      /(?:delivery by|deliverydate|estimated delivery|arrives by)\s*:?\s*([^"]*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[^"]*\d{1,2}[^"]*\d{0,4})/i
    );
    const deliveryDate = deliveryDateMatch ? deliveryDateMatch[1].trim() : null;

    const hasDeliverySignal = deliveryTexts.some((t) => {
      const lower = t.toLowerCase();
      return (
        (lower.includes("delivery by") || lower.includes("delivered by") ||
         lower.includes("arrives by") || lower.includes("estimated delivery")) &&
        (lower.includes(pincode) || deliveryDate || deliveryTexts.length <= 5)
      );
    });

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

    return null;
  } catch {
    return null;
  }
}

async function romeApiFetch(
  productUrl: string,
  pincode: string,
  useProxy: boolean
): Promise<FlipkartApiResult | null> {
  const urlObj = new URL(productUrl);
  const pageUri = urlObj.pathname + urlObj.search;

  const romeUrl = "https://1.rome.api.flipkart.com/api/4/page/fetch";

  const payload = {
    pageUri,
    locationContext: { pincode },
  };

  const fetchFn = useProxy && process.env.SCRAPINGBEE_API_KEY ? fetchWithProxy : fetch;
  const response = await fetchFn(romeUrl, {
    method: "POST",
    headers: {
      ...flipkartHeaders(productUrl),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(4_000),
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
  if (!parsed) return null;

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
}

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

async function pageFetchWithPincode(
  productUrl: string,
  pincode: string,
  useProxy: boolean
): Promise<FlipkartApiResult | null> {
  const fetchFn = useProxy && process.env.SCRAPINGBEE_API_KEY ? fetchWithProxy : fetch;
  const response = await fetchFn(productUrl, {
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
    signal: AbortSignal.timeout(6_000),
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

  // In-stock fallback: the page has "Buy Now" or "Add to Cart" buttons
  // but we couldn't find pincode-specific delivery info (Flipkart renders
  // it dynamically via JS after page load). The product IS available —
  // we just can't verify pincode delivery from the static HTML.
  const hasBuySignal =
    lowerHtml.includes("add to cart") ||
    lowerHtml.includes("buy now");

  if (hasBuySignal && !isOutOfStock) {
    return {
      success: true,
      productName: null,
      description: null,
      imageUrl: null,
      price: null,
      pincode,
      available: true,
      deliveryInfo: `Available on Flipkart — check delivery for pincode ${pincode} on the product page`,
      deliveryDate: null,
      error: null,
      source: "page_fetch",
    };
  }

  return null;
}

async function checkViaPuppeteer(
  productUrl: string,
  pincode: string
): Promise<FlipkartApiResult | null> {
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
}

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

  // Run Rome API and Page Fetch in parallel; return first non-null result
  async function firstSuccess<T>(promises: Promise<T | null>[]): Promise<T | null> {
    return new Promise((resolve) => {
      let settled = 0;
      for (const p of promises) {
        p.then((r) => {
          if (r !== null && r !== undefined) resolve(r);
        }).catch(() => {});
        p.finally(() => {
          settled++;
          if (settled === promises.length) resolve(null);
        });
      }
    });
  }

  const romePromise = process.env.SCRAPINGBEE_API_KEY
    ? withRetry(() => romeApiFetch(productUrl, pincode, true))
    : withRetry(() => romeApiFetch(productUrl, pincode, false));

  const pagePromise = process.env.SCRAPINGBEE_API_KEY
    ? withRetry(() => pageFetchWithPincode(productUrl, pincode, true))
    : withRetry(() => pageFetchWithPincode(productUrl, pincode, false));

  const winner = await firstSuccess([romePromise, pagePromise]);
  if (winner) {
    console.log(`[Flipkart] Strategy succeeded for ${pincode}: ${winner.available ? "✅ Available" : "❌ Not available"}`);
    return winner;
  }

  // If both parallel strategies failed, try Puppeteer as last resort
  try {
    const puppeteerResult = await checkViaPuppeteer(productUrl, pincode);
    if (puppeteerResult) {
      console.log(`[Flipkart] Puppeteer check for ${pincode}: ${puppeteerResult.available ? "✅ Available" : "❌ Not available"}`);
      return puppeteerResult;
    }
  } catch {
    console.log("Puppeteer import failed, skipping");
  }

  console.log(`[Flipkart] All strategies failed for pincode ${pincode} — unverified`);
  return {
    ...base,
    error: "Could not verify serviceability — Flipkart did not return a clear answer. Please check Flipkart directly.",
  };
}
