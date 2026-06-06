import { Header } from "@/components/Header";
import { HeroSection } from "@/components/HeroSection";
import { TrackerWidget } from "@/components/TrackerWidget";
import { HowItWorks } from "@/components/HowItWorks";
import { Features } from "@/components/Features";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <HeroSection />
        <TrackerWidget />
        <HowItWorks />
        <Features />
      </main>
      <Footer />
    </div>
  );
}
