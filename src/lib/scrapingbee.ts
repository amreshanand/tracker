const SCRAPINGBEE_API = "https://app.scrapingbee.com/api/v1";

export async function fetchWithProxy(url: string, options: RequestInit = {}): Promise<Response> {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;

  if (!apiKey) {
    return fetch(url, options);
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    url,
    render_js: "false",
    premium_proxy: "true",
    country_code: "in",
  });

  const proxyUrl = `${SCRAPINGBEE_API}?${params}`;

  const proxyHeaders: Record<string, string> = {};
  if (options.method === "POST" && options.body) {
    proxyHeaders["Content-Type"] = "application/json";
    proxyHeaders["Spray-Forward-Data"] = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  const proxyResponse = await fetch(proxyUrl, {
    method: "GET",
    headers: proxyHeaders,
    signal: options.signal,
  });

  if (!proxyResponse.ok) {
    const text = await proxyResponse.text().catch(() => "");
    throw new Error(`ScrapingBee proxy error ${proxyResponse.status}: ${text}`);
  }

  return proxyResponse;
}
