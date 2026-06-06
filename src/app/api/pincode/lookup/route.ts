import { lookupPincodeFromIndiaPost } from "@/lib/india-post-api";

export const dynamic = "force-dynamic";

/**
 * Lookup pincode details from India Post API
 * Returns real data for all 155,000+ Indian pincodes
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pincode = searchParams.get("pincode");

    if (!pincode) {
      return Response.json(
        { error: "Pincode parameter is required" },
        { status: 400 }
      );
    }

    if (!/^\d{6}$/.test(pincode)) {
      return Response.json(
        { error: "Invalid pincode format. Must be 6 digits." },
        { status: 400 }
      );
    }

    const details = await lookupPincodeFromIndiaPost(pincode);

    if (!details) {
      return Response.json(
        { error: "Failed to fetch pincode details" },
        { status: 500 }
      );
    }

    return Response.json({
      pincode: details.pincode,
      isValid: details.isValid,
      state: details.state,
      district: details.district,
      region: details.region,
      block: details.block,
      postOfficeCount: details.postOffices.length,
      postOffices: details.postOffices.slice(0, 10), // Limit to first 10
      deliveryPostOffice: details.deliveryPostOffice,
    });
  } catch (error) {
    console.error("Error in pincode lookup:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
