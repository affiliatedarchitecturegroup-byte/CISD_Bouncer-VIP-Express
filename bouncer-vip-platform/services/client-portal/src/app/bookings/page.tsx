'use client';
import { useEffect, useState } from 'react';

interface Booking { id: string; status: string; requested_date: string; service_type: string; officer_count: number; estimated_price: number; }

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/on-demand/bookings').then((r) => r.json()).then((b) => { setBookings(b); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const statusColors: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-800', confirmed: 'bg-blue-100 text-blue-800', completed: 'bg-green-100 text-green-800', cancelled: 'bg-red-100 text-red-800' };

  return (
    <div className="px-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Bookings</h1>
        <button className="bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700">New Booking</button>
      </div>
      {loading ? <p>Loading...</p> : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50"><tr><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Officers</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Price</th><th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th></tr></thead>
            <tbody className="divide-y divide-gray-200">
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">{new Date(b.requested_date).toLocaleDateString()}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">{b.service_type}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">{b.officer_count}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">R{b.estimated_price}</td>
                  <td className="px-6 py-4 whitespace-nowrap"><span className={`px-2 py-1 text-xs rounded-full ${statusColors[b.status] || 'bg-gray-100'}`}>{b.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}