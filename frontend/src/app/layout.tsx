import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ডেঙ্গু পূর্বাভাস — ৬৪ জেলা | Dengue Outbreak Forecasting",
  description:
    "বাংলাদেশের ৬৪ জেলায় আগামী ১ সপ্তাহের ডেঙ্গু পূর্বাভাস ড্যাশবোর্ড (0.5 * GBM-log(+transfer) + 0.5 * persistence)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="bn" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="min-h-screen bg-[#0b1120] text-slate-100 antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
