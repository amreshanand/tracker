/**
 * Flipkart Product Availability Checker
 * 
 * This module provides functions to check real product availability on Flipkart.
 * 
 * IMPORTANT: Flipkart doesn't have a public API for delivery checks.
 * The only reliable methods are:
 * 
 * 1. Browser Automation (Puppeteer/Playwright) - Most reliable but slow
 * 2. Direct API calls (can break anytime as they're internal APIs)
 * 
 * For production Chrome Extension, you would inject content scripts
 * that interact with the actual Flipkart page to get real data.
 */

export interface FlipkartProductInfo {
  name: string;
  currentPrice: number | null;
  originalPrice: number | null;
  discount: string;
  shareUrl: string;
  fassured: boolean;
  inStock: boolean;
}

export interface FlipkartAvailability {
  product: FlipkartProductInfo | null;
  pincode: string;
  available: boolean;
  deliveryDate: string | null;
  error: string | null;
}

/**
 * Extract product ID from Flipkart URL
 */
export function extractFlipkartProductId(url: string): string | null {
  try {
    // Flipkart URLs can be in multiple formats:
    // https://www.flipkart.com/product-name/p/itm123abc
    // https://dl.flipkart.com/s/AbCdEf
    // https://www.flipkart.com/product?pid=XXXXX
    
    const urlObj = new URL(url);
    
    // Check for /p/itm format
    const pMatch = url.match(/\/p\/([a-zA-Z0-9]+)/);
    if (pMatch) {
      return pMatch[1];
    }
    
    // Check for pid parameter
    const pid = urlObj.searchParams.get("pid");
    if (pid) {
      return pid;
    }
    
    // Short URL format - the ID is in the path
    if (urlObj.hostname === "dl.flipkart.com") {
      const pathParts = urlObj.pathname.split("/");
      return pathParts[pathParts.length - 1] || null;
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Flipkart internal serviceability check endpoint
 * WARNING: This is an internal API and may break without notice
 * 
 * For production, use browser automation or Chrome Extension content scripts
 */
export async function checkFlipkartAvailabilityDirect(
  productUrl: string,
  pincode: string
): Promise<FlipkartAvailability> {
  // This is a placeholder for the real implementation
  // The actual Flipkart serviceability check requires:
  // 1. Valid session/cookies
  // 2. Correct headers (User-Agent, etc.)
  // 3. CSRF tokens in some cases
  
  // For a real implementation, you would need to:
  // Option A: Use Puppeteer/Playwright (server-side)
  // Option B: Use a scraping service like ScrapingBee or Browserless
  // Option C: In Chrome Extension, inject content script to check directly
  
  return {
    product: null,
    pincode,
    available: false,
    deliveryDate: null,
    error: "Direct API checking requires browser automation. See documentation for setup.",
  };
}

/**
 * For Chrome Extension implementation:
 * This function would be called from the content script
 * that has access to the actual Flipkart page
 */
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
  productName: string;
  price: string;
}

/**
 * Instructions for Chrome Extension implementation:
 * 
 * 1. In manifest.json, add content_scripts for flipkart.com
 * 2. Content script finds the pincode input field
 * 3. Enters the pincode and clicks "Check"
 * 4. Parses the delivery response
 * 5. Sends result back to extension popup via chrome.runtime.sendMessage
 * 
 * Example content script pseudocode:
 * 
 * ```javascript
 * async function checkDelivery(pincode) {
 *   const pincodeInput = document.querySelector('#pincodeInputId');
 *   if (!pincodeInput) return { available: false, error: 'Input not found' };
 *   
 *   pincodeInput.value = '';
 *   pincodeInput.value = pincode;
 *   pincodeInput.dispatchEvent(new Event('input', { bubbles: true }));
 *   
 *   const checkBtn = document.querySelector('span[contains(text(), "Check")]');
 *   checkBtn?.click();
 *   
 *   await new Promise(r => setTimeout(r, 2000));
 *   
 *   const notAvailable = document.querySelector('[contains(text(), "out of stock")]');
 *   const deliveryInfo = document.querySelector('.delivery-message');
 *   
 *   return {
 *     available: !notAvailable,
 *     deliveryInfo: deliveryInfo?.textContent || null,
 *   };
 * }
 * ```
 */

/**
 * Parse Flipkart product page for basic info
 * This can be done server-side with a simple fetch for public pages
 */
export async function getFlipkartProductBasicInfo(
  productUrl: string
): Promise<{ name: string; price: string | null } | null> {
  try {
    const response = await fetch(productUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // Extract product name from title or og:title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const ogTitleMatch = html.match(
      /<meta property="og:title" content="([^"]+)"/i
    );
    const name =
      ogTitleMatch?.[1] ||
      titleMatch?.[1]?.split(" - Buy")[0]?.split("|")[0]?.trim() ||
      "Unknown Product";

    // Try to extract price from JSON-LD or meta tags
    const priceMatch = html.match(/"price":\s*"?(\d+)"?/);
    const price = priceMatch ? `₹${priceMatch[1]}` : null;

    return { name, price };
  } catch (error) {
    console.error("Error fetching Flipkart product info:", error);
    return null;
  }
}
