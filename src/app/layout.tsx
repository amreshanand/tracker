import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Product Availability Tracker - Check Delivery & Get Notified",
  description:
    "Check product delivery availability across India. Get notified when products become deliverable to your pincode. Works with Flipkart, Amazon India, and more.",
  keywords: [
    "product availability",
    "delivery tracker",
    "pincode checker",
    "flipkart delivery",
    "amazon india delivery",
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-slate-50 text-slate-900 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
