// ===========================================
// Client Mobile App - Type Definitions
// ===========================================

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: string;
  vatNumber?: string;
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
  contactPerson?: string;
  contactPhone?: string;
}

export interface BookingRequest {
  id: string;
  venueId: string;
  venueName: string;
  serviceType: 'standard' | 'emergency' | 'temporary' | 'event';
  requestedDate: string;
  startTime: string;
  endTime: string;
  officerCount: number;
  hourlyRate: number;
  specialInstructions?: string;
  status: 'pending' | 'confirmed' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  assignedOfficers?: OfficerAssignment[];
  totalAmount?: number;
  createdAt: string;
}

export interface OfficerAssignment {
  officerId: string;
  officerName: string;
  officerPhone?: string;
  checkInTime?: string;
  checkOutTime?: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  venueName: string;
  amount: number;
  vatAmount: number;
  totalAmount: number;
  dueDate: string;
  status: 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue';
  paidAt?: string;
  createdAt: string;
}

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved' | 'closed';
  location?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface Notification {
  id: string;
  type: 'booking' | 'invoice' | 'incident' | 'shift' | 'system';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface DashboardStats {
  activeBookings: number;
  pendingInvoices: number;
  totalOfficers: number;
  openIncidents: number;
  monthlySpend: number;
  attendanceRate: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  Login: undefined;
  Register: undefined;
  Dashboard: undefined;
  Bookings: undefined;
  BookingDetail: { bookingId: string };
  NewBooking: undefined;
  Invoices: undefined;
  InvoiceDetail: { invoiceId: string };
  Incidents: undefined;
  IncidentDetail: { incidentId: string };
  Settings: undefined;
  Profile: undefined;
};