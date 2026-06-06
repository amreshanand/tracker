"use client";

import { useState, useCallback, useEffect } from "react";
import { getPlatformLabel, detectPlatform } from "@/lib/platform";

interface AvailabilityResult {
  pincode: string;
  city: string;
  state: string;
  district?: string;
  available: boolean;
  region: string;
  isValidPincode?: boolean;
  postOffices?: Array<{ name: string; type: string; delivery: boolean }>;
  source?: "real" | "simulated";
}

interface CheckResult {
  product: {
    id: number;
    name: string;
    url: string;
    platform: string;
  };
  totalChecked?: number;
  availableCount?: number;
  unavailableCount?: number;
  available?: AvailabilityResult[];
  unavailable?: AvailabilityResult[];
  result?: AvailabilityResult;
  nearestAvailable?: AvailabilityResult[];
}

const SAMPLE_PRODUCTS = [
  {
    name: "iPhone 17 Pro Max",
    url: "https://www.flipkart.com/apple-iphone-17-pro-max-256gb/p/itm123456",
  },
  {
    name: "Samsung Galaxy S25 Ultra",
    url: "https://www.amazon.in/Samsung-Galaxy-S25-Ultra/dp/B0EXAMPLE",
  },
  {
    name: "OnePlus 13 5G",
    url: "https://www.flipkart.com/oneplus-13-5g/p/itm789012",
  },
  {
    name: "MacBook Air M4",
    url: "https://www.amazon.in/Apple-MacBook-Air-M4/dp/B0MACBOOK",
  },
  {
    name: "Sony WH-1000XM6 Headphones",
    url: "https://www.flipkart.com/sony-wh-1000xm6/p/itm345678",
  },
];

