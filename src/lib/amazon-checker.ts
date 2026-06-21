import { fetchWithProxy } from "./scrapingbee";

export interface AmazonCheckResult {
  available: boolean;
  deliveryInfo: string | null;
  productName: string | null;
  price: string | null;
  description: string | null;
  imageUrl: string | null;
  source: "api" | "fallback";
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T | null>, retries = 2): Promise<T | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      const result = await fn();
      if (result !== null && result !== undefined) return result;
    } catch {
      // Retry
    }
    if (i < retries) await delay([200, 500][i] || 500);
  }
  return null;
}

async function checkAmazonAjax(
  asin: string,
  pincode: string,
  useProxy: boolean
): Promise<AmazonCheckResult | null> {
  const apiUrl = `https://www.amazon.in/gp/product/ajax?asin=${asin}&deviceType=web&buyingShowHideCheckoutButton=0&merchantId=&locationId=${pincode}&ie=UTF8&action=display&featureId=glow-ingress-itm-offer`;
  const fetchFn = useProxy && process.env.SCRAPINGBEE_API_KEY ? fetchWithProxy : fetch;
  const resp = await fetchFn(apiUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html, */*; q=0.01",
      "Accept-Language": "en-IN,en;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `https://www.amazon.in/dp/${asin}`,
    },
    signal: AbortSignal.timeout(8_000),
  });

  if (!resp.ok) return null;

  const html = await resp.text();
  const lowerHtml = html.toLowerCase();

  const explicitNotAvailable =
    lowerHtml.includes("doesn't deliver") ||
    lowerHtml.includes("not available in") ||
    lowerHtml.includes("this item cannot be shipped") ||
    lowerHtml.includes("not serviceable") ||
    lowerHtml.includes("delivery not available") ||
    lowerHtml.includes("we cannot deliver");

  const deliveryDateOrPromise =
    lowerHtml.includes("delivery by") ||
    lowerHtml.includes("delivery on") ||
    lowerHtml.includes("arrives by") ||
    lowerHtml.includes("free delivery") ||
    lowerHtml.includes("get it by");

  const available = deliveryDateOrPromise && !explicitNotAvailable;

  const deliveryMatch = html.match(
    /(?:delivery|arrives)\s+(on|by)\s+([A-Z][a-z]+[\s,\d]+)/i
  );
  return {
    available,
    deliveryInfo: deliveryMatch
      ? `Delivery ${deliveryMatch[1]} ${deliveryMatch[2].trim()}`
      : explicitNotAvailable
      ? "Not deliverable to this pincode"
      : deliveryDateOrPromise
      ? "Delivery available to this pincode"
      : null,
    productName: null,
    price: null,
    description: null,
    imageUrl: null,
    source: "api",
  };
}

async function checkAmazonPage(
  productUrl: string,
  useProxy: boolean
): Promise<AmazonCheckResult | null> {
  const fetchFn = useProxy && process.env.SCRAPINGBEE_API_KEY ? fetchWithProxy : fetch;
  const resp = await fetchFn(productUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-IN,en;q=0.9",
      Cookie: "i18n-prefs=INR; lc-acbin=en_IN; gl=IN;",
      Referer: "https://www.amazon.in/",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;

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
}

export async function checkAmazonAvailability(
  productUrl: string,
  pincode: string
): Promise<AmazonCheckResult> {
  const asinMatch =
    productUrl.match(/\/dp\/([A-Z0-9]{10})/i) ||
    productUrl.match(/\/gp\/product\/([A-Z0-9]{10})/i);
  const asin = asinMatch ? asinMatch[1] : null;

  // Strategy A: Amazon AJAX location API
  if (asin) {
    await delay(200);
    // Try via proxy first, then direct
    let ajaxResult: AmazonCheckResult | null = null;
    if (process.env.SCRAPINGBEE_API_KEY) {
      ajaxResult = await withRetry(() => checkAmazonAjax(asin, pincode, true));
    }
    if (!ajaxResult) {
      ajaxResult = await withRetry(() => checkAmazonAjax(asin, pincode, false));
    }
    if (ajaxResult) return ajaxResult;
  }

  await delay(500);

  // Strategy B: Fetch product page
  let pageResult: AmazonCheckResult | null = null;
  if (process.env.SCRAPINGBEE_API_KEY) {
    pageResult = await withRetry(() => checkAmazonPage(productUrl, true));
  }
  if (!pageResult) {
    pageResult = await withRetry(() => checkAmazonPage(productUrl, false));
  }
  if (pageResult) return pageResult;

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
