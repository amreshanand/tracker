/**
 * Unified Product Availability Service
 * 
 * This service provides a unified interface for checking product availability
 * across different e-commerce platforms. It uses real pincode data from
 * India Post API and can be extended with real platform APIs.
 */

import { lookupPincodeFromIndiaPost, type PincodeDetails } from "./india-post-api";
import { detectPlatform } from "./platform";

export interface AvailabilityCheckResult {
  pincode: string;
  pincodeDetails: PincodeDetails | null;
  available: boolean;
  deliveryInfo: string | null;
  checkedAt: Date;
  source: "real" | "simulated";
}

export interface BulkAvailabilityResult {
  productUrl: string;
  productName: string;
  platform: string;
  results: AvailabilityCheckResult[];
  totalChecked: number;
  availableCount: number;
  unavailableCount: number;
}

/**
 * Simulated availability check based on pincode patterns
 * Used when real API checking is not available
 * 
 * In production, replace this with real API calls for each platform
 */
function simulateAvailability(productUrl: string, pincode: string): boolean {
  // Create a deterministic hash for consistent results
  let hash = 0;
  const combined = productUrl + pincode;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  hash = Math.abs(hash);
  
  const probability = hash % 100;
  
  // Metro areas (higher availability)
  const metroPrefixes = ["1100", "1200", "1220", "2013", "4000", "5600", "6000", "7000", "5000"];
  const isMetro = metroPrefixes.some(p => pincode.startsWith(p.slice(0, pincode.length < 4 ? pincode.length : 4)));
  
  // Tier-2 cities
  const tier2Prefixes = ["3020", "3800", "4110", "2260", "1600", "4520", "4620"];
  const isTier2 = tier2Prefixes.some(p => pincode.startsWith(p.slice(0, pincode.length < 4 ? pincode.length : 4)));
  
  // Remote/NE regions (lower availability)
  const remotePrefixes = ["790", "793", "795", "796", "797", "799", "737", "174", "175", "176"];
  const isRemote = remotePrefixes.some(p => pincode.startsWith(p));
  
  if (isMetro) return probability < 75;
  if (isTier2) return probability < 55;
  if (isRemote) return probability < 20;
  return probability < 40;
}

/**
 * Check availability for a single pincode
 */
export async function checkSinglePincodeAvailability(
  productUrl: string,
  pincode: string,
  useRealCheck: boolean = false
): Promise<AvailabilityCheckResult> {
  // Get real pincode details from India Post
  const pincodeDetails = await lookupPincodeFromIndiaPost(pincode);
  
  let available: boolean;
  let deliveryInfo: string | null = null;
  let source: "real" | "simulated" = "simulated";
  
  if (useRealCheck) {
    // TODO: Implement real availability check
    // This would call the actual platform API or use browser automation
    // For now, we simulate
    available = simulateAvailability(productUrl, pincode);
    source = "simulated";
  } else {
    available = simulateAvailability(productUrl, pincode);
  }
  
    if (available && pincodeDetails?.isValid) {
    deliveryInfo = `Delivery available to ${pincodeDetails.district}, ${pincodeDetails.state}`;
  } else if (!available && pincodeDetails?.isValid) {
    deliveryInfo = `Not deliverable to ${pincodeDetails.district}, ${pincodeDetails.state}`;
  }
  
  return {
    pincode,
    pincodeDetails,
    available,
    deliveryInfo,
    checkedAt: new Date(),
    source,
  };
}

/**
 * Check availability for multiple pincodes (bulk check)
 */
export async function checkBulkAvailability(
  productUrl: string,
  productName: string,
  pincodes: string[]
): Promise<BulkAvailabilityResult> {
  const platform = detectPlatform(productUrl);
  
  // Check all pincodes (in parallel with rate limiting)
  const batchSize = 10;
  const results: AvailabilityCheckResult[] = [];
  
  for (let i = 0; i < pincodes.length; i += batchSize) {
    const batch = pincodes.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(pincode => checkSinglePincodeAvailability(productUrl, pincode))
    );
    results.push(...batchResults);
  }
  
  const availableCount = results.filter(r => r.available).length;
  
  return {
    productUrl,
    productName,
    platform,
    results,
    totalChecked: results.length,
    availableCount,
    unavailableCount: results.length - availableCount,
  };
}

/**
 * Get major city pincodes for initial availability check
 */
