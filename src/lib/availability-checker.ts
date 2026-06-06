import { PINCODE_DATABASE, isMetroArea, isTier2Area, type PincodeInfo } from "./pincodes";

export interface AvailabilityResult {
  pincode: string;
  city: string;
  state: string;
  available: boolean;
  region: string;
}

/**
 * Simulates checking product availability across pincodes.
 * In a production Chrome Extension, this would actually call the
 * Flipkart/Amazon API or scrape the delivery check endpoint.
 * 
 * For demo purposes, we use a deterministic algorithm based on
 * the product URL hash to generate consistent availability patterns.
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

export function checkAvailabilityForPincodes(
  productUrl: string,
  pincodes: PincodeInfo[]
): AvailabilityResult[] {
  const productHash = hashString(productUrl);
  
  return pincodes.map((p) => {
    const pincodeHash = hashString(p.pincode);
    const combined = (productHash + pincodeHash) % 100;
    
    let available: boolean;
    
    if (isMetroArea(p.pincode)) {
      // Metro areas: ~80% chance of being deliverable
      available = combined < 80;
    } else if (isTier2Area(p.pincode)) {
      // Tier-2 cities: ~55% chance
      available = combined < 55;
    } else {
      // Remote areas: ~25% chance
      available = combined < 25;
    }
    
    return {
      pincode: p.pincode,
      city: p.city,
      state: p.state || "",
      available,
      region: p.region,
    };
  });
}

export function checkAvailabilityAll(productUrl: string): AvailabilityResult[] {
  // Get one representative pincode per city to avoid duplicates in summary
  const cityMap = new Map<string, PincodeInfo>();
  for (const p of PINCODE_DATABASE) {
    const key = `${p.city}-${p.state}`;
    if (!cityMap.has(key)) {
      cityMap.set(key, p);
    }
  }
  
  const representativePincodes = Array.from(cityMap.values());
  return checkAvailabilityForPincodes(productUrl, representativePincodes);
}

export function checkSinglePincode(
  productUrl: string,
  pincode: string
): AvailabilityResult | null {
  const info = PINCODE_DATABASE.find((p) => p.pincode === pincode);
  if (!info) {
    // Unknown pincode - use defaults
    const productHash = hashString(productUrl);
    const pincodeHash = hashString(pincode);
    const combined = (productHash + pincodeHash) % 100;
    return {
      pincode,
      city: "Unknown",
      state: "Unknown",
      available: combined < 30,
      region: "Unknown",
    };
  }
  
  const results = checkAvailabilityForPincodes(productUrl, [info]);
  return results[0] || null;
}

export function findNearestAvailable(
  productUrl: string,
  userPincode: string,
  limit: number = 5
): AvailabilityResult[] {
  const allResults = checkAvailabilityAll(productUrl);
  const available = allResults.filter((r) => r.available);
  
  // Sort by pincode proximity (simple numeric distance)
  const userNum = parseInt(userPincode, 10) || 0;
  available.sort((a, b) => {
    const distA = Math.abs(parseInt(a.pincode, 10) - userNum);
    const distB = Math.abs(parseInt(b.pincode, 10) - userNum);
    return distA - distB;
  });
  
  return available.slice(0, limit);
}
