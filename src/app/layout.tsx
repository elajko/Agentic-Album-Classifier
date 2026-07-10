import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agentic Album Classifier",
  description:
    "An agentic image gallery that zero-shot classifies uploads into albums it invents on the fly.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
