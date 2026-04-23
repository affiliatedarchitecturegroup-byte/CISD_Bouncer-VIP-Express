// ===========================================
// Client Portal - Main Dashboard
// ===========================================

import { useState, useEffect } from 'react';
import { 
  Container, Grid, Card, Button, Text, Badge, Avatar, 
  Spacer, Divider, Table, Tag, Input, Modal, Form 
} from '@nextui-org/react';
import { FaCalendarAlt, FaFileInvoiceDollar, FaShieldAlt, FaPlus, 
         FaClock, FaMapMarkerAlt, FaUserShield, FaBell } from 'react-icons/fa';
import dayjs from 'dayjs';
import { dashboardApi, bookingsApi, invoicesApi } from '../services/api';
import type { DashboardStats, MyBooking, MyInvoice } from '../types';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [invoices, setInvoices] = useState<MyInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBookingModal, setShowBookingModal] = useState(false);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const [statsRes, bookingsRes, invoicesRes] = await Promise.all([
        dashboardApi.getStats(),
        bookingsApi.list({ limit: 5 }),
        invoicesApi.list({ limit: 5 }),
      ]);
      setStats(statsRes.data);
      setBookings(bookingsRes.data?.data || []);
      setInvoices(invoicesRes.data?.data || []);
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'warning',
      confirmed: 'primary',
      in_progress: 'secondary',
      completed: 'success',
      cancelled: 'error',
      paid: 'success',
      overdue: 'error',
    };
    return colors[status] || 'default';
  };

  return (
    <Container fluid>
      <Spacer y={2} />
      
      {/* Header */}
      <Grid.Container>
        <Grid xs={12} md={6}>
          <div>
            <Text h2>Welcome back</Text>
            <Text color>Here's what's happening with your account.</Text>
          </div>
        </Grid>
        <Grid xs={12} md={6} justify="flex-end">
          <Button 
            icon={<FaPlus />} 
            color="primary"
            onClick={() => setShowBookingModal(true)}
          >
            New Booking
          </Button>
        </Grid>
      </Grid.Container>

      <Spacer y={2} />

      {/* Stats Cards */}
      <Grid.Container gap={2}>
        <Grid xs={12} sm={6} md={3}>
          <Card>
            <Card.Body>
              <Grid.Container alignItems="center">
                <Grid>
                  <Avatar icon={<FaCalendarAlt />} size="lg" color="primary" />
                </Grid>
                <Spacer x={1} />
                <Grid>
                  <Text small color>Active Bookings</Text>
                  <Text h3>{stats?.activeBookings || 0}</Text>
                </Grid>
              </Grid.Container>
            </Card.Body>
          </Card>
        </Grid>
        <Grid xs={12} sm={6} md={3}>
          <Card>
            <Card.Body>
              <Grid.Container alignItems="center">
                <Grid>
                  <Avatar icon={<FaFileInvoiceDollar />} size="lg" color="warning" />
                </Grid>
                <Spacer x={1} />
                <Grid>
                  <Text small>Pending Invoices</Text>
                  <Text h3>R{(stats?.pendingInvoices || 0).toLocaleString()}</Text>
                </Grid>
              </Grid.Container>
            </Card.Body>
          </Card>
        </Grid>
        <Grid xs={12} sm={6} md={3}>
          <Card>
            <Card.Body>
              <Grid.Container alignItems="center">
                <Grid>
                  <Avatar icon={<FaShieldAlt />} size="lg" color="success" />
                </Grid>
                <Spacer x={1} />
                <Grid>
                  <Text small>Total Spent</Text>
                  <Text h3>R{(stats?.totalSpent || 0).toLocaleString()}</Text>
                </Grid>
              </Grid.Container>
            </Card.Body>
          </Card>
        </Grid>
        <Grid xs={12} sm={6} md={3}>
          <Card>
            <Card.Body>
              <Grid.Container alignItems="center">
                <Grid>
                  <Avatar icon={<FaBell />} size="lg" color="error" />
                </Grid>
                <Spacer x={1} />
                <Grid>
                  <Text small>Open Incidents</Text>
                  <Text h3>{stats?.openIncidents || 0}</Text>
                </Grid>
              </Grid.Container>
            </Card.Body>
          </Card>
        </Grid>
      </Grid.Container>

      <Spacer y={2} />

      {/* Content */}
      <Grid.Container gap={2}>
        {/* Recent Bookings */}
        <Grid xs={12} md={7}>
          <Card>
            <Card.Header>
              <Text h4>Recent Bookings</Text>
            </Card.Header>
            <Card.Body>
              {bookings.length === 0 ? (
                <Text color>No bookings yet</Text>
              ) : (
                <Table aria-label="Bookings">
                  <Table.Header>
                    <Table.Column>Venue</Table.Column>
                    <Table.Column>Date</Table.Column>
                    <Table.Column>Officers</Table.Column>
                    <Table.Column>Status</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {bookings.map((booking) => (
                      <Table.Row key={booking.id}>
                        <Table.Cell>
                          <Text>{booking.venueName}</Text>
                          <Text small color>{booking.venueAddress}</Text>
                        </Table.Cell>
                        <Table.Cell>
                          {dayjs(booking.date).format('MMM D, YYYY')}
                          <br />
                          <Text small color>{booking.startTime} - {booking.endTime}</Text>
                        </Table.Cell>
                        <Table.Cell>{booking.officerCount}</Table.Cell>
                        <Table.Cell>
                          <Tag color={getStatusColor(booking.status)}>
                            {booking.status}
                          </Tag>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              )}
            </Card.Body>
          </Card>
        </Grid>

        {/* Invoices */}
        <Grid xs={12} md={5}>
          <Card>
            <Card.Header>
              <Text h4>Recent Invoices</Text>
            </Card.Header>
            <Card.Body>
              {invoices.length === 0 ? (
                <Text color>No invoices</Text>
              ) : (
                <Grid.Container gap={1}>
                  {invoices.map((invoice) => (
                    <Grid key={invoice.id} xs={12}>
                      <Card variant="bordered">
                        <Card.Body>
                          <Grid.Container justify="space-between">
                            <Grid>
                              <Text b>{invoice.invoiceNumber}</Text>
                              <br />
                              <Text small color>
                                Due: {dayjs(invoice.dueDate).format('MMM D, YYYY')}
                              </Text>
                            </Grid>
                            <Grid>
                              <Text b>R{invoice.totalAmount.toLocaleString()}</Text>
                              <Tag color={getStatusColor(invoice.status)} css={{ ml: 4 }}>
                                {invoice.status}
                              </Tag>
                            </Grid>
                          </Grid.Container>
                        </Card.Body>
                      </Card>
                    </Grid>
                  ))}
                </Grid.Container>
              )}
            </Card.Body>
          </Card>
        </Grid>
      </Grid.Container>

      {/* New Booking Modal */}
      <Modal open={showBookingModal} onClose={() => setShowBookingModal(false)} size="large">
        <Modal.Header>
          <Text h3>Create New Booking</Text>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Input label="Venue" placeholder="Select venue" />
            <Spacer y={1} />
            <Grid.Container gap={1}>
              <Grid xs={6}>
                <Input label="Date" type="date" />
              </Grid>
              <Grid xs={3}>
                <Input label="Start Time" type="time" />
              </Grid>
              <Grid xs={3}>
                <Input label="End Time" type="time" />
              </Grid>
            </Grid.Container>
            <Spacer y={1} />
            <Input label="Number of Officers" type="number" />
            <Spacer y={1} />
            <Input label="Special Instructions" multiline rows={3} />
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button flat onClick={() => setShowBookingModal(false)}>Cancel</Button>
          <Button color="primary" onClick={() => setShowBookingModal(false)}>Submit</Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}