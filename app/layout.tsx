import type { Metadata } from "next";
import "./globals.css";
import "./live-activity-overrides.css";
import SiteFooter from "./SiteFooter";

export const metadata: Metadata = {
  title: "Technocore Agent Console",
  description: "Browser-native DID identity, signed Technocore activity and builder proof console for the future FLOP testnet path.",
  icons: {
    icon: "/brand/koray-mark.svg",
    shortcut: "/brand/koray-mark.svg",
    apple: "/brand/koray-mark.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
