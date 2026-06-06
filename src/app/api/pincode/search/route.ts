import { searchPostOfficeByName } from "@/lib/india-post-api";

export const dynamic = "force-dynamic";

/**
 * Search post offices by area/city name
 * Uses India Post API - covers all Indian locations
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");

    if (!query || query.length < 2) {
      return Response.json(
        { error: "Query must be at least 2 characters" },
        { status: 400 }
      );
    }

    const results = await searchPostOfficeByName(query);

    // Group by pincode for cleaner results
    const grouped = results.reduce((acc, po) => {
      if (!acc[po.Pincode]) {
        acc[po.Pincode] = {
          pincode: po.Pincode,
          district: po.District,
          state: po.State,
          region: po.Region,
          postOffices: [],
        };
      }
      acc[po.Pincode].postOffices.push({
        name: po.Name,
        type: po.BranchType,
        delivery: po.DeliveryStatus === "Delivery",
      });
      return acc;
    }, {} as Record<string, { pincode: string; district: string; state: string; region: string; postOffices: { name: string; type: string; delivery: boolean }[] }>);

    return Response.json({
      query,
      count: Object.keys(grouped).length,
      results: Object.values(grouped).slice(0, 20), // Limit to 20 results
    });
  } catch (error) {
    console.error("Error in pincode search:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
