// ===========================================
// Dashboard Screen - Main Home
// ===========================================

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { format, isToday, isTomorrow } from 'date-fns';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootState } from '../store';

type Props = NativeStackScreenProps<any, 'Dashboard'>;

export const DashboardScreen: React.FC<Props> = ({ navigation }) => {
  const { user } = useSelector((state: RootState) => state.auth);
  const { shifts } = useSelector((state: RootState) => state.shifts);

  const todayShifts = shifts.filter((s) => s.start_time && isToday(new Date(s.start_time)));
  const upcomingShift = todayShifts[0];

  const formatShiftDate = (date: string) => {
    const d = new Date(date);
    if (isToday(d)) return 'Today';
    if (isTomorrow(d)) return 'Tomorrow';
    return format(d, 'EEE, MMM d');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'clocked_in': return '#22c55e';
      case 'scheduled': return '#3b82f6';
      case 'clocked_out': return '#6b7280';
      default: return '#6b7280';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Welcome back,</Text>
            <Text style={styles.name}>{user?.first_name || 'Guard'}</Text>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
            <Image source={{ uri: user?.profile_image_url }} style={styles.avatar} />
          </TouchableOpacity>
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity 
            style={[styles.actionButton, { backgroundColor: '#ef4444' }]}
            onPress={() => navigation.navigate('IncidentReport', { shiftId: upcomingShift?.id })}
          >
            <Text style={styles.actionIcon}>⚠️</Text>
            <Text style={styles.actionText}>Report{'\n'}Incident</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.actionButton, { backgroundColor: '#f59e0b' }]}
            onPress={() => navigation.navigate('EmergencyBooking')}
          >
            <Text style={styles.actionIcon}>🚨</Text>
            <Text style={styles.actionText}>Emergency{'\n'}Booking</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.actionButton, { backgroundColor: '#3b82f6' }]}
            onPress={() => navigation.navigate('SetAvailability')}
          >
            <Text style={styles.actionIcon}>📅</Text>
            <Text style={styles.actionText}>Set{'\n'}Availability</Text>
          </TouchableOpacity>
        </View>

        {/* Today's Shift */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Today's Shift</Text>
          {upcomingShift ? (
            <TouchableOpacity 
              style={styles.shiftCard}
              onPress={() => navigation.navigate('ShiftDetail', { shiftId: upcomingShift.id })}
            >
              <View style={styles.shiftHeader}>
                <Text style={styles.venueName}>{upcomingShift.venue_name}</Text>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(upcomingShift.status) }]}>
                  <Text style={styles.statusText}>{upcomingShift.status.replace('_', ' ')}</Text>
                </View>
              </View>
              <Text style={styles.shiftTime}>
                {format(new Date(upcomingShift.start_time), 'h:mm a')} - {format(new Date(upcomingShift.end_time), 'h:mm a')}
              </Text>
              <Text style={styles.shiftAddress}>{upcomingShift.venue_address}</Text>
              <View style={styles.shiftActions}>
                {upcomingShift.status === 'scheduled' && (
                  <TouchableOpacity style={styles.checkInButton}>
                    <Text style={styles.checkInText}>Check In</Text>
                  </TouchableOpacity>
                )}
                {upcomingShift.status === 'clocked_in' && (
                  <TouchableOpacity style={styles.checkOutButton}>
                    <Text style={styles.checkOutText}>Check Out</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          ) : (
            <View style={styles.noShift}>
              <Text style={styles.noShiftText}>No shifts scheduled for today</Text>
            </View>
          )}
        </View>

        {/* Upcoming Shifts */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Upcoming Shifts</Text>
          {todayShifts.slice(1).map((shift) => (
            <TouchableOpacity 
              key={shift.id}
              style={styles.upcomingShift}
              onPress={() => navigation.navigate('ShiftDetail', { shiftId: shift.id })}
            >
              <View>
                <Text style={styles.upcomingDate}>{formatShiftDate(shift.start_time)}</Text>
                <Text style={styles.upcomingVenue}>{shift.venue_name}</Text>
                <Text style={styles.upcomingTime}>
                  {format(new Date(shift.start_time), 'h:mm a')} - {format(new Date(shift.end_time), 'h:mm a')}
                </Text>
              </View>
              <View style={[styles.statusDot, { backgroundColor: getStatusColor(shift.status) }]} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Stats */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>This Week</Text>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{todayShifts.length}</Text>
              <Text style={styles.statLabel}>Shifts</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>
                R{source.reduce((sum, s) => sum + (s.actual_hours || 0) * s.hourly_rate, 0).toFixed(0)}
              </Text>
              <Text style={styles.statLabel}>Earnings</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>0</Text>
              <Text style={styles.statLabel}>Incidents</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  greeting: { fontSize: 16, color: '#9ca3af' },
  name: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  quickActions: { flexDirection: 'row', paddingHorizontal: 20, gap: 12 },
  actionButton: { flex: 1, aspectRatio: 1, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  actionIcon: { fontSize: 24, marginBottom: 4 },
  actionText: { fontSize: 12, color: '#fff', textAlign: 'center' },
  section: { padding: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 12 },
  shiftCard: { backgroundColor: '#16213e', borderRadius: 16, padding: 16 },
  shiftHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  venueName: { fontSize: 18, fontWeight: '600', color: '#fff' },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 12, color: '#fff', textTransform: 'capitalize' },
  shiftTime: { fontSize: 16, color: '#3b82f6', marginBottom: 4 },
  shiftAddress: { fontSize: 14, color: '#9ca3af' },
  shiftActions: { flexDirection: 'row', marginTop: 16, gap: 12 },
  checkInButton: { flex: 1, backgroundColor: '#22c55e', padding: 12, borderRadius: 12, alignItems: 'center' },
  checkInText: { color: '#fff', fontWeight: '600' },
  checkOutButton: { flex: 1, backgroundColor: '#ef4444', padding: 12, borderRadius: 12, alignItems: 'center' },
  checkOutText: { color: '#fff', fontWeight: '600' },
  noShift: { backgroundColor: '#16213e', padding: 24, borderRadius: 16, alignItems: 'center' },
  noShiftText: { color: '#9ca3af' },
  upcomingShift: { backgroundColor: '#16213e', padding: 16, borderRadius: 12, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between' },
  upcomingDate: { fontSize: 14, color: '#3b82f6', marginBottom: 4 },
  upcomingVenue: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 4 },
  upcomingTime: { fontSize: 14, color: '#9ca3af' },
  statusDot: { width: 12, height: 12, borderRadius: 6, alignSelf: 'center' },
  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: { flex: 1, backgroundColor: '#16213e', padding: 16, borderRadius: 12, alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  statLabel: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
});

export default DashboardScreen;