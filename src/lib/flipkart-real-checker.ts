/**
 * Flipkart Real Availability Checker
 * 
 * This module provides REAL availability checking using browser automation.
 * It actually visits the Flipkart page and checks the delivery availability.
 * 
 * Method: Uses Puppeteer to automate a headless browser
 */

import type { Browser, Page } from "puppeteer-core";

let browserInstance: Browser | null = null;

export interface FlipkartCheckResult {
  success: boolean;
  productName: string | null;
  pincode: string;
  available: boolean;
  deliveryInfo: string | null;
  price: string | null;
  error: string | null;
  method: "browser" | "fallback";
}

/**
 * Get or create browser instance
 */
export async function getBrowser(): Promise<Browser | null> {

  if (browserInstance) {
    try {
      // Check if browser is still connected
      const pages = await browserInstance.pages();
      if (pages.length >= 0) {
        return browserInstance;
      }
    } catch {
      browserInstance = null;
    }
  }

  try {
    // Dynamic import to avoid build issues
    const puppeteer = await import("puppeteer-core");
    
    // Try to find chromium
    let executablePath: string | undefined;
    
    // Try common paths
    const paths = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      process.env.CHROME_PATH,
    ].filter(Boolean) as string[];

    for (const path of paths) {
      try {
        const fs = await import("fs");
        if (fs.existsSync(path)) {
          executablePath = path;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!executablePath) {
      console.log("No Chrome/Chromium found. Browser automation unavailable.");
      return null;
    }

    browserInstance = await puppeteer.default.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
      ],
    });

    return browserInstance;
  } catch (error) {
    console.error("Failed to launch browser:", error);
    return null;
  }
}

/**
 * Check Flipkart product availability for a pincode using real browser automation.
 *
 * This is the ONLY strategy that can give 100% accurate pincode-level
 * results because the delivery checker on Flipkart is a JavaScript widget
 * that renders dynamically — it cannot be extracted from static HTML.
 *
 * We use Puppeteer to:
 *  1. Open the product page
 *  2. Wait for the delivery checker widget to load
 *  3. Enter the pincode
 *  4. Read the serviceability response
 */
