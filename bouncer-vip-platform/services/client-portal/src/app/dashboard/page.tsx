'use client';
import { useEffect, useState } from 'react';

interface DashboardStats { active_shifts: number; active_deployments: number; open_incidents: number; venue_alerts: number; }

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({ active_shifts: 0, active_deployments: 0, open_incidents: 0, venue_alerts: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/monitoring/dashboard').then((r) => r.json()).then((d) => { setStats(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const cards = [
    { label: 'Active Shifts', value: stats.active_shifts, color: 'bg-blue-500' },
    { label: 'Active Deployments', value: stats.active_deployments, color: 'bg-green-500' },
    { label: 'Open Incidents', value: stats.open_incidents, color: 'bg-red-500' },
    { label: 'Venue Alerts', value: stats.venue_alerts, color: 'bg-yellow-500' },
  ];

  return (
    <div className="px-4">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      {loading ? <p>Loading...</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((card) => (
            <div key={card.label} className={`${card.color} rounded-lg p-6 text-white`}>
              <p className="text-sm opacity-80">{card.label}</p>
              <p className="text-3xl font-bold">{card.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}