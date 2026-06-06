import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export default function SetupPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-slate-50 py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-extrabold text-slate-900 mb-2">
            Setup & Configuration
          </h1>
          <p className="text-slate-500 mb-8">
            Configure your Product Availability Tracker for real data and notifications
          </p>

          {/* Current Status */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-8">
            <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
              <span className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
              Current Status
            </h2>
            <div className="grid gap-4">
              <div className="flex items-center justify-between p-4 bg-green-50 rounded-xl border border-green-200">
                <div>
                  <p className="font-semibold text-green-800">✅ Pincode API (155K+ pincodes)</p>
                  <p className="text-sm text-green-600">India Post API - FREE, All villages/streets included</p>
                </div>
                <span className="text-xs bg-green-200 text-green-800 px-3 py-1 rounded-full font-bold">
                  ACTIVE
                </span>
              </div>
              <div className="flex items-center justify-between p-4 bg-amber-50 rounded-xl border border-amber-200">
                <div>
                  <p className="font-semibold text-amber-800">⚠️ Flipkart Availability Check</p>
                  <p className="text-sm text-amber-600">Simulated - Deploy with Chrome OR build Chrome Extension for real data</p>
                </div>
                <span className="text-xs bg-amber-200 text-amber-800 px-3 py-1 rounded-full font-bold">
                  SIMULATED
                </span>
              </div>
              <div className="flex items-center justify-between p-4 bg-amber-50 rounded-xl border border-amber-200">
                <div>
                  <p className="font-semibold text-amber-800">⚠️ Email Notifications</p>
                  <p className="text-sm text-amber-600">Set RESEND_API_KEY for real emails</p>
                </div>
                <span className="text-xs bg-amber-200 text-amber-800 px-3 py-1 rounded-full font-bold">
                  SIMULATED
                </span>
              </div>
            </div>
            <p className="text-sm text-slate-500 mt-4 p-3 bg-slate-50 rounded-lg">
              💡 <strong>Why simulated?</strong> Flipkart doesn&apos;t have a public API. Real checking requires either:
              (1) Browser automation with Chrome installed, or (2) A Chrome Extension that checks from the browser.
            </p>
          </div>

          {/* Configuration Steps */}
          <div className="space-y-6">
            {/* Step 1: Pincode Data */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
                <h3 className="font-bold text-slate-900">
                  1. Pincode Data (Already Configured ✅)
                </h3>
              </div>
              <div className="p-6">
                <p className="text-slate-600 mb-4">
                  The app uses India Post&apos;s official API which provides data for all 155,000+ Indian pincodes including villages, streets, and post offices.
                </p>
                <div className="bg-slate-100 rounded-lg p-4 font-mono text-sm">
                  <p className="text-slate-500 mb-1"># No API key needed</p>
                  <p className="text-slate-800">https://api.postalpincode.in/pincode/&#123;pincode&#125;</p>
                </div>
              </div>
            </div>

            {/* Step 2: Email Notifications */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
                <h3 className="font-bold text-slate-900">
                  2. Email Notifications (Optional)
                </h3>
              </div>
              <div className="p-6">
                <p className="text-slate-600 mb-4">
                  To send real email notifications when products become available, configure Resend:
                </p>
                <ol className="list-decimal list-inside space-y-3 text-slate-600 mb-6">
                  <li>
                    Sign up at{" "}
                    <a
                      href="https://resend.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-600 hover:underline font-medium"
                    >
                      resend.com
                    </a>{" "}
                    (free tier: 100 emails/day)
                  </li>
                  <li>Create an API key from the dashboard</li>
                  <li>Add to environment variables:</li>
                </ol>
                <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm">
                  <p className="text-green-400"># Add to .env file</p>
                  <p className="text-white">RESEND_API_KEY=re_xxxxxxxxxxxxx</p>
                  <p className="text-white mt-1">EMAIL_FROM=&quot;Tracker &lt;notifications@yourdomain.com&gt;&quot;</p>
                </div>
              </div>
            </div>

            {/* Step 3: Real Availability Check */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
                <h3 className="font-bold text-slate-900">
                  3. Real Availability Check (Advanced)
                </h3>
              </div>
              <div className="p-6">
                <p className="text-slate-600 mb-4">
                  Flipkart and Amazon don&apos;t provide public APIs for delivery checks. Here are the options:
                </p>

                <div className="space-y-4">
                  {/* Option A */}
                  <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
                    <h4 className="font-bold text-blue-800 mb-2">
                      Option A: Chrome Extension (Recommended)
                    </h4>
                    <p className="text-sm text-blue-700 mb-3">
                      Build a Chrome Extension that injects content scripts into Flipkart/Amazon pages. The script can interact with the actual page to check delivery availability.
                    </p>
                    <details className="text-sm">
                      <summary className="cursor-pointer font-medium text-blue-600 hover:text-blue-800">
                        View implementation details
                      </summary>
                      <div className="mt-3 bg-blue-100 rounded-lg p-3 font-mono text-xs overflow-x-auto">
                        <pre className="text-blue-900">{`// content-script.js
async function checkDelivery(pincode) {
  const input = document.querySelector('#pincodeInputId');
  input.value = pincode;
  input.dispatchEvent(new Event('input'));
  
  const checkBtn = document.querySelector('[data-testid="check-pincode"]');
  checkBtn.click();
  
  await new Promise(r => setTimeout(r, 2000));
  
  const unavailable = document.querySelector('.out-of-stock');
  return { available: !unavailable };
}`}</pre>
                      </div>
                    </details>
                  </div>

                  {/* Option B */}
                  <div className="p-4 bg-purple-50 rounded-xl border border-purple-200">
                    <h4 className="font-bold text-purple-800 mb-2">
                      Option B: Browser Automation (Puppeteer/Playwright)
                    </h4>
                    <p className="text-sm text-purple-700 mb-3">
                      Use headless browser automation server-side. More reliable but requires a server with Chrome installed.
                    </p>
                    <div className="bg-purple-100 rounded-lg p-3 font-mono text-xs overflow-x-auto">
                      <pre className="text-purple-900">{`npm install puppeteer
# or
npm install playwright`}</pre>
                    </div>
                  </div>

                  {/* Option C */}
                  <div className="p-4 bg-rose-50 rounded-xl border border-rose-200">
                    <h4 className="font-bold text-rose-800 mb-2">
                      Option C: Scraping Service
                    </h4>
                    <p className="text-sm text-rose-700">
                      Use services like ScrapingBee, Browserless, or ScrapFly that handle browser automation in the cloud.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Launching the Extension */}
            <div className="bg-white rounded-2xl border-2 border-primary-500 overflow-hidden shadow-xl">
              <div className="px-6 py-4 bg-primary-500 border-b border-primary-600">
                <h3 className="font-bold text-white flex items-center gap-2 text-lg">
                  🚀 Launching your Chrome Extension
                </h3>
              </div>
              <div className="p-6">
                <div className="grid md:grid-cols-2 gap-8">
                  <div>
                    <h4 className="font-bold text-slate-900 mb-4">Launch in 3 Steps:</h4>
                    <ul className="space-y-4">
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center font-bold text-xs">1</span>
                        <div>
                          <p className="font-bold text-sm text-slate-900">Download the Source</p>
                          <p className="text-xs text-slate-500">Download the <code>/public/chrome-extension</code> folder from the project.</p>
                        </div>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center font-bold text-xs">2</span>
                        <div>
                          <p className="font-bold text-sm text-slate-900">Update API URL</p>
                          <p className="text-xs text-slate-500">Open <code>popup.js</code> and change <code>API_BASE_URL</code> to your deployed website URL.</p>
                        </div>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center font-bold text-xs">3</span>
                        <div>
                          <p className="font-bold text-sm text-slate-900">Load in Chrome</p>
                          <p className="text-xs text-slate-500">Go to <code>chrome://extensions</code>, enable Developer Mode, and click &quot;Load Unpacked&quot;.</p>
                        </div>
                      </li>
                    </ul>
                    
                    <div className="mt-8 p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <p className="text-xs font-bold text-slate-500 uppercase mb-2">Publishing Tips:</p>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        To publish on the <strong>Chrome Web Store</strong>, you must ZIP the folder and pay a $5 one-time developer fee. Once published, anyone can install it with one click!
                      </p>
                    </div>
                  </div>

                  <div className="bg-slate-900 rounded-2xl p-6 text-white flex flex-col justify-center items-center text-center relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-primary-500/10 rounded-full blur-2xl" />
                    <svg className="w-16 h-16 text-primary-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <h5 className="font-bold text-lg mb-2">Mobile-Ready Dashboard</h5>
                    <p className="text-sm text-slate-400">
                      Your extension is fully connected to this dashboard. Every time a user checks a product via the extension, your database updates with <strong>100% accurate data</strong>.
                    </p>
                    <button className="mt-6 px-6 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-lg font-bold text-sm transition-all">
                      Download ZIP Package
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* API Endpoints */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
                <h3 className="font-bold text-slate-900">
                  5. Available API Endpoints
                </h3>
              </div>
              <div className="p-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-2 px-3 font-bold text-slate-700">Endpoint</th>
                        <th className="text-left py-2 px-3 font-bold text-slate-700">Method</th>
                        <th className="text-left py-2 px-3 font-bold text-slate-700">Description</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-xs">
                      <tr className="border-b border-slate-100">
                        <td className="py-2 px-3 text-primary-600">/api/availability/check</td>
                        <td className="py-2 px-3">POST</td>
                        <td className="py-2 px-3 font-sans">Check availability (single/bulk)</td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 px-3 text-primary-600">/api/pincode/lookup</td>
                        <td className="py-2 px-3">GET</td>
                        <td className="py-2 px-3 font-sans">Lookup pincode details (real data)</td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 px-3 text-primary-600">/api/pincode/search</td>
                        <td className="py-2 px-3">GET</td>
                        <td className="py-2 px-3 font-sans">Search by area/city name</td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 px-3 text-primary-600">/api/alerts</td>
                        <td className="py-2 px-3">POST/GET</td>
                        <td className="py-2 px-3 font-sans">Create/list notification alerts</td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 px-3 text-primary-600">/api/products</td>
                        <td className="py-2 px-3">POST/GET</td>
                        <td className="py-2 px-3 font-sans">Create/list tracked products</td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 px-3 text-primary-600">/api/notifications/process</td>
                        <td className="py-2 px-3">POST</td>
                        <td className="py-2 px-3 font-sans">Process pending notifications</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-primary-600">/api/stats</td>
                        <td className="py-2 px-3">GET</td>
                        <td className="py-2 px-3 font-sans">Dashboard statistics</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
