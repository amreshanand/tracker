import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { DashboardContent } from "@/components/DashboardContent";

export default function DashboardPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 bg-slate-50">
        <DashboardContent />
      </main>
      <Footer />
    </div>
  );
}
