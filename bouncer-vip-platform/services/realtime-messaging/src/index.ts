// ===========================================
// Real-Time Messaging Service
// WebSocket-based chat for officers and clients
// ===========================================

import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

app.use(express.json());

// ===========================================
// Types
// ===========================================

type MessageType = 'text' | 'image' | 'location' | 'system';
type ChatStatus = 'active' | 'archived' | 'blocked';

interface Conversation {
  id: string;
  participants: string[];
  type: 'direct' | 'group';
  name?: string;
  last_message_at?: string;
  last_message?: string;
  status: ChatStatus;
}

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: MessageType;
  content: string;
  metadata?: Record<string, any>;
  created_at: string;
  read_by: string[];
}

// ===========================================
// WebSocket Authentication
// ===========================================

interface ConnectedUser {
  userId: string;
  socketId: string;
  role: 'officer' | 'client' | 'admin';
}

const connectedUsers = new Map<string, ConnectedUser>();

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  
  try {
    // Validate token and get user
    const userId = token.split('.')[0]; // Simplified
    const role = await redis.get(`user:${userId}:role`) || 'officer';
    
    socket.data.userId = userId;
    socket.data.role = role;
    next();
  } catch (error) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Register user
  connectedUsers.set(socket.id, {
    userId: socket.data.userId,
    socketId: socket.id,
    role: socket.data.role,
  });
  
  // Join user's personal room
  socket.join(`user:${socket.data.userId}`);
  
  // Notify others
  socket.broadcast.emit('user:online', { userId: socket.data.userId });
  
  // Handle joining conversations
  socket.on('conversation:join', (conversationId: string) => {
    socket.join(`conversation:${conversationId}`);
  });
  
  socket.on('conversation:leave', (conversationId: string) => {
    socket.leave(`conversation:${conversationId}`);
  });
  
  // Handle messages
  socket.on('message:send', async (data: {
    conversationId: string;
    type: MessageType;
    content: string;
    metadata?: any;
  }) => {
    try {
      const message = await sendMessage({
        conversation_id: data.conversationId,
        sender_id: socket.data.userId,
        type: data.type,
        content: data.content,
        metadata: data.metadata,
      });
      
      // Broadcast to conversation
      io.to(`conversation:${data.conversationId}`).emit('message:new', message);
      
      // Update last message
      await updateConversationLastMessage(data.conversationId, message.content);
    } catch (error) {
      socket.emit('error', { message: 'Failed to send message' });
    }
  });
  
  // Handle typing indicators
  socket.on('typing:start', (conversationId: string) => {
    socket.to(`conversation:${conversationId}`).emit('typing:start', {
      conversationId,
      userId: socket.data.userId,
    });
  });
  
  socket.on('typing:stop', (conversationId: string) => {
    socket.to(`conversation:${conversationId}`).emit('typing:stop', {
      conversationId,
      userId: socket.data.userId,
    });
  });
  
  // Handle read receipts
  socket.on('message:read', async (data: { conversationId: string; messageId: string }) => {
    await markMessageRead(data.messageId, socket.data.userId);
    socket.to(`conversation:${data.conversationId}`).emit('message:read', {
      messageId: data.messageId,
      userId: socket.data.userId,
    });
  });
  
  // Handle presence
  socket.on('presence:update', (status: string) => {
    socket.broadcast.emit('presence:update', {
      userId: socket.data.userId,
      status,
    });
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    connectedUsers.delete(socket.id);
    socket.broadcast.emit('user:offline', { userId: socket.data.userId });
  });
});

// ===========================================
// Conversations
// ===========================================

async function createConversation(data: {
  participants: string[];
  type: 'direct' | 'group';
  name?: string;
}): Promise<Conversation> {
  const id = uuidv4();
  
  const [conversation] = await pool.query(`
    INSERT INTO conversations (id, participants, type, name, status, created_at)
    VALUES ($1, $2, $3, $4, 'active', NOW())
    RETURNING *
  `, [id, data.participants, data.type, data.name]);
  
  // Initialize Redis set for online participants
  await redis.sadd(`conversation:${id}:online`, ...data.participants);
  
  return conversation;
}

async function getConversations(userId: string): Promise<Conversation[]> {
  const result = await pool.query(`
    SELECT * FROM conversations 
    WHERE $1 = ANY(participants) AND status != 'archived'
    ORDER BY last_message_at DESC NULLS FIRST
  `, [userId]);
  
  return result.rows;
}

