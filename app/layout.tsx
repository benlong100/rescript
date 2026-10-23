import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { buildLocaleBootScript } from "@/lib/i18n";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Upstream mounts Vercel Web Analytics and Google Analytics here, both reporting
// to the original author's accounts. This fork is handed to schools, so both are
// removed rather than redirected — see PASTE-NOTES.md, "No usage reporting".

const title = "Rescript — edit videos like you edit text";
const description =
  "A fully offline, open-source transcript-based video editor. Transcribe with Whisper, cut by deleting words, export with ffmpeg — on your device.";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.getrescript.com"),
  title,
  description,
  openGraph: {
    type: "website",
    siteName: "Rescript",
    url: "/",
    title,
    description,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Rescript — a transcript-based video editor running in the browser",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

/** Apply stored appearance before paint to avoid a light→dark flash. */
const appearanceBootScript = `(function(){try{if(localStorage.getItem("rescript.appearance")==="dark")document.documentElement.classList.add("dark")}catch(e){}})();`;
const localeBootScript = buildLocaleBootScript();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script
          id="appearance-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: appearanceBootScript }}
        />
        <Script
          id="locale-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: localeBootScript }}
        />
      </head>
      <body className="min-h-full">
        {children}
      </body>
    </html>
  );
}
