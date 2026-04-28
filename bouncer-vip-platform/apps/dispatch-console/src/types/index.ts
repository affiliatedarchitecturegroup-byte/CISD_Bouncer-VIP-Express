// ===========================================
// Dispatch Console - Types
// ===========================================

export interface DispatchCall {
  id: string;
  type: 'emergency' | 'backup' | 'incident' | 'routine';
  priority: 'critical' | 'high' | 'medium' | 'low';
  location: { lat: number; lng: number; address: string };
  description: string;
  status: 'pending' | 'dispatched' | 'en_route' | 'on_scene' | 'resolved';
  assignedOfficers: string[];
  createdAt: string;
}

export interface OfficerLocation {
  id: string;
  name: string;
  location: { lat: number; lng: number };
  status: 'available' | 'busy' | 'off_duty';
  currentCall?: string;
}

export interface ActiveIncident {
  id: string;
  title: string;
  type: string;
  severity: string;
  location: string;
  assignedOfficers: number;
  status: string;
  createdAt: string;
}

export interface MapMarker {
  id: string;
  position: [number, number];
  type: 'officer' | 'incident' | 'venue';
  data: any;
}