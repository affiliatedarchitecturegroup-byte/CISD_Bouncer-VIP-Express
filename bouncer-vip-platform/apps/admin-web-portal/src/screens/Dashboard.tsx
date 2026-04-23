// ===========================================
// Admin Web Portal - Main Dashboard
// ===========================================

import { useState, useEffect } from 'react';
import { 
  Card, Row, Col, Statistic, Table, Tag, Button, Space, 
  Typography, Spin, DatePicker, Avatar, List, Badge, Progress 
} from 'antd';
import { 
  UserOutlined, ShopOutlined, CalendarOutlined, 
  DollarOutlined, AlertOutlined, RiseOutlined, 
  ClockCircleOutlined, CheckCircleOutlined, SyncOutlined 
} from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import dayjs from 'dayjs';
import { dashboardApi, bookingsApi, incidentsApi, officersApi } from '../services/api';
import type { DashboardStats, Booking, Incident, Officer } from '../types';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentBookings, setRecentBookings] = useState<Booking[]>([]);
  const [recentIncidents, setRecentIncidents] = useState<Incident[]>([]);
  const [topOfficers, setTopOfficers] = useState<Officer[]>([]);
  const [revenueData, setRevenueData] = useState<any[]>([]);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const [statsRes, bookingsRes, incidentsRes, officersRes, revenueRes] = await Promise.all([
        dashboardApi.getStats(),
        bookingsApi.list({ status: 'pending', limit: 5 }),
        incidentsApi.list({ status: 'open', limit: 5 }),
        officersApi.list({ limit: 5, sortBy: 'rating' }),
        dashboardApi.getRevenueChart(30),
      ]);

      setStats(statsRes.data);
      setRecentBookings(bookingsRes.data?.data || []);
      setRecentIncidents(incidentsRes.data?.data || []);
      setTopOfficers(officersRes.data?.data || []);
      setRevenueData(revenueRes.data || []);
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    const colors: Record<string, string> = {
      critical: 'red',
      high: 'orange',
      medium: 'blue',
      low: 'green',
    };
    return colors[severity] || 'default';
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'gold',
      confirmed: 'blue',
      in_progress: 'purple',
      completed: 'green',
      cancelled: 'red',
    };
    return colors[status] || 'default';
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={2} style={{ margin: 0 }}>Dashboard</Title>
          <Text type="secondary">Welcome back! Here's what's happening today.</Text>
        </div>
        <Space>
          <RangePicker />
          <Button type="primary" icon={<SyncOutlined />} onClick={loadDashboard}>
            Refresh
          </Button>
        </Space>
      </div>

      {/* Stats Cards */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Total Officers"
              value={stats?.totalOfficers || 0}
              prefix={<UserOutlined />}
              suffix={<Text type="secondary">/ {stats?.activeOfficers || 0} active</Text>}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Active Venues"
              value={stats?.totalVenues || 0}
              prefix={<ShopOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Active Bookings"
              value={stats?.activeBookings || 0}
              prefix={<CalendarOutlined />}
              valueStyle={{ color: '#3b82f6' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Monthly Revenue"
              value={stats?.monthlyRevenue || 0}
              prefix={<DollarOutlined />}
              precision={0}
              formatter={(value) => `R${Number(value).toLocaleString()}`}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Pending Invoices"
              value={stats?.pendingInvoices || 0}
              prefix={<DollarOutlined />}
              valueStyle={{ color: '#f59e0b' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Open Incidents"
              value={stats?.openIncidents || 0}
              prefix={<AlertOutlined />}
              valueStyle={{ color: stats?.openIncidents ? '#ef4444' : '#22c55e' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Attendance Rate"
              value={stats?.attendanceRate || 0}
              prefix={<CheckCircleOutlined />}
              suffix="%"
            />
            <Progress 
              percent={stats?.attendanceRate || 0} 
              status={stats?.attendanceRate && stats?.attendanceRate > 90 ? 'success' : 'normal'}
              showInfo={false}
              style={{ marginTop: 8 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Growth"
              value={12.5}
              prefix={<RiseOutlined />}
              suffix="%"
              valueStyle={{ color: '#22c55e' }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>vs last month</Text>
          </Card>
        </Col>
      </Row>

      {/* Charts */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card title="Revenue Overview">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value: number) => `R${value.toLocaleString()}`} />
                <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="Top Officers">
            <List
              dataSource={topOfficers}
              renderItem={(officer, index) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={<Avatar>{officer.firstName[0]}{officer.lastName[0]}</Avatar>}
                    title={`${officer.firstName} ${officer.lastName}`}
                    description={
                      <Space>
                        <Tag color="blue">{officer.grade}</Tag>
                        <Text type="secondary">{officer.shiftsCompleted} shifts</Text>
                      </Space>
                    }
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Text strong>{officer.rating}</Text>
                    <StarIcon />
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      {/* Recent Activity */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card 
            title="Recent Bookings" 
            extra={<Button type="link" href="/bookings">View All</Button>}
          >
            <Table
              dataSource={recentBookings}
              columns={[
                { title: 'Venue', dataIndex: 'venueName', key: 'venue' },
                { title: 'Date', dataIndex: 'requestedDate', key: 'date', render: (d) => dayjs(d).format('MMM D') },
                { title: 'Officers', dataIndex: 'officerCount', key: 'officers' },
                { 
                  title: 'Status', 
                  dataIndex: 'status', 
                  key: 'status',
                  render: (s) => <Tag color={getStatusColor(s)}>{s}</Tag>
                },
              ]}
              pagination={false}
              size="small"
              rowKey="id"
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card 
            title="Recent Incidents" 
            extra={<Button type="link" href="/incidents">View All</Button>}
          >
            <List
              dataSource={recentIncidents}
              renderItem={(incident) => (
                <List.Item>
                  <List.Item.Meta
                    title={incident.title}
                    description={dayjs(incident.createdAt).format('MMM D, HH:mm')}
                  />
                  <Tag color={getSeverityColor(incident.severity)}>
                    {incident.severity}
                  </Tag>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function StarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#f59e0b">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}