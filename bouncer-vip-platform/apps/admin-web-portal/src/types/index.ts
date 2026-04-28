// ===========================================
// Admin Web Portal - Types
// ===========================================

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'supervisor';
  phone?: string;
  avatar?: string;
  status: 'active' | 'inactive' | 'suspended';
  createdAt: string;
}

export interface Officer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  grade: 'A' | 'B' | 'C' | 'D' | 'E';
  status: 'active' | 'inactive' | 'on_leave';
  skills: string[];
  psiraNumber: string;
  psiraExpiry: string;
  rating: number;
  shiftsCompleted: number;
  avatar?: string;
}

export interface Venue {
  id: string;
  name: string;
  address: string;
  city: string;
  province: string;
  latitude: number;
  longitude: number;
  capacity: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  contactPerson: string;
  contactPhone: string;
  status: 'active' | 'inactive';
}

export interface Booking {
  id: string;
  venueId: string;
  venueName: string;
  clientName: string;
  serviceType: 'standard' | 'emergency' | 'temporary' | 'event';
  requestedDate: string;
  startTime: string;
  endTime: string;
  officerCount: number;
  status: 'pending' | 'confirmed' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  totalAmount: number;
  createdAt: string;
}

export interface Shift {
  id: string;
  officerId: string;
  officerName: string;
  venueId: string;
  venueName: string;
  startTime: string;
  endTime: string;
  status: 'scheduled' | 'clocked_in' | 'completed' | 'cancelled';
  checkInTime?: string;
  checkOutTime?: string;
  actualHours?: number;
}

export interface Incident {
  id: string;
  title: string;
  description: string;
  incidentType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved' | 'closed';
  venueId: string;
  venueName: string;
  reportedBy: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  clientName: string;
  venueName: string;
  amount: number;
  vatAmount: number;
  totalAmount: number;
  dueDate: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  paidAt?: string;
  createdAt: string;
}

export interface DashboardStats {
  totalOfficers: number;
  activeOfficers: number;
  totalVenues: number;
  activeBookings: number;
  pendingInvoices: number;
  openIncidents: number;
  monthlyRevenue: number;
  attendanceRate: number;
}

export interface ChartData {
  date: string;
  revenue: number;
  bookings: number;
  incidents: number;
}

export interface Notification {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
  };
}