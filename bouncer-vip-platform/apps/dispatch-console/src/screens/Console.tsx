// ===========================================
// Dispatch Console - Main Console View
// ===========================================

import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Card, Row, Col, Badge, Button, Tag, List, Input, Select, 
         Typography, Space, Avatar, Statistic, Alert } from 'antd';
import { 
  AlertOutlined, UserOutlined, EnvironmentOutlined, 
  ClockCircleOutlined, CarOutlined, SendOutlined 
} from '@ant-design/icons';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { io } from 'socket.io-client';
import axios from 'axios';
import type { DispatchCall, OfficerLocation, ActiveIncident } from './types';

const { Text, Title } = Typography;
const { Option } = Select;

// Custom marker icons
const officerIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/714/714251.png',
  iconSize: [30, 30],
});

const incidentIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
  iconSize: [30, 30],
});

export default function DispatchConsole() {
  const [calls, setCalls] = useState<DispatchCall[]>([]);
  const [officers, setOfficers] = useState<OfficerLocation[]>([]);
  const [incidents, setIncidents] = useState<ActiveIncident[]>([]);
  const [selectedCall, setSelectedCall] = useState<DispatchCall | null>(null);
  const [socket, setSocket] = useState<any>(null);

  useEffect(() => {
    // Connect to WebSocket
    const ws = io(process.env.REACT_APP_WS_URL || 'http://localhost:3030');
    setSocket(ws);

    // Load initial data
    loadData();

    // Listen for updates
    ws.on('call:new', (call: DispatchCall) => {
      setCalls(prev => [call, ...prev]);
    });

    ws.on('officer:location', (data: { officerId: string; location: any }) => {
      setOfficers(prev => prev.map(o => 
        o.id === data.officerId ? { ...o, location: data.location } : o
      ));
    });

    return () => ws.disconnect();
  }, []);

  const loadData = async () => {
    try {
      const [callsRes, officersRes, incidentsRes] = await Promise.all([
        axios.get('/api/dispatch/calls'),
        axios.get('/api/dispatch/officers'),
        axios.get('/api/dispatch/incidents'),
      ]);
      setCalls(callsRes.data);
      setOfficers(officersRes.data);
      setIncidents(incidentsRes.data);
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  };

  const dispatchOfficer = async (callId: string, officerIds: string[]) => {
    try {
      await axios.post(`/api/dispatch/calls/${callId}/dispatch`, { officerIds });
      setCalls(prev => prev.map(c => 
        c.id === callId ? { ...c, status: 'dispatched', assignedOfficers: officerIds } : c
      ));
    } catch (error) {
      console.error('Failed to dispatch:', error);
    }
  };

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      critical: '#ef4444',
      high: '#f59e0b',
      medium: '#3b82f6',
      low: '#22c55e',
    };
    return colors[priority] || '#6b7280';
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'gold',
      dispatched: 'blue',
      en_route: 'purple',
      on_scene: 'orange',
      resolved: 'green',
    };
    return colors[status] || 'default';
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ 
        padding: '12px 24px', 
        background: '#1e293b', 
        color: 'white',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <Title level={4} style={{ color: 'white', margin: 0 }}>
            🚨 Dispatch Console
          </Title>
        </div>
        <Space>
          <Badge count={calls.filter(c => c.status === 'pending').length}>
            <Button icon={<AlertOutlined />}>Pending Calls</Button>
          </Badge>
          <Badge count={officers.filter(o => o.status === 'available').length} color="green">
            <Button icon={<UserOutlined />}>Available</Button>
          </Badge>
        </Space>
      </div>

      {/* Main Content */}
      <Row style={{ flex: 1, overflow: 'hidden' }}>
        {/* Left Panel - Active Calls */}
        <Col xs={6} style={{ borderRight: '1px solid #e5e7eb', overflow: 'auto' }}>
          <div style={{ padding: 16 }}>
            <Text strong style={{ fontSize: 16 }}>Active Calls</Text>
          </div>
          <List
            dataSource={calls.filter(c => c.status !== 'resolved')}
            renderItem={(call) => (
              <Card 
                size="small" 
                style={{ 
                  margin: '8px 16px', 
                  borderLeft: `4px solid ${getPriorityColor(call.priority)}`,
                  cursor: 'pointer',
                  background: selectedCall?.id === call.id ? '#f3f4f6' : 'white'
                }}
                onClick={() => setSelectedCall(call)}
              >
                <Space direction="vertical" size={0}>
                  <Space>
                    <Tag color={getPriorityColor(call.priority)}>{call.priority}</Tag>
                    <Tag>{call.type}</Tag>
                  </Space>
                  <Text strong>{call.description}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    <EnvironmentOutlined /> {call.location.address}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    <ClockCircleOutlined /> {new Date(call.createdAt).toLocaleTimeString()}
                  </Text>
                  <Tag color={getStatusColor(call.status)}>{call.status}</Tag>
                </Space>
              </Card>
            )}
          />
        </Col>

        {/* Center - Map */}
        <Col xs={12} style={{ position: 'relative' }}>
          <MapContainer 
            center={[-26.2041, 28.0473]} 
            zoom={13} 
            style={{ height: '100%' }}
          >
            <TileLayer
              attribution='&copy; OpenStreetMap'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            
            {/* Officer Markers */}
            {officers.map((officer) => (
              <Marker 
                key={officer.id} 
                position={[officer.location.lat, officer.location.lng]}
                icon={officerIcon}
              >
                <Popup>
                  <div>
                    <Text strong>{officer.name}</Text>
                    <br />
                    <Tag color={officer.status === 'available' ? 'green' : 'red'}>
                      {officer.status}
                    </Tag>
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Incident Markers */}
            {calls.filter(c => c.status !== 'resolved').map((call) => (
              <Marker 
                key={call.id} 
                position={[call.location.lat, call.location.lng]}
                icon={incidentIcon}
              >
                <Popup>
                  <div>
                    <Text strong>{call.type.toUpperCase()}</Text>
                    <br />
                    <Text>{call.description}</Text>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>

          {/* Incident Stats Overlay */}
          <div style={{
            position: 'absolute',
            top: 16,
            right: 16,
            zIndex: 1000,
            background: 'white',
            padding: 12,
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }}>
            <Statistic 
              title="Active Incidents" 
              value={incidents.length} 
              valueStyle={{ color: '#ef4444' }}
            />
          </div>
        </Col>

        {/* Right Panel - Details */}
        <Col xs={6} style={{ borderLeft: '1px solid #e5e7eb', overflow: 'auto' }}>
          {selectedCall ? (
            <div style={{ padding: 16 }}>
              <Title level={4}>Call Details</Title>
              
              <Card size="small" style={{ marginBottom: 16 }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text type="secondary">Priority</Text>
                    <Tag color={getPriorityColor(selectedCall.priority)}>
                      {selectedCall.priority}
                    </Tag>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text type="secondary">Type</Text>
                    <Text>{selectedCall.type}</Text>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text type="secondary">Status</Text>
                    <Tag color={getStatusColor(selectedCall.status)}>
                      {selectedCall.status}
                    </Tag>
                  </div>
                  <div>
                    <Text type="secondary}>Description</Text>
                    <Text>{selectedCall.description}</Text>
                  </div>
                  <div>
                    <Text type="secondary}>Location</Text>
                    <Text>{selectedCall.location.address}</Text>
                  </div>
                </Space>
              </Card>

              <Text strong>Dispatch Officers</Text>
              <Select
                mode="multiple"
                style={{ width: '100%', marginTop: 8 }}
                placeholder="Select officers"
              >
                {officers.filter(o => o.status === 'available').map(o => (
                  <Option key={o.id} value={o.id}>
                    {o.name} - {o.status}
                  </Option>
                ))}
              </Select>

              <Button 
                type="primary" 
                icon={<SendOutlined />}
                block
                style={{ marginTop: 16 }}
              >
                Dispatch
              </Button>
            </div>
          ) : (
            <div style={{ padding: 16, textAlign: 'center' }}>
              <Text type="secondary">Select a call to view details</Text>
            </div>
          )}

          {/* Officers List */}
          <div style={{ padding: 16, borderTop: '1px solid #e5e7eb' }}>
            <Text strong style={{ fontSize: 16 }}>Officers On Duty</Text>
            <List
              size="small"
              dataSource={officers}
              renderItem={(officer) => (
                <List.Item>
                  <Space>
                    <Avatar icon={<UserOutlined />} size="small" />
                    <Text>{officer.name}</Text>
                  </Space>
                  <Tag color={officer.status === 'available' ? 'green' : 'red'}>
                    {officer.status}
                  </Tag>
                </List.Item>
              )}
            />
          </div>
        </Col>
      </Row>
    </div>
  );
}