export async function checkFlipkartAvailabilityReal(
  productUrl: string,
  pincode: string
): Promise<FlipkartCheckResult> {
  let page: Page | null = null;

  try {
    const browser = await getBrowser();
    
    if (!browser) {
      return {
        success: false,
        productName: null,
        pincode,
        available: false,
        deliveryInfo: null,
        price: null,
        error: "Browser automation not available. Chrome/Chromium not found.",
        method: "fallback",
      };
    }

    page = await browser.newPage();
    
    // Set viewport and user agent — use mobile viewport for simpler page structure
    await page.setViewport({ width: 414, height: 896 });
    await page.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    );

    // Only block images for speed
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.resourceType() === "image") {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Navigate to product page
    console.log(`[Puppeteer] Navigating to: ${productUrl}`);
    await page.goto(productUrl, {
      waitUntil: "networkidle0",
      timeout: 30000,
    });

    // Wait for essential elements to render
    await page.waitForSelector("body", { timeout: 10000 });

    // ── Get product name ──────────────────────────────────────────────
    let productName: string | null = null;
    try {
      productName = await page.evaluate(() => {
        const h1 = document.querySelector("h1");
        if (h1?.textContent) return h1.textContent.trim();
        const title = document.title;
        return title.split(" - Buy")[0].split("|")[0].replace(/Buy\s+/i, "").trim();
      });
    } catch {
      const title = await page.title();
      productName = title.split(" - Buy")[0].split("|")[0].trim();
    }

    // ── Get price ─────────────────────────────────────────────────────
    let price: string | null = null;
    try {
      price = await page.evaluate(() => {
        const selectors = [
          'div[class*="Nx9bqj"]',
          'div[class*="_30jeq3"]',
          '[class*="price"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el?.textContent?.trim()) return el.textContent.trim();
        }
        return null;
      });
    } catch {
      // Price not found
    }

    // ── Check if globally out of stock ────────────────────────────────
    const pageText = await page.evaluate(() => document.body?.innerText?.toLowerCase() || "");
    
    const globalOOSKeywords = [
      "currently out of stock",
      "sold out",
      "currently unavailable",
      "not available right now",
    ];
    const isGloballyOOS = globalOOSKeywords.some((k) => pageText.includes(k));

    if (isGloballyOOS) {
      console.log(`[Puppeteer] Product is globally out of stock`);
      await page.close();
      page = null;
      return {
        success: true,
        productName,
        pincode,
        available: false,
        deliveryInfo: "Product is out of stock (unavailable everywhere)",
        price,
        error: null,
        method: "browser",
      };
    }

    // ── Find the pincode input and check delivery ─────────────────────
    // On mobile viewport the pincode checker is usually a simple form at
    // the top or bottom of the page.
    console.log(`[Puppeteer] Looking for pincode input...`);

    // Strategy: Use evaluate to find the input and interact with it
    const pincodeCheckResult = await page.evaluate(async (targetPincode: string) => {
      // Try to find the pincode input using multiple strategies
      const findInput = (): HTMLInputElement | null => {
        // Strategy 1: input with pincode-related placeholder
        const inputs = Array.from(document.querySelectorAll('input'));
        for (const input of inputs) {
          const ph = (input.placeholder || "").toLowerCase();
          if (ph.includes("pincode") || ph.includes("pin code") || ph.includes("enter delivery") || ph.includes("delivery pincode")) {
            return input;
          }
        }
        // Strategy 2: input near "deliver to" or "check" text
        const allElements = Array.from(document.querySelectorAll('*'));
        for (const el of allElements) {
          const text = (el.textContent || "").toLowerCase();
          if (text.includes("deliver to") || text.includes("check delivery")) {
            const nearbyInput = el.closest('div, section')?.querySelector('input');
            if (nearbyInput) return nearbyInput;
          }
        }
        // Strategy 3: any text input that accepts 6 digits
        for (const input of inputs) {
          if (input.type === "text" || input.type === "number") {
            const maxLen = parseInt(input.maxLength + "", 10) || 0;
            if (maxLen >= 6 && (input.className.toLowerCase().includes("pincode") || input.id.toLowerCase().includes("pincode"))) {
              return input;
            }
          }
        }
        return null;
      };

      const pincodeInput = findInput();
      if (!pincodeInput) {
        // Try clicking on "change" or "deliver to" button first
        const clickables = Array.from(document.querySelectorAll('span, button, div[role="button"]'));
        for (const el of clickables) {
          const text = (el.textContent || "").toLowerCase();
          if (text.includes("deliver to") || text.includes("change") || text.includes("check delivery")) {
            (el as HTMLElement).click();
            break;
          }
        }
        
        // Wait for any dynamic content to appear
        await new Promise(r => setTimeout(r, 1500));
        
        // Try again
        const retryInput = findInput();
        if (!retryInput) {
          return { found: false, error: "Could not find pincode input field on page" };
        }
        
        // Clear and type pincode
        retryInput.value = "";
        retryInput.focus();
        // Simulate typing
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, "value"
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(retryInput, targetPincode);
          retryInput.dispatchEvent(new Event('input', { bubbles: true }));
          retryInput.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          retryInput.value = targetPincode;
        }
        
        await new Promise(r => setTimeout(r, 500));
        
        // Find and click the "Check" / submit button
        const buttons = Array.from(document.querySelectorAll('button, span, [role="button"]'));
        for (const btn of buttons) {
          const btnText = (btn.textContent || "").toLowerCase().trim();
          if (btnText === "check" || btnText.startsWith("check") || btnText.includes("submit")) {
            (btn as HTMLElement).click();
            await new Promise(r => setTimeout(r, 2000));
            break;
          }
        }
        
        // Wait for delivery result to appear
        await new Promise(r => setTimeout(r, 1500));
        
        const pageTextNow = document.body?.innerText || "";
        return {
          found: true,
          text: pageTextNow,
          usedExistingInput: true,
        };
      }

      // Clear and type pincode
      pincodeInput.value = "";
      pincodeInput.focus();
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      )?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(pincodeInput, targetPincode);
        pincodeInput.dispatchEvent(new Event('input', { bubbles: true }));
        pincodeInput.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        pincodeInput.value = targetPincode;
      }

      await new Promise(r => setTimeout(r, 500));

      // Find and click the "Check" / submit button
      const buttons = Array.from(document.querySelectorAll('button, span, [role="button"]'));
      let clicked = false;
      for (const btn of buttons) {
        const btnText = (btn.textContent || "").toLowerCase().trim();
        if (btnText === "check" || btnText.startsWith("check") || btnText.includes("submit")) {
          (btn as HTMLElement).click();
          clicked = true;
          await new Promise(r => setTimeout(r, 2000));
          break;
        }
      }

      // If no check button found, try pressing Enter
      if (!clicked) {
        pincodeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        pincodeInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
        pincodeInput.dispatchEvent(new Event('submit', { bubbles: true }));
        await new Promise(r => setTimeout(r, 2000));
      }

      // Wait for result to render
      await new Promise(r => setTimeout(r, 1500));

      const pageText = document.body?.innerText || "";
      return { found: true, text: pageText, usedExistingInput: false };
    }, pincode);

    if (!pincodeCheckResult.found || !pincodeCheckResult.text) {
      await page.close();
      page = null;
      return {
        success: false,
        productName,
        pincode,
        available: false,
        deliveryInfo: null,
        price,
        error: pincodeCheckResult.error || "Could not interact with pincode checker",
        method: "browser",
      };
    }

    // ── Parse the delivery result ─────────────────────────────────────
    const resultText = pincodeCheckResult.text.toLowerCase();

    // Positive delivery signals (take priority)
    const deliverySignals = [
      "delivery by",
      "delivered by",
      "free delivery",
      "arrives by",
      "get it by",
      "estimated delivery",
      "delivery in",
    ];
    const hasDelivery = deliverySignals.some((s) => resultText.includes(s));

    // Explicit not-available signals
    const notAvailable = [
      "not serviceable",
      "not deliverable",
      "cannot be delivered",
      "delivery not available",
      "no seller",
      "this pincode is not serviceable",
      "doesn't deliver",
    ];
    const isNotAvailable = notAvailable.some((s) => resultText.includes(s));

    // Out of stock
    const isOOS = globalOOSKeywords.some((s) => resultText.includes(s));

    // Try to extract delivery date
    let deliveryInfo: string | null = null;
    const deliveryDateMatch = resultText.match(
      /(?:delivery|arrives)\s+(?:by|on|in)\s+([a-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*\d{4})?)/i
    );

    if (hasDelivery && !isNotAvailable && !isOOS) {
      deliveryInfo = deliveryDateMatch
        ? `Delivery ${deliveryDateMatch[0]}`
        : `Delivery available to ${pincode}`;
      console.log(`[Puppeteer] ✅ Available at ${pincode}: ${deliveryInfo}`);
      await page.close();
      page = null;
      return {
        success: true,
        productName,
        pincode,
        available: true,
        deliveryInfo,
        price,
        error: null,
        method: "browser",
      };
    }

    if (isNotAvailable || isOOS) {
      deliveryInfo = isOOS
        ? "Product is currently out of stock"
        : `Not deliverable to pincode ${pincode}`;
      console.log(`[Puppeteer] ❌ Not available at ${pincode}: ${deliveryInfo}`);
      await page.close();
      page = null;
      return {
        success: true,
        productName,
        pincode,
        available: false,
        deliveryInfo,
        price,
        error: null,
        method: "browser",
      };
    }

    // Ambiguous — page loaded but couldn't find clear delivery signal
    console.log(`[Puppeteer] ⚠️ Ambiguous result for ${pincode}`);
    await page.close();
    page = null;
    return {
      success: false,
      productName,
      pincode,
      available: false,
      deliveryInfo: null,
      price,
      error: "Opened page but could not find a clear delivery answer. The page layout may have changed.",
      method: "browser",
    };
  } catch (error) {
    console.error("[Puppeteer] Error:", error);
    return {
      success: false,
      productName: null,
      pincode,
      available: false,
      deliveryInfo: null,
      price: null,
      error: `Browser error: ${error instanceof Error ? error.message : "Unknown error"}`,
      method: "browser",
    };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

/**
 * Close browser instance (call on server shutdown)
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {
      // Ignore close errors
    }
    browserInstance = null;
  }
}

/**
 * Check if browser automation is available
 */
export async function isBrowserAvailable(): Promise<boolean> {
  try {
    const browser = await getBrowser();
    return browser !== null;
  } catch {
    return false;
  }
}
