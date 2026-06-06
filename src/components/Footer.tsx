import Link from "next/link";

export function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
                  />
                </svg>
              </div>
              <div>
                <span className="font-bold text-white text-lg">Availability</span>
                <span className="font-bold text-primary-400 text-lg">Tracker</span>
              </div>
            </div>
            <p className="text-sm text-slate-500 max-w-sm leading-relaxed">
              Never miss a delivery opportunity. Check product availability across 300+ Indian pincodes and get notified when products become deliverable to your location.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-bold text-white text-sm uppercase tracking-wider mb-4">
              Quick Links
            </h4>
            <ul className="space-y-2.5">
              <li>
                <a href="#tracker" className="text-sm hover:text-white transition-colors">
                  Check Availability
                </a>
              </li>
              <li>
                <a href="#how-it-works" className="text-sm hover:text-white transition-colors">
                  How It Works
                </a>
              </li>
              <li>
                <a href="#features" className="text-sm hover:text-white transition-colors">
                  Features
                </a>
              </li>
              <li>
                <Link href="/dashboard" className="text-sm hover:text-white transition-colors">
                  Dashboard
                </Link>
              </li>
            </ul>
          </div>

          {/* Platforms */}
          <div>
            <h4 className="font-bold text-white text-sm uppercase tracking-wider mb-4">
              Supported Platforms
            </h4>
            <ul className="space-y-2.5">
              <li className="text-sm">Flipkart</li>
              <li className="text-sm">Amazon India</li>
              <li className="text-sm">Myntra</li>
              <li className="text-sm">Croma</li>
              <li className="text-sm">AJIO</li>
              <li className="text-sm">+More coming</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-slate-500">
            © {new Date().getFullYear()} Product Availability Tracker. Built with ❤️ for Indian shoppers.
          </p>
          <div className="flex items-center gap-6">
            <span className="text-xs text-slate-600">
              Next.js • PostgreSQL • Drizzle ORM
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
