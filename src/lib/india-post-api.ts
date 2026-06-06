/**
 * India Post Official Pincode API
 * FREE - No API Key Required
 * Covers all 155,000+ Indian pincodes including villages, streets, post offices
 */

export interface PostOffice {
  Name: string;
  Description: string | null;
  BranchType: string;
  DeliveryStatus: string;
  Circle: string;
  District: string;
  Division: string;
  Region: string;
  Block: string;
  State: string;
  Country: string;
  Pincode: string;
}

export interface PincodeApiResponse {
  Message: string;
  Status: "Success" | "Error" | "404";
  PostOffice: PostOffice[] | null;
}

export interface PincodeDetails {
  pincode: string;
  isValid: boolean;
  state: string;
  district: string;
  region: string;
  block: string;
  postOffices: PostOffice[];
  deliveryPostOffice: PostOffice | null;
}

/**
 * Lookup pincode details from India Post API
 * This API is FREE and requires no authentication
 */
export async function lookupPincodeFromIndiaPost(
  pincode: string
): Promise<PincodeDetails | null> {
  try {
    const response = await fetch(
      `https://api.postalpincode.in/pincode/${pincode}`,
      {
        headers: {
          Accept: "application/json",
        },
        // Cache for 24 hours since pincode data rarely changes
        next: { revalidate: 86400 },
      }
    );

    if (!response.ok) {
      console.error(`India Post API error: ${response.status}`);
      return null;
    }

    const data: PincodeApiResponse[] = await response.json();
    const result = data[0];

    if (result.Status !== "Success" || !result.PostOffice) {
      return {
        pincode,
        isValid: false,
        state: "",
        district: "",
        region: "",
        block: "",
        postOffices: [],
        deliveryPostOffice: null,
      };
    }

    // Find the delivery post office (head office or one marked for delivery)
    const deliveryPostOffice =
      result.PostOffice.find((po) => po.DeliveryStatus === "Delivery") ||
      result.PostOffice.find((po) => po.BranchType === "Head Post Office") ||
      result.PostOffice[0];

    return {
      pincode,
      isValid: true,
      state: deliveryPostOffice.State,
      district: deliveryPostOffice.District,
      region: deliveryPostOffice.Region,
      block: deliveryPostOffice.Block,
      postOffices: result.PostOffice,
      deliveryPostOffice,
    };
  } catch (error) {
    console.error("Error fetching pincode from India Post:", error);
    return null;
  }
}

/**
 * Search post offices by name/area
 * Uses India Post branch name search
 */
export async function searchPostOfficeByName(
  query: string
): Promise<PostOffice[]> {
  try {
    const response = await fetch(
      `https://api.postalpincode.in/postoffice/${encodeURIComponent(query)}`,
      {
        headers: {
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      return [];
    }

    const data: PincodeApiResponse[] = await response.json();
    const result = data[0];

    if (result.Status !== "Success" || !result.PostOffice) {
      return [];
    }

    return result.PostOffice;
  } catch (error) {
    console.error("Error searching post offices:", error);
    return [];
  }
}

/**
 * Validate if a pincode exists in India
 */
export async function validatePincode(pincode: string): Promise<boolean> {
  if (!/^\d{6}$/.test(pincode)) {
    return false;
  }
  const details = await lookupPincodeFromIndiaPost(pincode);
  return details?.isValid ?? false;
}

/**
 * Get state from pincode (first digit mapping)
 * This is approximate - for exact info use the API
 */
export function getStateFromPincodePrefix(pincode: string): string {
  const firstDigit = pincode.charAt(0);
  const stateMap: Record<string, string> = {
    "1": "Delhi/Haryana/Punjab/HP/J&K",
    "2": "Uttar Pradesh/Uttarakhand",
    "3": "Rajasthan/Gujarat",
    "4": "Maharashtra/Goa/MP/Chhattisgarh",
    "5": "Andhra Pradesh/Telangana/Karnataka",
    "6": "Tamil Nadu/Kerala",
    "7": "West Bengal/Odisha/NE States",
    "8": "Bihar/Jharkhand",
    "9": "Army/Field Post Offices",
  };
  return stateMap[firstDigit] || "Unknown";
}
