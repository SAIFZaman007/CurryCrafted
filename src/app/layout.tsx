import { MagneticButtons } from "@/components/magnetic-buttons";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { unstable_rethrow } from "next/navigation";
import "@fontsource-variable/playfair-display";
import "@fontsource-variable/playfair-display/wght-italic.css";
import "@fontsource-variable/manrope";
import "./globals.css";
import { CartDrawer } from "@/components/cart-drawer";
import { Footer } from "@/components/footer";
import { Header, MobileBasketBar } from "@/components/header";
import { PostcodeModal } from "@/components/postcode";
import { StoreProvider, Toaster } from "@/components/store";
import { JsonLd } from "@/components/json-ld";
import { getSession } from "@/lib/auth";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import type { PostcodeResult, UserDTO } from "@/lib/types";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_GB" },
  twitter: { card: "summary_large_image" },
  title: { default: "Curry Crafted | Chilled & frozen curries, delivered", template: "%s | Curry Crafted" },
  description:
    "Handcrafted chilled meals and frozen favourites, prepared with care and delivered to your door. Chilled delivery to selected postcodes, frozen delivery UK-wide.",
};

export const viewport: Viewport = { themeColor: "#0F2418", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  let user: UserDTO | null = null;
  let postcode: PostcodeResult | null = null;
  try {
    ({ user, postcode } = await getSession());
  } catch (err) {
    unstable_rethrow(err); // let Next.js handle its own dynamic-rendering signals
    console.error("layout session lookup failed", err);
  }

  return (
    <html lang="en-GB" data-scroll-behavior="smooth">
      <body className="min-h-dvh antialiased">
        <JsonLd data={{ "@context": "https://schema.org", "@type": "Organization", name: SITE_NAME, url: SITE_URL, logo: `${SITE_URL}/images/logo.png` }} />
        <noscript>
          <style>{`.reveal{opacity:1!important;transform:none!important}`}</style>
        </noscript>
        <StoreProvider initialUser={user} initialPostcode={postcode}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-btn focus:bg-gold focus:px-5 focus:py-3 focus:font-semibold focus:text-forest"
          >
            Skip to content
          </a>
          <Header />
          <main id="main">{children}</main>
          <Footer />
          <MobileBasketBar />
          <CartDrawer />
          <PostcodeModal />
          <Toaster />
          <MagneticButtons />
        </StoreProvider>
      </body>
    </html>
  );
}
