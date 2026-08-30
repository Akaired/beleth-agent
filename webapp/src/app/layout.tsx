import type { Metadata } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
import "./globals.css";

// TradingView's UI type: a plain system-sans stack (SF on macOS, Trebuchet MS
// on Windows) with Roboto as the loaded web fallback so Linux/Android render
// the same. Numbers and tabular data sit in Roboto Mono, as they do on TV.
const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  display: "swap",
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Beleth: trading agent",
  description:
    "It measures the volatility risk premium before it sells any. Every decision and every refusal, published live. Paper trading only.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${roboto.variable} ${robotoMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
