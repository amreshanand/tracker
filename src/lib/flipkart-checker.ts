/**
 * Flipkart URL Utilities
 *
 * Lightweight helpers for working with Flipkart product URLs.
 * The actual serviceability checking logic lives in flipkart-api-checker.ts.
 */

/**
 * Extract product ID from Flipkart URL.
 * Handles formats:
 *   https://www.flipkart.com/product-name/p/ITMABC123
 *   https://www.flipkart.com/product?pid=XXXXX
 *   https://dl.flipkart.com/s/AbCdEf  (short URL)
 */
export function extractFlipkartProductId(url: string): string | null {
  try {
    const urlObj = new URL(url);

    // Check for ?pid= query parameter
    const pid = urlObj.searchParams.get("pid");
    if (pid) return pid;

    // Check for /p/itm format in path
    const pMatch = url.match(/\/p\/([a-zA-Z0-9]+)/);
    if (pMatch) return pMatch[1];

    // Short URL format (dl.flipkart.com)
    if (urlObj.hostname === "dl.flipkart.com") {
      const parts = urlObj.pathname.split("/");
      return parts[parts.length - 1] || null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check whether a URL is a valid Flipkart product URL.
 */
export function isFlipkartProductUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const isFlipkartDomain =
      urlObj.hostname === "www.flipkart.com" ||
      urlObj.hostname === "flipkart.com" ||
      urlObj.hostname === "dl.flipkart.com";
    if (!isFlipkartDomain) return false;
    const hasProductId = !!extractFlipkartProductId(url);
    return hasProductId;
  } catch {
    return false;
  }
}

/**
 * Normalise a Flipkart product URL by removing tracking parameters,
 * keeping only the essential product identifiers.
 */
export function normaliseFlipkartUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pid = urlObj.searchParams.get("pid");
    const lid = urlObj.searchParams.get("lid");

    // Rebuild with only essential params
    const cleanUrl = new URL(urlObj.origin + urlObj.pathname);
    if (pid) cleanUrl.searchParams.set("pid", pid);
    if (lid) cleanUrl.searchParams.set("lid", lid);
    return cleanUrl.toString();
  } catch {
    return url;
  }
}

// ── Types for Chrome Extension content-script integration ──────────────────
// These interfaces define the message protocol between the extension popup
// and content scripts injected into Flipkart product pages.

export interface ContentScriptCheckRequest {
  type: "CHECK_AVAILABILITY";
  pincode: string;
  productUrl: string;
}

export interface ContentScriptCheckResponse {
  type: "AVAILABILITY_RESULT";
  pincode: string;
  available: boolean;
  deliveryInfo: string | null;
  deliveryDate: string | null;
  productName: string;
  price: string;
}