export function getMajorCityPincodes(): { pincode: string; city: string; state: string }[] {
  return [
    // Delhi NCR
    { pincode: "110001", city: "New Delhi", state: "Delhi" },
    { pincode: "122001", city: "Gurgaon", state: "Haryana" },
    { pincode: "201301", city: "Noida", state: "Uttar Pradesh" },
    { pincode: "201001", city: "Ghaziabad", state: "Uttar Pradesh" },
    { pincode: "121001", city: "Faridabad", state: "Haryana" },
    
    // Mumbai & Maharashtra
    { pincode: "400001", city: "Mumbai", state: "Maharashtra" },
    { pincode: "400076", city: "Navi Mumbai", state: "Maharashtra" },
    { pincode: "411001", city: "Pune", state: "Maharashtra" },
    { pincode: "440001", city: "Nagpur", state: "Maharashtra" },
    
    // Bangalore & Karnataka
    { pincode: "560001", city: "Bangalore", state: "Karnataka" },
    { pincode: "560100", city: "Electronic City", state: "Karnataka" },
    
    // Chennai & Tamil Nadu
    { pincode: "600001", city: "Chennai", state: "Tamil Nadu" },
    { pincode: "641001", city: "Coimbatore", state: "Tamil Nadu" },
    
    // Hyderabad & Telangana
    { pincode: "500001", city: "Hyderabad", state: "Telangana" },
    { pincode: "500036", city: "Secunderabad", state: "Telangana" },
    
    // Kolkata & West Bengal
    { pincode: "700001", city: "Kolkata", state: "West Bengal" },
    { pincode: "700091", city: "Salt Lake", state: "West Bengal" },
    
    // Gujarat
    { pincode: "380001", city: "Ahmedabad", state: "Gujarat" },
    { pincode: "395001", city: "Surat", state: "Gujarat" },
    { pincode: "390001", city: "Vadodara", state: "Gujarat" },
    
    // Rajasthan
    { pincode: "302001", city: "Jaipur", state: "Rajasthan" },
    { pincode: "313001", city: "Udaipur", state: "Rajasthan" },
    { pincode: "342001", city: "Jodhpur", state: "Rajasthan" },
    
    // Uttar Pradesh
    { pincode: "226001", city: "Lucknow", state: "Uttar Pradesh" },
    { pincode: "208001", city: "Kanpur", state: "Uttar Pradesh" },
    { pincode: "221001", city: "Varanasi", state: "Uttar Pradesh" },
    { pincode: "282001", city: "Agra", state: "Uttar Pradesh" },
    
    // Madhya Pradesh
    { pincode: "462001", city: "Bhopal", state: "Madhya Pradesh" },
    { pincode: "452001", city: "Indore", state: "Madhya Pradesh" },
    
    // Kerala
    { pincode: "682001", city: "Kochi", state: "Kerala" },
    { pincode: "695001", city: "Thiruvananthapuram", state: "Kerala" },
    
    // Punjab & Chandigarh
    { pincode: "160001", city: "Chandigarh", state: "Chandigarh" },
    { pincode: "141001", city: "Ludhiana", state: "Punjab" },
    { pincode: "143001", city: "Amritsar", state: "Punjab" },
    
    // Bihar & Jharkhand
    { pincode: "800001", city: "Patna", state: "Bihar" },
    { pincode: "834001", city: "Ranchi", state: "Jharkhand" },
    
    // Odisha
    { pincode: "751001", city: "Bhubaneswar", state: "Odisha" },
    
    // Northeast
    { pincode: "781001", city: "Guwahati", state: "Assam" },
    { pincode: "793001", city: "Shillong", state: "Meghalaya" },
    { pincode: "795001", city: "Imphal", state: "Manipur" },
    
    // Himachal Pradesh
    { pincode: "171001", city: "Shimla", state: "Himachal Pradesh" },
    { pincode: "176001", city: "Dharamshala", state: "Himachal Pradesh" },
    
    // Uttarakhand
    { pincode: "248001", city: "Dehradun", state: "Uttarakhand" },
    
    // Goa
    { pincode: "403001", city: "Panaji", state: "Goa" },
  ];
}

/**
 * Find nearest available pincodes to a given pincode
 */
export async function findNearestAvailable(
  productUrl: string,
  userPincode: string,
  limit: number = 5
): Promise<AvailabilityCheckResult[]> {
  const majorCities = getMajorCityPincodes();
  const userPincodeNum = parseInt(userPincode, 10);
  
  // Sort by pincode proximity
  const sorted = [...majorCities].sort((a, b) => {
    const distA = Math.abs(parseInt(a.pincode, 10) - userPincodeNum);
    const distB = Math.abs(parseInt(b.pincode, 10) - userPincodeNum);
    return distA - distB;
  });
  
  const results: AvailabilityCheckResult[] = [];
  
  for (const city of sorted) {
    if (results.length >= limit) break;
    
    const result = await checkSinglePincodeAvailability(productUrl, city.pincode);
    if (result.available) {
      results.push(result);
    }
  }
  
  return results;
}
