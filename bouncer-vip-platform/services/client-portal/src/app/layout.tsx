import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Bouncer VIP - Client Portal',
  description: 'Venue security management portal',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-gray-50">
          <nav className="bg-white border-b border-gray-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between h-16">
                <div className="flex items-center">
                  <h1 className="text-xl font-bold text-brand-600">Bouncer VIP</h1>
                </div>
                <div className="flex items-center space-x-4">
                  <a href="/dashboard" className="text-gray-600 hover:text-gray-900">Dashboard</a>
                  <a href="/bookings" className="text-gray-600 hover:text-gray-900">Bookings</a>
                  <a href="/invoices" className="text-gray-600 hover:text-gray-900">Invoices</a>
                </div>
              </div>
            </div>
          </nav>
          <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </body>
    </html>
  );
}