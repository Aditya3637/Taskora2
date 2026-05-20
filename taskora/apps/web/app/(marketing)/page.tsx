import { NavBar } from "@/components/marketing/NavBar";
import { HeroSection } from "@/components/marketing/HeroSection";
import { FeatureCards } from "@/components/marketing/FeatureCards";
import { PricingSection } from "@/components/marketing/PricingSection";
import { Footer } from "@/components/marketing/Footer";
import AuthedRedirect from "./AuthedRedirect";

export default function HomePage() {
  return (
    <>
      <AuthedRedirect />
      <NavBar />
      <main>
        <HeroSection />
        <FeatureCards />
        <PricingSection />
      </main>
      <Footer />
    </>
  );
}
