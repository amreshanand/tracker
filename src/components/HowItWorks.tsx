export function HowItWorks() {
  const steps = [
    {
      number: "01",
      title: "Enter Product Details",
      description:
        "Paste the product URL from Flipkart, Amazon India, or any supported e-commerce platform. Our system automatically detects the platform and product.",
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.374l4.5-4.5a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
        </svg>
      ),
      color: "from-blue-500 to-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      number: "02",
      title: "Check Availability",
      description:
        "Click 'Check Availability' to instantly see which cities and pincodes can receive the product. Filter results by region.",
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
        </svg>
      ),
      color: "from-emerald-500 to-emerald-600",
      bgColor: "bg-emerald-50",
    },
    {
      number: "03",
      title: "Subscribe for Alerts",
      description:
        "If the product isn't deliverable to your area, enter your details. We'll monitor the product and notify you when it becomes available.",
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
      ),
      color: "from-amber-500 to-orange-500",
      bgColor: "bg-amber-50",
    },
    {
      number: "04",
      title: "Get Notified",
      description:
        "When the product becomes deliverable to your pincode, you'll receive an email notification with a direct link to buy it.",
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
      ),
      color: "from-purple-500 to-purple-600",
      bgColor: "bg-purple-50",
    },
  ];

  return (
    <section id="how-it-works" className="py-16 md:py-24 bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <span className="inline-block px-4 py-1.5 bg-primary-100 text-primary-700 text-sm font-bold rounded-full mb-4">
            Simple & Fast
          </span>
          <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900">
            How It Works
          </h2>
          <p className="mt-4 text-lg text-slate-500 max-w-2xl mx-auto">
            Four simple steps to never miss a delivery opportunity
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((step, i) => (
            <div key={step.number} className={`animate-fade-in-up-delay-${i > 3 ? 3 : i}`}>
              <div className="relative bg-white rounded-2xl p-6 shadow-lg border border-slate-100 hover:border-primary-200 hover:shadow-xl transition-all h-full group">
                {/* Step number */}
                <div className="absolute -top-3 -right-3 w-10 h-10 bg-slate-900 text-white rounded-full flex items-center justify-center text-sm font-bold shadow-lg">
                  {step.number}
                </div>

                {/* Icon */}
                <div
                  className={`w-14 h-14 ${step.bgColor} rounded-2xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform`}
                >
                  <div className={`bg-gradient-to-br ${step.color} bg-clip-text text-transparent`}>
                    {step.icon}
                  </div>
                </div>

                <h3 className="text-lg font-bold text-slate-900 mb-2">
                  {step.title}
                </h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
