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
 * Check Flipkart product availability for a pincode
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
    
    // Set viewport and user agent
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Block images and unnecessary resources for speed
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const resourceType = request.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Navigate to product page
    console.log(`Navigating to: ${productUrl}`);
    await page.goto(productUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait for page to load
    await page.waitForSelector("body", { timeout: 10000 });

    // Get product name
    let productName: string | null = null;
    try {
      productName = await page.$eval("h1", (el) => el.textContent?.trim() || null);
      if (!productName) {
        productName = await page.$eval(
          'span[class*="B_NuCI"]',
          (el) => el.textContent?.trim() || null
        );
      }
    } catch {
      // Try to get from title
      const title = await page.title();
      productName = title.split(" - Buy")[0].split("|")[0].trim();
    }

    // Get price
    let price: string | null = null;
    try {
      price = await page.$eval(
        'div[class*="dyC4hf"] > div:first-child, div[class*="_30jeq3"]',
        (el) => el.textContent?.trim() || null
      );
    } catch {
      // Price not found
    }

    // Check if out of stock
    let outOfStock = false;
    try {
      const outOfStockEl = await page.$('div:has-text("currently out of stock")');
      outOfStock = !!outOfStockEl;
    } catch {
      // Not out of stock
    }

    if (outOfStock) {
      return {
        success: true,
        productName,
        pincode,
        available: false,
        deliveryInfo: "Product is out of stock",
        price,
        error: null,
        method: "browser",
      };
    }

    // Find pincode input and enter pincode
    try {
      // Try multiple selectors for pincode input
      const pincodeSelectors = [
        '#pincodeInputId',
        'input[placeholder*="pincode" i]',
        'input[class*="cfnctZ"]',
        'input[data-testid="pincode-input"]',
      ];

      let pincodeInput = null;
      for (const selector of pincodeSelectors) {
        try {
          pincodeInput = await page.$(selector);
          if (pincodeInput) break;
        } catch {
          continue;
        }
      }

      if (!pincodeInput) {
        // Try clicking the delivery dropdown first
        const deliveryDropdown = await page.$('span:has-text("Deliver to")');
        if (deliveryDropdown) {
          await deliveryDropdown.click();
          await new Promise(r => setTimeout(r, 1000));
          
          // Try again
          for (const selector of pincodeSelectors) {
            try {
              pincodeInput = await page.$(selector);
              if (pincodeInput) break;
            } catch {
              continue;
            }
          }
        }
      }

      if (!pincodeInput) {
        return {
          success: false,
          productName,
          pincode,
          available: false,
          deliveryInfo: null,
          price,
          error: "Could not find pincode input field",
          method: "browser",
        };
      }

      // Clear and enter pincode
      await pincodeInput.click({ count: 3 });
      await page.keyboard.press("Backspace");
      await pincodeInput.type(pincode, { delay: 50 });

      // Find and click check button
      const checkButton = await page.$('span:has-text("Check")');
      if (checkButton) {
        await checkButton.click();
        await new Promise(r => setTimeout(r, 2000));
      } else {
        // Try pressing Enter
        await page.keyboard.press("Enter");
        await new Promise(r => setTimeout(r, 2000));
      }

      // Check for availability messages
      const pageContent = await page.content();
      
      const notAvailablePatterns = [
        "currently out of stock",
        "not available",
        "no seller",
        "not serviceable",
        "cannot be delivered",
        "delivery not available",
      ];

      const isNotAvailable = notAvailablePatterns.some((pattern) =>
        pageContent.toLowerCase().includes(pattern)
      );

      // Try to get delivery info
      let deliveryInfo: string | null = null;
      try {
        const deliveryEl = await page.$('div[class*="delivery"]');
        if (deliveryEl) {
          deliveryInfo = await page.evaluate((el) => el.textContent?.trim() || null, deliveryEl);
        }
      } catch {
        // Delivery info not found
      }

      return {
        success: true,
        productName,
        pincode,
        available: !isNotAvailable,
        deliveryInfo: isNotAvailable ? "Not deliverable to this pincode" : (deliveryInfo || "Delivery available"),
        price,
        error: null,
        method: "browser",
      };
    } catch (error) {
      return {
        success: false,
        productName,
        pincode,
        available: false,
        deliveryInfo: null,
        price,
        error: `Error checking delivery: ${error instanceof Error ? error.message : "Unknown error"}`,
        method: "browser",
      };
    }
  } catch (error) {
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
