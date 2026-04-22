// ===========================================
// Guard Mobile App - Type Definitions
// ===========================================

export interface Officer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  psira_number: string;
  grade: 'A' | 'B' | 'C' | 'D' | 'E';
  status: 'active' | 'inactive' | 'suspended';
  profile_image_url?: string;
  biometric_enrolled: boolean;
}

export interface Shift {
  id: string;
  officer_id: string;
  venue_id: string;
  venue_name: string;
  venue_address: string;
  start_time: string;
  end_time: string;
  status: 'scheduled' | 'clocked_in' | 'clocked_out' | 'no_show' | 'cancelled';
  hourly_rate: number;
  actual_hours?: number;
  check_in_time?: string;
  check_out_time?: string;
  gps_coordinates?: { lat: number; lng: number };
  notes?: string;
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
  current_attendance?: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  contact_person?: string;
  contact_phone?: string;
}

export interface Incident {
  id: string;
  shift_id: string;
  venue_id: string;
  officer_id: string;
  incident_type: 'theft' | 'assault' | 'trespassing' | 'noise' | 'drugs' | 'weapon' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  location?: { lat: number; lng: number };
  evidence_images?: string[];
  created_at: string;
  status: 'open' | 'investigating' | 'resolved' | 'closed';
}

export interface Availability {
  id: string;
  officer_id: string;
  date: string;
  slots: TimeSlot[];
}

export interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

export interface EmergencyBooking {
  id: string;
  venue_id: string;
  venue_name: string;
  service_type: 'emergency' | 'temporary' | 'event';
  requested_date: string;
  officer_count: number;
  special_instructions?: string;
  status: 'pending' | 'assigned' | 'completed' | 'cancelled';
}

export interface Notification {
  id: string;
  type: 'shift' | 'emergency' | 'incident' | 'payroll' | 'announcement';
  title: string;
  message: string;
  data?: Record<string, any>;
  read: boolean;
  created_at: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};