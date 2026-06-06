export interface ProductInfo {
  name: string;
  url: string;
  platform: string;
  productId?: string;
}

export function detectPlatform(url: string): string {
  if (!url) return "unknown";
  const lower = url.toLowerCase();
  if (lower.includes("flipkart.com")) return "flipkart";
  if (lower.includes("amazon.in") || lower.includes("amazon.co.in")) return "amazon_india";
  if (lower.includes("amazon.com")) return "amazon";
  if (lower.includes("myntra.com")) return "myntra";
  if (lower.includes("snapdeal.com")) return "snapdeal";
  if (lower.includes("ajio.com")) return "ajio";
  if (lower.includes("meesho.com")) return "meesho";
  if (lower.includes("tatacliq.com")) return "tatacliq";
  if (lower.includes("nykaa.com")) return "nykaa";
  if (lower.includes("jiomart.com")) return "jiomart";
  if (lower.includes("croma.com")) return "croma";
  return "other";
}

export function getPlatformLabel(platform: string): string {
  const labels: Record<string, string> = {
    flipkart: "Flipkart",
    amazon_india: "Amazon India",
    amazon: "Amazon",
    myntra: "Myntra",
    snapdeal: "Snapdeal",
    ajio: "AJIO",
    meesho: "Meesho",
    tatacliq: "Tata CLiQ",
    nykaa: "Nykaa",
    jiomart: "JioMart",
    croma: "Croma",
    other: "Other",
    unknown: "Unknown",
  };
  return labels[platform] || platform;
}

export function getPlatformColor(platform: string): string {
  const colors: Record<string, string> = {
    flipkart: "#2874f0",
    amazon_india: "#ff9900",
    amazon: "#ff9900",
    myntra: "#ff3f6c",
    snapdeal: "#e40046",
    ajio: "#3b2f2f",
    meesho: "#570a57",
    tatacliq: "#9b2335",
    nykaa: "#fc2779",
    jiomart: "#0078ad",
    croma: "#0f7d40",
    other: "#6b7280",
    unknown: "#6b7280",
  };
  return colors[platform] || "#6b7280";
}
