export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 text-white">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      {/* Floating orbs */}
      <div className="absolute top-20 left-10 w-72 h-72 bg-primary-400/20 rounded-full blur-3xl" />
      <div className="absolute bottom-10 right-10 w-96 h-96 bg-blue-400/10 rounded-full blur-3xl" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28 lg:py-32">
        <div className="max-w-3xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/10 backdrop-blur-sm rounded-full text-sm font-medium text-primary-100 mb-8 border border-white/10">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            Now tracking 300+ Indian pincodes
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight">
            Never Miss a{" "}
            <span className="relative">
              <span className="relative z-10">Delivery</span>
              <span className="absolute bottom-2 left-0 right-0 h-3 bg-yellow-400/30 -rotate-1 rounded" />
            </span>{" "}
            Again
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-primary-100/90 max-w-2xl mx-auto leading-relaxed">
            Instantly check where any product is deliverable across India.
            Get notified the moment it becomes available at your pincode.
            No more manual checking.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="#tracker"
              className="w-full sm:w-auto px-8 py-4 bg-white text-primary-700 font-bold rounded-2xl shadow-xl hover:shadow-2xl hover:bg-primary-50 transition-all text-lg"
            >
              Check Availability →
            </a>
            <a
              href="#how-it-works"
              className="w-full sm:w-auto px-8 py-4 bg-white/10 backdrop-blur-sm text-white font-semibold rounded-2xl border border-white/20 hover:bg-white/20 transition-all text-lg"
            >
              Learn More
            </a>
          </div>

          {/* Supported platforms */}
          <div className="mt-16 pt-8 border-t border-white/10">
            <p className="text-sm text-primary-200/70 mb-4 font-medium uppercase tracking-wider">
              Supports all major platforms
            </p>
            <div className="flex flex-wrap justify-center items-center gap-6 text-white/60">
              <span className="text-lg font-bold tracking-wide">Flipkart</span>
              <span className="w-1 h-1 bg-white/30 rounded-full" />
              <span className="text-lg font-bold tracking-wide">Amazon India</span>
              <span className="w-1 h-1 bg-white/30 rounded-full" />
              <span className="text-lg font-bold tracking-wide">Myntra</span>
              <span className="w-1 h-1 bg-white/30 rounded-full" />
              <span className="text-lg font-bold tracking-wide">Croma</span>
              <span className="w-1 h-1 bg-white/30 rounded-full" />
              <span className="text-lg font-bold tracking-wide">+More</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
