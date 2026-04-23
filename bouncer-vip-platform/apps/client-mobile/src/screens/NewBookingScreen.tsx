// ===========================================
// Client Mobile App - New Booking Screen
// ===========================================

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { format, addDays } from 'date-fns';
import api from '../services/api';
import { Venue } from '../types';

export const NewBookingScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [serviceType, setServiceType] = useState('standard');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('02:00');
  const [officerCount, setOfficerCount] = useState(2);
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadVenues();
  }, []);

  const loadVenues = async () => {
    try {
      const { data } = await api.getVenues();
      setVenues(data || []);
    } catch (error) {
      console.error('Load venues error:', error);
    }
  };

  const handleSubmit = async () => {
    if (!selectedVenue) {
      Alert.alert('Error', 'Please select a venue');
      return;
    }

    setLoading(true);
    try {
      await api.createBooking({
        venueId: selectedVenue.id,
        serviceType,
        requestedDate: date,
        startTime,
        endTime,
        officerCount,
        specialInstructions: instructions,
      });
      Alert.alert('Success', 'Booking request submitted successfully', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to submit booking request');
    } finally {
      setLoading(false);
    }
  };

  const serviceTypes = [
    { id: 'standard', name: 'Standard', description: 'Regular security coverage', color: '#3b82f6' },
    { id: 'event', name: 'Event', description: 'Special event coverage', color: '#8b5cf6' },
    { id: 'emergency', name: 'Emergency', description: 'Urgent security needs', color: '#ef4444' },
    { id: 'temporary', name: 'Temporary', description: 'Short-term assignment', color: '#f59e0b' },
  ];

  const timeSlots = [];
  for (let hour = 0; hour < 24; hour++) {
    timeSlots.push(`${hour.toString().padStart(2, '0')}:00`);
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backButton}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>New Booking</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Venue Selection */}
        <View style={styles.section}>
          <Text style={styles.label}>Select Venue</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {venues.map((venue) => (
              <TouchableOpacity
                key={venue.id}
                style={[
                  styles.venueCard,
                  selectedVenue?.id === venue.id && styles.venueCardSelected,
                ]}
                onPress={() => setSelectedVenue(venue)}
              >
                <Text style={styles.venueName}>{venue.name}</Text>
                <Text style={styles.venueAddress}>{venue.address}</Text>
                <View style={styles.venueMeta}>
                  <Text style={styles.venueCapacity}>Capacity: {venue.capacity}</Text>
                  <View style={[
                    styles.riskBadge,
                    { backgroundColor: venue.riskLevel === 'critical' ? '#ef4444' : venue.riskLevel === 'high' ? '#f59e0b' : '#22c55e' }
                  ]}>
                    <Text style={styles.riskText}>{venue.riskLevel}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Service Type */}
        <View style={styles.section}>
          <Text style={styles.label}>Service Type</Text>
          <View style={styles.optionsRow}>
            {serviceTypes.map((type) => (
              <TouchableOpacity
                key={type.id}
                style={[
                  styles.optionCard,
                  serviceType === type.id && { borderColor: type.color, backgroundColor: type.color + '20' },
                ]}
                onPress={() => setServiceType(type.id)}
              >
                <View style={[styles.optionDot, { backgroundColor: type.color }]} />
                <View>
                  <Text style={styles.optionTitle}>{type.name}</Text>
                  <Text style={styles.optionDesc}>{type.description}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Date & Time */}
        <View style={styles.section}>
          <Text style={styles.label}>Date & Time</Text>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Date</Text>
            <TextInput
              style={styles.input}
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
            />
          </View>
          <View style={styles.row}>
            <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
              <Text style={styles.inputLabel}>Start Time</Text>
              <TextInput
                style={styles.input}
                value={startTime}
                onChangeText={setStartTime}
                placeholder="HH:MM"
              />
            </View>
            <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
              <Text style={styles.inputLabel}>End Time</Text>
              <TextInput
                style={styles.input}
                value={endTime}
                onChangeText={setEndTime}
                placeholder="HH:MM"
              />
            </View>
          </View>
        </View>

        {/* Officer Count */}
        <View style={styles.section}>
          <Text style={styles.label}>Number of Officers</Text>
          <View style={styles.counterRow}>
            <TouchableOpacity
              style={styles.counterButton}
              onPress={() => setOfficerCount(Math.max(1, officerCount - 1))}
            >
              <Text style={styles.counterButtonText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.counterValue}>{officerCount}</Text>
            <TouchableOpacity
              style={styles.counterButton}
              onPress={() => setOfficerCount(Math.min(20, officerCount + 1))}
            >
              <Text style={styles.counterButtonText}>+</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.counterHint}>Estimated: R{150 * officerCount * 8}/shift</Text>
        </View>

        {/* Special Instructions */}
        <View style={styles.section}>
          <Text style={styles.label}>Special Instructions (Optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={instructions}
            onChangeText={setInstructions}
            placeholder="Add any special requirements or notes..."
            multiline
            numberOfLines={4}
          />
        </View>

        {/* Submit */}
        <View style={[styles.section, { paddingBottom: 100 }]}>
          <TouchableOpacity
            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.submitButtonText}>
              {loading ? 'Submitting...' : 'Submit Booking Request'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  backButton: { fontSize: 16, color: '#3b82f6' },
  title: { fontSize: 18, fontWeight: '600', color: '#1e293b' },
  section: { padding: 20, paddingTop: 0 },
  label: { fontSize: 16, fontWeight: '600', color: '#1e293b', marginBottom: 12 },
  venueCard: { width: 200, backgroundColor: '#fff', padding: 16, borderRadius: 12, marginRight: 12, borderWidth: 2, borderColor: 'transparent' },
  venueCardSelected: { borderColor: '#3b82f6', backgroundColor: '#eff6ff' },
  venueName: { fontSize: 16, fontWeight: '600', color: '#1e293b', marginBottom: 4 },
  venueAddress: { fontSize: 13, color: '#64748b', marginBottom: 8 },
  venueMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  venueCapacity: { fontSize: 12, color: '#64748b' },
  riskBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  riskText: { fontSize: 10, color: '#fff', textTransform: 'uppercase' },
  optionsRow: { gap: 12 },
  optionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 16, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  optionDot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 },
  optionTitle: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  optionDesc: { fontSize: 12, color: '#64748b' },
  inputGroup: { marginBottom: 16 },
  inputLabel: { fontSize: 14, color: '#64748b', marginBottom: 8 },
  input: { backgroundColor: '#fff', padding: 16, borderRadius: 12, fontSize: 16, color: '#1e293b' },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  row: { flexDirection: 'row' },
  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', padding: 16, borderRadius: 12 },
  counterButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#3b82f6', justifyContent: 'center', alignItems: 'center' },
  counterButtonText: { fontSize: 24, color: '#fff', fontWeight: '600' },
  counterValue: { fontSize: 32, fontWeight: 'bold', color: '#1e293b', marginHorizontal: 32 },
  counterHint: { fontSize: 14, color: '#64748b', textAlign: 'center', marginTop: 8 },
  submitButton: { backgroundColor: '#3b82f6', padding: 18, borderRadius: 12, alignItems: 'center' },
  submitButtonDisabled: { backgroundColor: '#94a3b8' },
  submitButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});

export default NewBookingScreen;