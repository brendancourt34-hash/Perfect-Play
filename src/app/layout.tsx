import type { Metadata } from "next";
import { Geist_Mono, Saira, Saira_Condensed } from "next/font/google";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import "./globals.css";

const saira = Saira({
  variable: "--font-saira",
  subsets: ["latin"],
});

const sairaCondensed = Saira_Condensed({
  variable: "--font-saira-condensed",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Perfect Play — NRL, AFL, NBA & NFL Prediction Competitions",
  description:
    "Perfect Play: $5 to pick the Perfect Round — a try scorer (NRL), goal scorer (AFL), 25+ point player (NBA), or touchdown scorer (NFL) in every game. Get every pick right, go PERFECT, take the entire pool.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-AU"
      className={`${saira.variable} ${sairaCondensed.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