export function TrackerWidget() {
  const [productName, setProductName] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [checkPincode, setCheckPincode] = useState("");
  const [checkMode, setCheckMode] = useState<"all" | "pincode">("all");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CheckResult | null>(null);
  const [error, setError] = useState("");
  const [lastFetchedUrl, setLastFetchedUrl] = useState("");
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [scrapedMetadata, setScrapedMetadata] = useState<{
    name: string;
    description: string;
    imageUrl: string;
    price: string;
    platform: string;
  } | null>(null);
  const [showFullDesc, setShowFullDesc] = useState(false);

  // Notify form
  const [notifyName, setNotifyName] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifyPincode, setNotifyPincode] = useState("");
  const [notifyLoading, setNotifyLoading] = useState(false);
  const [notifySuccess, setNotifySuccess] = useState("");
  const [notifyError, setNotifyError] = useState("");

  const [activeTab, setActiveTab] = useState<"check" | "notify">("check");
  const [regionFilter, setRegionFilter] = useState<string>("all");

  const detectedPlatform = productUrl ? detectPlatform(productUrl) : "";

  const isValidUrl = (url: string) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  // Auto-scrape metadata when a valid URL is entered/pasted
  useEffect(() => {
    if (!productUrl || !isValidUrl(productUrl)) {
      const timer = setTimeout(() => {
        setScrapedMetadata(null);
        setLastFetchedUrl("");
      }, 0);
      return () => clearTimeout(timer);
    }

    if (productUrl === lastFetchedUrl) {
      return;
    }

    const timer = setTimeout(async () => {
      setMetadataLoading(true);
      setScrapedMetadata(null);
      setError(prev => prev !== "" ? "" : prev);
      try {
        const res = await fetch("/api/products/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: productUrl }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setScrapedMetadata(data);
            // Auto-fill product name if empty or default
            if (!productName || productName === "Unknown Product" || productName === "") {
              setProductName(data.name);
            }
          }
        }
      } catch (err) {
        console.error("Failed to scrape metadata:", err);
      } finally {
        setMetadataLoading(false);
        setLastFetchedUrl(productUrl);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [productUrl, lastFetchedUrl, productName]);

  const selectSample = useCallback((sample: typeof SAMPLE_PRODUCTS[number]) => {
    setProductName(sample.name);
    setProductUrl(sample.url);
    setScrapedMetadata(null);
    setLastFetchedUrl("");
    setResults(null);
    setError("");
  }, [setProductName, setProductUrl, setScrapedMetadata, setLastFetchedUrl, setResults, setError]);

  const handleCheck = async () => {
    if (!productUrl) {
      setError("Please enter a product URL");
      return;
    }

    setLoading(true);
    setError("");
    setResults(null);

    try {
      const body: Record<string, unknown> = {
        productUrl,
        productName: productName || "Unknown Product",
        imageUrl: scrapedMetadata?.imageUrl || null,
        price: scrapedMetadata?.price || null,
        description: scrapedMetadata?.description || null,
      };

      if (checkMode === "pincode" && checkPincode) {
        body.pincode = checkPincode;
      } else {
        body.checkAll = true;
      }

      const res = await fetch("/api/availability/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to check availability");
        return;
      }

      setResults(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleNotify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productUrl) {
      setNotifyError("Please enter a product URL first");
      return;
    }

    setNotifyLoading(true);
    setNotifyError("");
    setNotifySuccess("");

    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userName: notifyName,
          email: notifyEmail,
          pincode: notifyPincode,
          productUrl,
          productName: productName || "Unknown Product",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setNotifyError(data.error || "Failed to create alert");
        return;
      }

      setNotifySuccess(data.message);
      if (!data.alreadyExists) {
        setNotifyName("");
        setNotifyEmail("");
        setNotifyPincode("");
      }
    } catch {
      setNotifyError("Network error. Please try again.");
    } finally {
      setNotifyLoading(false);
    }
  };

  const availableResults = results?.available || [];
  const unavailableResults = results?.unavailable || [];

  const regions = [
    "all",
    ...Array.from(
      new Set([...availableResults, ...unavailableResults].map((r) => r.region))
    ),
  ];

  const filteredAvailable =
    regionFilter === "all"
      ? availableResults
      : availableResults.filter((r) => r.region === regionFilter);

  const filteredUnavailable =
    regionFilter === "all"
      ? unavailableResults
      : unavailableResults.filter((r) => r.region === regionFilter);

  return (
    <section id="tracker" className="py-16 md:py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900">
            Check Product Availability
          </h2>
          <p className="mt-4 text-lg text-slate-500 max-w-2xl mx-auto">
            Enter a product URL from Flipkart, Amazon India, or any supported
            platform to instantly see where it can be delivered.
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          {/* Product Input Card */}
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-slate-200">
              <button
                onClick={() => setActiveTab("check")}
                className={`flex-1 px-6 py-4 text-sm font-semibold transition-all ${
                  activeTab === "check"
                    ? "text-primary-600 border-b-2 border-primary-500 bg-primary-50/50"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                  Check Availability
                </span>
              </button>
              <button
                onClick={() => setActiveTab("notify")}
                className={`flex-1 px-6 py-4 text-sm font-semibold transition-all ${
                  activeTab === "notify"
                    ? "text-primary-600 border-b-2 border-primary-500 bg-primary-50/50"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                  </svg>
                  Notify Me
                </span>
              </button>
            </div>

            <div className="p-6 md:p-8">
              {/* Product URL Input */}
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Product Name
                  </label>
                  <input
                    type="text"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="e.g., iPhone 17 Pro Max"
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all bg-slate-50 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Product URL
                  </label>
                  <div className="relative">
                    <input
                      type="url"
                      value={productUrl}
                      onChange={(e) => setProductUrl(e.target.value)}
                      placeholder="https://www.flipkart.com/product/..."
                      className="w-full px-4 py-3 pr-32 border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all bg-slate-50 focus:bg-white"
                    />
                    {detectedPlatform && detectedPlatform !== "unknown" && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1 bg-primary-100 text-primary-700 text-xs font-bold rounded-lg">
                        {getPlatformLabel(detectedPlatform)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Product Preview Loading Skeleton */}
              {metadataLoading && (
                <div className="mb-6 p-5 border border-slate-200 rounded-2xl bg-slate-50/50 flex gap-4 animate-pulse">
                  <div className="w-24 h-24 rounded-xl skeleton flex-shrink-0" />
                  <div className="flex-1 space-y-3 py-1">
                    <div className="h-4 skeleton rounded w-1/4" />
                    <div className="h-6 skeleton rounded w-3/4" />
                    <div className="h-4 skeleton rounded w-1/2" />
                    <div className="space-y-2">
                      <div className="h-3 skeleton rounded" />
                      <div className="h-3 skeleton rounded w-5/6" />
                    </div>
                  </div>
                </div>
              )}

              {/* Product Preview Card */}
              {!metadataLoading && scrapedMetadata && (
                <div className="mb-6 p-5 border border-slate-200 rounded-2xl bg-gradient-to-br from-white to-slate-50 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col sm:flex-row gap-5 relative overflow-hidden group">
                  <div className="absolute -right-20 -bottom-20 w-48 h-48 rounded-full bg-primary-100/30 blur-3xl pointer-events-none" />
                  
                  {scrapedMetadata.imageUrl ? (
                    <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-xl bg-white border border-slate-100 flex items-center justify-center p-2 flex-shrink-0 shadow-sm relative overflow-hidden group-hover:scale-105 transition-transform duration-300">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img 
                        src={scrapedMetadata.imageUrl} 
                        alt={scrapedMetadata.name} 
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-xl bg-slate-100 border border-slate-200 flex flex-col items-center justify-center p-2 flex-shrink-0">
                      <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                      </svg>
                      <span className="text-[10px] text-slate-400 mt-1 font-medium">No Image</span>
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider uppercase bg-primary-50 border border-primary-100 text-primary-600">
                        {getPlatformLabel(scrapedMetadata.platform)}
                      </span>
                      {scrapedMetadata.price && (
                        <span className="px-2.5 py-0.5 rounded-md text-xs font-extrabold bg-success-50 border border-success-100 text-success-700">
                          {scrapedMetadata.price}
                        </span>
                      )}
                    </div>

                    <h4 className="text-base sm:text-lg font-bold text-slate-900 leading-snug mb-1.5">
                      {scrapedMetadata.name}
                    </h4>

                    {scrapedMetadata.description && (
                      <div className="text-xs sm:text-sm text-slate-600 font-medium leading-relaxed">
                        <p>
                          {showFullDesc 
                            ? scrapedMetadata.description 
                            : `${scrapedMetadata.description.slice(0, 160)}${scrapedMetadata.description.length > 160 ? '...' : ''}`
                          }
                          {scrapedMetadata.description.length > 160 && (
                            <button
                              onClick={() => setShowFullDesc(!showFullDesc)}
                              className="text-primary-600 hover:text-primary-700 font-bold ml-1.5 focus:outline-none inline-flex items-center gap-0.5"
                            >
                              {showFullDesc ? 'Show Less' : 'Read More'}
                              <svg className={`w-3 h-3 transition-transform ${showFullDesc ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                              </svg>
                            </button>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}


              {/* Quick select */}
              <div className="mb-6">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Try a sample product
                </p>
                <div className="flex flex-wrap gap-2">
                  {SAMPLE_PRODUCTS.map((sample) => (
                    <button
                      key={sample.url}
                      onClick={() => selectSample(sample)}
                      className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-primary-100 text-slate-600 hover:text-primary-700 rounded-lg transition-all border border-transparent hover:border-primary-200"
                    >
                      {sample.name}
                    </button>
                  ))}
                </div>
              </div>

              {activeTab === "check" && (
                <>
                  {/* Check mode */}
                  <div className="flex items-center gap-4 mb-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="checkMode"
                        checked={checkMode === "all"}
                        onChange={() => setCheckMode("all")}
                        className="w-4 h-4 text-primary-600"
                      />
                      <span className="text-sm font-medium text-slate-700">
                        Check all locations
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="checkMode"
                        checked={checkMode === "pincode"}
                        onChange={() => setCheckMode("pincode")}
                        className="w-4 h-4 text-primary-600"
                      />
                      <span className="text-sm font-medium text-slate-700">
                        Check specific pincode
                      </span>
                    </label>
                  </div>

                  {checkMode === "pincode" && (
                    <div className="mb-6">
                      <input
                        type="text"
                        value={checkPincode}
                        onChange={(e) =>
                          setCheckPincode(e.target.value.replace(/\D/g, "").slice(0, 6))
                        }
                        placeholder="Enter 6-digit pincode"
                        maxLength={6}
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all bg-slate-50 focus:bg-white"
                      />
                    </div>
                  )}

                  <button
                    onClick={handleCheck}
                    disabled={loading || !productUrl}
                    className="w-full py-4 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white font-bold rounded-xl shadow-lg shadow-primary-200 hover:shadow-xl hover:shadow-primary-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Checking Availability...
                      </span>
                    ) : (
                      "Check Availability"
                    )}
                  </button>
                </>
              )}

              {activeTab === "notify" && (
                <form onSubmit={handleNotify} className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Your Name
                    </label>
                    <input
                      type="text"
                      value={notifyName}
                      onChange={(e) => setNotifyName(e.target.value)}
                      placeholder="e.g., Amresh"
                      required
                      className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all bg-slate-50 focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={notifyEmail}
                      onChange={(e) => setNotifyEmail(e.target.value)}
                      placeholder="e.g., amresh@gmail.com"
                      required
                      className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all bg-slate-50 focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      Your Pincode
                    </label>
                    <input
                      type="text"
                      value={notifyPincode}
                      onChange={(e) =>
                        setNotifyPincode(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      placeholder="e.g., 302001"
                      maxLength={6}
                      required
                      className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all bg-slate-50 focus:bg-white"
                    />
                  </div>

                  {notifyError && (
                    <div className="p-3 bg-danger-50 border border-danger-400/30 rounded-xl text-danger-600 text-sm font-medium">
                      {notifyError}
                    </div>
                  )}

                  {notifySuccess && (
                    <div className="p-3 bg-success-50 border border-success-400/30 rounded-xl text-success-700 text-sm font-medium flex items-center gap-2">
                      <svg className="w-5 h-5 text-success-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {notifySuccess}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={notifyLoading || !productUrl}
                    className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold rounded-xl shadow-lg shadow-amber-200 hover:shadow-xl hover:shadow-amber-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                  >
                    {notifyLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Submitting...
                      </span>
                    ) : (
                      "🔔 Notify Me When Available"
                    )}
                  </button>
                </form>
              )}

              {error && (
                <div className="mt-4 p-3 bg-danger-50 border border-danger-400/30 rounded-xl text-danger-600 text-sm font-medium">
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Results */}
          {results && (
            <div className="mt-8 animate-fade-in-up">
              {/* Single pincode result */}
              {results.result && (
                <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                  <div className="p-6 md:p-8">
                    <h3 className="text-xl font-bold text-slate-900 mb-4">
                      Availability for Pincode {results.result.pincode}
                    </h3>
                    <div
                      className={`p-6 rounded-xl flex items-center gap-4 ${
                        results.result.available
                          ? "bg-success-50 border border-success-400/30"
                          : "bg-danger-50 border border-danger-400/30"
                      }`}
                    >
                      <div
                        className={`w-12 h-12 rounded-full flex items-center justify-center ${
                          results.result.available
                            ? "bg-success-500"
                            : "bg-danger-500"
                        }`}
                      >
                        {results.result.available ? (
                          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        ) : (
                          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p
                            className={`font-bold text-lg ${
                              results.result.available
                                ? "text-success-700"
                                : "text-danger-600"
                            }`}
                          >
                            {results.result.available
                              ? "✅ Deliverable!"
                              : "❌ Not Deliverable"}
                          </p>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                            results.result.source === 'real' 
                              ? 'bg-blue-100 text-blue-700 border border-blue-200' 
                              : 'bg-slate-100 text-slate-500 border border-slate-200'
                          }`}>
                            {results.result.source === 'real' ? 'Verified ✓' : 'Estimated'}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600">
                          {results.result.city}, {results.result.state} -{" "}
                          {results.result.pincode}
                        </p>
                      </div>
                    </div>

                    {/* Nearest available */}
                    {results.nearestAvailable &&
                      results.nearestAvailable.length > 0 &&
                      !results.result.available && (
                        <div className="mt-6">
                          <h4 className="text-lg font-bold text-slate-900 mb-3">
                            📍 Nearest Available Locations
                          </h4>
                          <div className="grid gap-2">
                            {results.nearestAvailable.map((loc) => (
                              <div
                                key={loc.pincode}
                                className="flex items-center justify-between p-3 bg-success-50 border border-success-400/20 rounded-xl"
                              >
                                <div className="flex items-center gap-3">
                                  <span className="w-2 h-2 bg-success-500 rounded-full" />
                                  <span className="font-medium text-slate-700">
                                    {loc.city}, {loc.state}
                                  </span>
                                </div>
                                <span className="text-sm font-mono text-slate-500">
                                  {loc.pincode}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                  </div>
                </div>
              )}

              {/* All locations result */}
              {results.available && results.unavailable && (
                <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                  <div className="p-6 md:p-8">
                    {/* Summary */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                      <div>
                        <h3 className="text-xl font-bold text-slate-900">
                          Availability Results
                        </h3>
                        <p className="text-sm text-slate-500 mt-1">
                          {results.product.name} • {getPlatformLabel(results.product.platform)}
                        </p>
                      </div>
                      <div className="flex gap-3">
                        <div className="px-4 py-2 bg-success-50 rounded-xl border border-success-400/20">
                          <span className="text-2xl font-bold text-success-600">
                            {results.availableCount}
                          </span>
                          <span className="text-xs text-success-600 ml-1 font-medium">
                            Available
                          </span>
                        </div>
                        <div className="px-4 py-2 bg-danger-50 rounded-xl border border-danger-400/20">
                          <span className="text-2xl font-bold text-danger-500">
                            {results.unavailableCount}
                          </span>
                          <span className="text-xs text-danger-500 ml-1 font-medium">
                            Unavailable
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Region Filter */}
                    <div className="flex flex-wrap gap-2 mb-6">
                      {regions.map((region) => (
                        <button
                          key={region}
                          onClick={() => setRegionFilter(region)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                            regionFilter === region
                              ? "bg-primary-500 text-white shadow-md"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                        >
                          {region === "all" ? "All Regions" : region}
                        </button>
                      ))}
                    </div>

                    {/* Available locations */}
                    {filteredAvailable.length > 0 && (
                      <div className="mb-6">
                        <h4 className="text-sm font-bold text-success-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <span className="w-2 h-2 bg-success-500 rounded-full" />
                          Available Locations ({filteredAvailable.length})
                        </h4>
                        <div className="grid sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                          {filteredAvailable.map((loc) => (
                            <div
                              key={loc.pincode}
                              className="flex items-center justify-between p-3 bg-success-50/50 hover:bg-success-50 border border-success-400/10 hover:border-success-400/30 rounded-xl transition-all"
                            >
                              <div className="flex items-center gap-2">
                                <svg className="w-4 h-4 text-success-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                </svg>
                                <span className="font-medium text-slate-700 text-sm">
                                  {loc.city}
                                </span>
                                <span className={`text-[8px] font-bold px-1 rounded-sm uppercase ${
                                  loc.source === 'real' 
                                    ? 'bg-blue-100 text-blue-700' 
                                    : 'bg-slate-100 text-slate-400'
                                }`}>
                                  {loc.source === 'real' ? 'Real' : 'Est'}
                                </span>
                              </div>
                              <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                                {loc.pincode}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Unavailable locations */}
                    {filteredUnavailable.length > 0 && (
                      <div>
                        <h4 className="text-sm font-bold text-danger-600 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <span className="w-2 h-2 bg-danger-400 rounded-full" />
                          Not Available ({filteredUnavailable.length})
                        </h4>
                        <div className="grid sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                          {filteredUnavailable.map((loc) => (
                            <div
                              key={loc.pincode}
                              className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl"
                            >
                              <div className="flex items-center gap-2">
                                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                <span className="font-medium text-slate-500 text-sm">
                                  {loc.city}
                                </span>
                              </div>
                              <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                                {loc.pincode}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* CTA to subscribe */}
                    <div className="mt-6 p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl">
                      <p className="text-sm font-semibold text-amber-800">
                        🔔 Product not available at your location?
                      </p>
                      <p className="text-sm text-amber-700 mt-1">
                        Switch to the &quot;Notify Me&quot; tab above to get an email when it becomes available at your pincode.
                      </p>
                    </div>
                    <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                      <p className="text-sm font-semibold text-blue-800 flex items-center gap-2">
                        🚀 Want 100% accurate results?
                      </p>
                      <p className="text-xs text-blue-700 mt-1">
                        Results marked as &quot;Estimated&quot; are based on general city availability. For real-time accuracy like the Flipkart app, use our <strong>Chrome Extension</strong> which checks directly from the browser.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
