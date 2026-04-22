import React from 'react';
import { Card, Row, Col, Statistic } from 'antd';

export default function DashboardPage() {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 24 }}>Dashboard</h1>
      
      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic title="Total Officers" value={156} prefix="👮" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Active Shifts" value={42} prefix="⏰" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Today's Revenue" value={28000} prefix="R" precision={2} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Pending Incidents" value={3} prefix="⚠️" />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 24 }}>
        <Col span={16}>
          <Card title="Revenue Trend">
            <p style={{ color: '#999' }}>Chart placeholder</p>
          </Card>
        </Col>
        <Col span={8}>
          <Card title="Recent Activity">
            <p style={{ color: '#999' }}>Activity feed placeholder</p>
          </Card>
        </Col>
      </Row>
    </div>
  );
}