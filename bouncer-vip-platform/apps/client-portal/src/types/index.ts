// ===========================================
// Client Portal - Types
// ===========================================

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company?: string;
  phone?: string;
  vatNumber?: string;
  createdAt: string;
}

export interface MyBooking {
  id: string;
  venueName: string;
  venueAddress: string;
  serviceType: string;
  date: string;
  startTime: string;
  endTime: string;
  officerCount: number;
  status: string;
  totalAmount: number;
  officers: { name: string; phone?: string }[];
}

export interface MyInvoice {
  id: string;
  invoiceNumber: string;
  amount: number;
  vatAmount: number;
  totalAmount: number;
  dueDate: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  paidAt?: string;
  items: { description: string; quantity: number; rate: number; amount: number }[];
}

export interface MyIncident {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'investigating' | 'resolved' | 'closed';
  severity: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface DashboardStats {
  activeBookings: number;
  totalSpent: number;
  pendingInvoices: number;
  openIncidents: number;
}