import { checkFlipkartAvailabilityReal, isBrowserAvailable } from "@/lib/flipkart-real-checker";
import { detectPlatform } from "@/lib/platform";
import { lookupPincodeFromIndiaPost } from "@/lib/india-post-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60 seconds for browser automation

/**
 * Real availability check using browser automation
 * This endpoint actually visits Flipkart/Amazon and checks delivery availability
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { productUrl, pincode } = body;

    if (!productUrl || !pincode) {
      return Response.json(
        { error: "Product URL and pincode are required" },
        { status: 400 }
      );
    }

    // Validate pincode
    if (!/^\d{6}$/.test(pincode)) {
      return Response.json(
        { error: "Invalid pincode format. Must be 6 digits." },
        { status: 400 }
      );
    }

    // Get real pincode details
    const pincodeDetails = await lookupPincodeFromIndiaPost(pincode);

    const platform = detectPlatform(productUrl);

    // Check if browser automation is available
    const browserAvailable = await isBrowserAvailable();

    if (!browserAvailable) {
      return Response.json({
        success: false,
        error: "Browser automation not available. Chrome/Chromium not installed.",
        browserAvailable: false,
        suggestion: "Deploy to a server with Chrome installed, or use the Chrome Extension approach.",
        pincodeDetails: pincodeDetails ? {
          pincode: pincodeDetails.pincode,
          isValid: pincodeDetails.isValid,
          district: pincodeDetails.district,
          state: pincodeDetails.state,
        } : null,
      });
    }

    // Only Flipkart is supported currently
    if (platform !== "flipkart") {
      return Response.json({
        success: false,
        error: `Real checking for ${platform} is not yet implemented. Currently only Flipkart is supported.`,
        browserAvailable: true,
        pincodeDetails: pincodeDetails ? {
          pincode: pincodeDetails.pincode,
          isValid: pincodeDetails.isValid,
          district: pincodeDetails.district,
          state: pincodeDetails.state,
        } : null,
      });
    }

    // Perform real check
    const result = await checkFlipkartAvailabilityReal(productUrl, pincode);

    return Response.json({
      success: result.success,
      productName: result.productName,
      pincode: result.pincode,
      available: result.available,
      deliveryInfo: result.deliveryInfo,
      price: result.price,
      error: result.error,
      method: result.method,
      platform,
      pincodeDetails: pincodeDetails ? {
        pincode: pincodeDetails.pincode,
        isValid: pincodeDetails.isValid,
        district: pincodeDetails.district,
        state: pincodeDetails.state,
        region: pincodeDetails.region,
        postOffices: pincodeDetails.postOffices.slice(0, 3).map(po => po.Name),
      } : null,
    });
  } catch (error) {
    console.error("Real check error:", error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * Check if browser automation is available
 */
export async function GET() {
  try {
    const browserAvailable = await isBrowserAvailable();

    return Response.json({
      browserAvailable,
      supportedPlatforms: ["flipkart"],
      note: browserAvailable
        ? "Browser automation is available. You can use POST to check real availability."
        : "Browser automation not available. Chrome/Chromium not found. Use simulation mode or deploy to a server with Chrome.",
    });
  } catch (error) {
    return Response.json({
      browserAvailable: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
