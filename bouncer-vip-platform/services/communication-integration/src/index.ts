// ===========================================
// Communication Integration Service
// Slack, Microsoft Teams
// ===========================================

import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { WebClient } from '@slack/web-api';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());

// ===========================================
// Types
// ===========================================

type ChatProvider = 'slack' | 'teams';

interface SlackMessage {
  channel: string;
  text: string;
  blocks?: any[];
  attachments?: any[];
}

interface TeamsMessage {
  channelId: string;
  content: string;
  attachments?: any[];
}

// ===========================================
// Slack Integration
// ===========================================

class SlackIntegration {
  private client: WebClient;
  private botToken: string;

  constructor() {
    this.botToken = process.env.SLACK_BOT_TOKEN || '';
    this.client = new WebClient(this.botToken);
  }

  async sendMessage(message: SlackMessage): Promise<{ ts: string; channel: string }> {
    const response = await this.client.chat.postMessage({
      channel: message.channel,
      text: message.text,
      blocks: message.blocks,
      attachments: message.attachments,
    });

    return {
      ts: response.ts || '',
      channel: response.channel || '',
    };
  }

  async sendIncidentAlert(incident: any): Promise<void> {
    const severityEmoji = {
      critical: ':rotating_light:',
      high: ':warning:',
      medium: ':large_blue_circle:',
      low: ':white_circle:',
    };

    await this.client.chat.postMessage({
      channel: process.env.SLACK_INCIDENTS_CHANNEL || 'incidents',
      text: `${severityEmoji[incident.severity]} *New Incident: ${incident.title}*`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `🚨 ${incident.title}` },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Severity:*\n${incident.severity}` },
            { type: 'mrkdwn', text: `*Type:*\n${incident.type}` },
            { type: 'mrkdwn', text: `*Location:*\n${incident.location}` },
            { type: 'mrkdwn', text: `*Status:*\n${incident.status}` },
          ],
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Description:*\n${incident.description}` },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View Details' },
              url: `${process.env.APP_URL}/incidents/${incident.id}`,
            },
          ],
        },
      ],
    });
  }

  async sendBookingNotification(booking: any): Promise<void> {
    await this.client.chat.postMessage({
      channel: process.env.SLACK_BOOKINGS_CHANNEL || 'bookings',
      text: `New Booking: ${booking.venueName}`,
      blocks: [
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Venue:*\n${booking.venueName}` },
            { type: 'mrkdwn', text: `*Date:*\n${booking.date}` },
            { type: 'mrkdwn', text: `*Officers:*\n${booking.officerCount}` },
            { type: 'mrkdwn', text: `*Status:*\n${booking.status}` },
          ],
        },
      ],
    });
  }

  async createChannel(name: string): Promise<{ id: string }> {
    const response = await this.client.conversations.create({
      name,
      is_private: false,
    });

    return { id: response.channel?.id || '' };
  }

  async inviteToChannel(channelId: string, userId: string): Promise<void> {
    await this.client.conversations.invite({
      channel: channelId,
      users: userId,
    });
  }
}

// ===========================================
// Microsoft Teams Integration
// ===========================================

class TeamsIntegration {
  private tenantId: string;
  private clientId: string;
  private clientSecret: string;
  private accessToken?: string;

  constructor() {
    this.tenantId = process.env.TEAMS_TENANT_ID || '';
    this.clientId = process.env.TEAMS_CLIENT_ID || '';
    this.clientSecret = process.env.TEAMS_CLIENT_SECRET || '';
  }

  private async authenticate(): Promise<void> {
    const response = await axios.post(
      `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`,
      new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      })
    );

    this.accessToken = response.data.access_token;
  }

  async sendMessage(message: TeamsMessage): Promise<void> {
    await this.authenticate();

    await axios.post(
      `https://graph.microsoft.com/v1.0/teams/${message.channelId}/channels/messages`,
      {
        body: { content: message.content },
      },
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );
  }

  async sendIncidentAlert(incident: any): Promise<void> {
    await this.sendMessage({
      channelId: process.env.TEAMS_INCIDENTS_CHANNEL || '',
      content: `**New Incident: ${incident.title}**\n\nSeverity: ${incident.severity}\nType: ${incident.type}\nLocation: ${incident.location}\n\n${incident.description}`,
    });
  }

  async createTeam(name: string): Promise<{ id: string }> {
    await this.authenticate();

    const response = await axios.post(
      'https://graph.microsoft.com/v1.0/teams',
      {
        displayName: name,
        template: 'standard',
      },
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    return { id: response.data.id };
  }
}

// ===========================================
// Communication Service
// ===========================================

class CommunicationService {
  private slack: SlackIntegration;
  private teams: TeamsIntegration;

  constructor() {
    this.slack = new SlackIntegration();
    this.teams = new TeamsIntegration();
  }

  async notifyIncident(provider: ChatProvider, incident: any): Promise<void> {
    if (provider === 'slack') {
      await this.slack.sendIncidentAlert(incident);
    } else if (provider === 'teams') {
      await this.teams.sendIncidentAlert(incident);
    }
  }

  async notifyBooking(provider: ChatProvider, booking: any): Promise<void> {
    if (provider === 'slack') {
      await this.slack.sendBookingNotification(booking);
    }
  }

  async broadcast(provider: ChatProvider, message: any): Promise<void> {
    if (provider === 'slack') {
      await this.slack.sendMessage(message);
    } else if (provider === 'teams') {
      await this.teams.sendMessage(message);
    }
  }
}

const commService = new CommunicationService();

// ===========================================
// Webhook Handlers
// ===========================================

app.post('/webhook/slack', async (req: Request, res: Response) => {
  const { type, challenge, event } = req.body;

  // URL verification
  if (type === 'url_verification') {
    return res.json({ challenge });
  }

  // Event callback
  if (type === 'event_callback') {
    if (event?.type === 'message' && event.channel) {
      // Handle incoming message
      await pool.query(`
        INSERT INTO chat_messages (id, provider, channel, user, content, received_at)
        VALUES ($1, 'slack', $2, $3, $4, NOW())
      `, [uuidv4(), event.channel, event.user, event.text]);
    }
  }

  res.sendStatus(200);
});

app.post('/webhook/teams', async (req: Request, res: Response) => {
  const { type, resource, payload } = req.body;

  if (type === 'created' && resource === 'messages') {
    await pool.query(`
      INSERT INTO chat_messages (id, provider, channel, user, content, received_at)
      VALUES ($1, 'teams', $2, $3, $4, NOW())
    `, [uuidv4(), payload.channelId, payload.from?.user?.displayName, payload.body?.content]);
  }

  res.sendStatus(200);
});

// ===========================================
// API Routes
// ===========================================

app.post('/api/notify/incident', async (req: Request, res: Response) => {
  try {
    const { provider, incident } = req.body;
    await commService.notifyIncident(provider, incident);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Notification failed' });
  }
});

app.post('/api/notify/booking', async (req: Request, res: Response) => {
  try {
    const { provider, booking } = req.body;
    await commService.notifyBooking(provider, booking);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Notification failed' });
  }
});

app.post('/api/broadcast', async (req: Request, res: Response) => {
  try {
    const { provider, message } = req.body;
    await commService.broadcast(provider, message);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Broadcast failed' });
  }
});

app.get('/api/channels', async (req: Request, res: Response) => {
  try {
    const { provider } = req.query;
    const channels = await pool.query(`
      SELECT * FROM chat_channels WHERE provider = $1
    `, [provider]);
    res.json({ success: true, data: channels.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch channels' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'communication-integration' });
});

const PORT = process.env.PORT || 3072;

app.listen(PORT, () => console.log(`Communication Integration Service on port ${PORT}`));

export default app;