import type { Metadata } from "next";
import { Geist_Mono, Libre_Baskerville, Montserrat } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getBrand } from "@/lib/brand";
import "./globals.css";

// Newman type: Montserrat for reading, Libre Baskerville for page titles
const bodySans = Montserrat({ variable: "--font-body", subsets: ["latin"] });
const titleSerif = Libre_Baskerville({ variable: "--font-title", subsets: ["latin"], weight: ["400", "700"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export function generateMetadata(): Metadata {
  const { name } = getBrand();
  return { title: { default: name, template: `%s · ${name}` }, description: `AI agents that answer from ${getBrand().org}’s own data.` };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${bodySans.variable} ${titleSerif.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