async function getConversationById(conversationId: string): Promise<Conversation | null> {
  const result = await pool.query('SELECT * FROM conversations WHERE id = $1', [conversationId]);
  return result.rows[0] || null;
}

// ===========================================
// Messages
// ===========================================

async function sendMessage(data: Partial<Message>): Promise<Message> {
  const id = uuidv4();
  
  const [message] = await pool.query(`
    INSERT INTO messages (id, conversation_id, sender_id, type, content, metadata, read_by, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    RETURNING *
  `, [id, data.conversation_id, data.sender_id, data.type, data.content, JSON.stringify(data.metadata || {}), [data.sender_id]]);
  
  return message;
}

async function getMessages(conversationId: string, limit = 50, before?: string): Promise<Message[]> {
  let query = `
    SELECT * FROM messages 
    WHERE conversation_id = $1
  `;
  const params: any[] = [conversationId];
  
  if (before) {
    params.push(before);
    query += ` AND created_at < $2`;
  }
  
  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);
  
  const result = await pool.query(query, params);
  return result.rows;
}

async function markMessageRead(messageId: string, userId: string): Promise<void> {
  await pool.query(`
    UPDATE messages 
    SET read_by = array_append(read_by, $2)
    WHERE id = $1 AND NOT ($2 = ANY(read_by))
  `, [messageId, userId]);
}

async function updateConversationLastMessage(conversationId: string, content: string): Promise<void> {
  await pool.query(`
    UPDATE conversations 
    SET last_message = $1, last_message_at = NOW()
    WHERE id = $2
  `, [content, conversationId]);
}

// ===========================================
// Unread Counts
// ===========================================

async function getUnreadCount(conversationId: string, userId: string): Promise<number> {
  const result = await pool.query(`
    SELECT COUNT(*) as count FROM messages 
    WHERE conversation_id = $1 
      AND sender_id != $2
      AND NOT ($2 = ANY(read_by))
  `, [conversationId, userId]);
  
  return parseInt(result.rows[0]?.count || '0');
}

async function getTotalUnread(userId: string): Promise<number> {
  const conversations = await getConversations(userId);
  let total = 0;
  
  for (const conv of conversations) {
    total += await getUnreadCount(conv.id, userId);
  }
  
  return total;
}

// ===========================================
// Push Notifications (via Redis)
// ===========================================

async function sendPushNotification(userId: string, title: string, body: string, data?: any): Promise<void> {
  await redis.lpush('notifications:queue', JSON.stringify({
    userId,
    title,
    body,
    data,
    timestamp: Date.now(),
  }));
}

// ===========================================
// Typing Indicator Expiry
// ===========================================

setInterval(async () => {
  const activeTyping = await redis.keys('typing:*');
  for (const key of activeTyping) {
    const ttl = await redis.ttl(key);
    if (ttl <= 0) {
      const conversationId = key.replace('typing:', '');
      io.to(`conversation:${conversationId}`).emit('typing:stop', {
        conversationId,
      });
      await redis.del(key);
    }
  }
}, 5000);

// ===========================================
// API Routes
// ===========================================

app.post('/api/conversations', async (req: Request, res: Response) => {
  try {
    const conversation = await createConversation(req.body);
    res.status(201).json({ success: true, data: conversation });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create conversation' });
  }
});

app.get('/api/conversations', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;
    const conversations = await getConversations(userId);
    res.json({ success: true, data: conversations });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch conversations' });
  }
});

app.get('/api/conversations/:id/messages', async (req: Request, res: Response) => {
  try {
    const { limit, before } = req.query as any;
    const messages = await getMessages(req.params.id, parseInt(limit) || 50, before);
    res.json({ success: true, data: messages });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch messages' });
  }
});

app.get('/api/unread/:userId', async (req: Request, res: Response) => {
  try {
    const unread = await getTotalUnread(req.params.userId);
    res.json({ success: true, data: { unread } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch unread count' });
  }
});

app.get('/health', async (req: Request, res: Response) => {
  res.json({ 
    status: 'healthy', 
    service: 'realtime-messaging',
    connected_users: connectedUsers.size,
  });
});

const PORT = process.env.PORT || 3030;

httpServer.listen(PORT, () => console.log(`Real-Time Messaging Service on port ${PORT}`));

export default app;