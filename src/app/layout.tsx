import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LOANER — how slow is the machine you rent?",
  description:
    "Run the same benchmark in your browser and on your CI runner, and read the gap. Everyone says hosted runners are slow and oversubscribed; this measures it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
