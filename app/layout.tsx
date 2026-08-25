import type { Metadata } from "next";
import "./globals.css";

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
        <div style={{ width: "min(1240px, calc(100% - 40px))", margin: "0 auto 26px", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, color: "#52666a", fontSize: 11 }}>
          <span>Designed by</span>
          <a href="https://koraycifci.com" target="_blank" rel="noreferrer" aria-label="Designed by Koray Cifci" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            <img src="/brand/koray-logo.svg" alt="Koray Cifci" width="74" height="57" style={{ display: "block", width: 74, height: "auto" }} />
          </a>
        </div>
      </body>
    </html>
  );
}
