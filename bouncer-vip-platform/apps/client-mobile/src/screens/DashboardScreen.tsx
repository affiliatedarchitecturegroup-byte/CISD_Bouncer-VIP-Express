// ===========================================
// Client Mobile App - Dashboard Screen
// ===========================================

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { format, isToday, isTomorrow } from 'date-fns';
import api from '../services/api';
import { DashboardStats, BookingRequest, Notification } from '../types';

export const DashboardScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [bookings, setBookings] = useState<BookingRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const [statsRes, bookingsRes, notifRes] = await Promise.all([
        api.getDashboardStats(),
        api.getBookings({ status: 'confirmed' }),
        api.getNotifications(),
      ]);
      setStats(statsRes.data);
      setBookings(bookingsRes.data?.slice(0, 3) || []);
      setNotifications(notifRes.data?.slice(0, 5) || []);
    } catch (error) {
      console.error('Dashboard load error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboard();
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: '#f59e0b',
      confirmed: '#3b82f6',
      assigned: '#8b5cf6',
      in_progress: '#22c55e',
      completed: '#6b7280',
      cancelled: '#ef4444',
    };
    return colors[status] || '#6b7280';
  };

  const formatDate = (date: string) => {
    const d = new Date(date);
    if (isToday(d)) return 'Today';
    if (isTomorrow(d)) return 'Tomorrow';
    return format(d, 'EEE, MMM d');
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Welcome back</Text>
            <Text style={styles.title}>Dashboard</Text>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>C</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Quick Stats */}
        <View style={styles.statsContainer}>
          <TouchableOpacity style={styles.statCard} onPress={() => navigation.navigate('Bookings')}>
            <Text style={styles.statValue}>{stats?.activeBookings || 0}</Text>
            <Text style={styles.statLabel}>Active Bookings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.statCard} onPress={() => navigation.navigate('Invoices')}>
            <Text style={styles.statValue}>R{(stats?.pendingInvoices || 0).toLocaleString()}</Text>
            <Text style={styles.statLabel}>Pending Invoices</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.statsContainer}>
          <TouchableOpacity style={styles.statCard} onPress={() => navigation.navigate('Incidents')}>
            <Text style={styles.statValue}>{stats?.openIncidents || 0}</Text>
            <Text style={styles.statLabel}>Open Incidents</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.statCard}>
            <Text style={styles.statValue}>{stats?.attendanceRate || 0}%</Text>
            <Text style={styles.statLabel}>Attendance</Text>
          </TouchableOpacity>
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#3b82f6' }]}
              onPress={() => navigation.navigate('NewBooking')}
            >
              <Text style={styles.actionIcon}>📅</Text>
              <Text style={styles.actionText}>New{'\n'}Booking</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#ef4444' }]}
              onPress={() => navigation.navigate('Incidents')}
            >
              <Text style={styles.actionIcon}>⚠️</Text>
              <Text style={styles.actionText}>Report{'\n'}Incident</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#22c55e' }]}
              onPress={() => navigation.navigate('Settings')}
            >
              <Text style={styles.actionIcon}>⚙️</Text>
              <Text style={styles.actionText}>Settings</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Upcoming Bookings */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Upcoming Bookings</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Bookings')}>
              <Text style={styles.viewAll}>View All</Text>
            </TouchableOpacity>
          </View>
          {bookings.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No upcoming bookings</Text>
            </View>
          ) : (
            bookings.map((booking) => (
              <TouchableOpacity
                key={booking.id}
                style={styles.bookingCard}
                onPress={() => navigation.navigate('BookingDetail', { bookingId: booking.id })}
              >
                <View style={styles.bookingHeader}>
                  <Text style={styles.bookingVenue}>{booking.venueName}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(booking.status) }]}>
                    <Text style={styles.statusText}>{booking.status}</Text>
                  </View>
                </View>
                <Text style={styles.bookingDate}>
                  {formatDate(booking.requestedDate)} • {booking.officerCount} officers
                </Text>
                <Text style={styles.bookingAmount}>
                  R{booking.totalAmount?.toLocaleString() || '0'}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Recent Notifications */}
        <View style={[styles.section, { marginBottom: 100 }]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Notifications</Text>
            <TouchableOpacity>
              <Text style={styles.viewAll}>Mark All Read</Text>
            </TouchableOpacity>
          </View>
          {notifications.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No notifications</Text>
            </View>
          ) : (
            notifications.map((notif) => (
              <TouchableOpacity key={notif.id} style={styles.notificationItem}>
                <View style={[styles.notifDot, !notif.read && { backgroundColor: '#3b82f6' }]} />
                <View style={styles.notifContent}>
                  <Text style={styles.notifTitle}>{notif.title}</Text>
                  <Text style={styles.notifMessage}>{notif.message}</Text>
                  <Text style={styles.notifTime}>
                    {format(new Date(notif.createdAt), 'MMM d, h:mm a')}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 16, color: '#64748b' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  greeting: { fontSize: 14, color: '#64748b' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1e293b' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#3b82f6', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  statsContainer: { flexDirection: 'row', paddingHorizontal: 20, gap: 12, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: '#fff', padding: 16, borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  statValue: { fontSize: 24, fontWeight: 'bold', color: '#1e293b' },
  statLabel: { fontSize: 12, color: '#64748b', marginTop: 4 },
  section: { padding: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1e293b' },
  viewAll: { fontSize: 14, color: '#3b82f6' },
  actionsRow: { flexDirection: 'row', gap: 12 },
  actionButton: { flex: 1, aspectRatio: 1.2, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  actionIcon: { fontSize: 24, marginBottom: 8 },
  actionText: { fontSize: 12, color: '#fff', textAlign: 'center', fontWeight: '500' },
  bookingCard: { backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  bookingHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  bookingVenue: { fontSize: 16, fontWeight: '600', color: '#1e293b' },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 12, color: '#fff', textTransform: 'capitalize' },
  bookingDate: { fontSize: 14, color: '#64748b', marginBottom: 4 },
  bookingAmount: { fontSize: 18, fontWeight: '600', color: '#22c55e' },
  emptyState: { backgroundColor: '#fff', padding: 24, borderRadius: 12, alignItems: 'center' },
  emptyText: { color: '#64748b' },
  notificationItem: { flexDirection: 'row', backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 8 },
  notifDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, marginRight: 12, backgroundColor: '#e2e8f0' },
  notifContent: { flex: 1 },
  notifTitle: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  notifMessage: { fontSize: 13, color: '#64748b', marginTop: 2 },
  notifTime: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
});

export default DashboardScreen;