import 'reflect-metadata';
import express, { Express, Request, Response, NextFunction } from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';
import * as cron from 'node-cron';
import { AppDataSource } from './config/database';
import { notificationService } from './services/NotificationService';
import { reportService } from './services/ReportService';
import { activityService } from './services/ActivityService';
import { attendanceService } from './services/AttendanceService';
import { warningService } from './services/WarningService';
import { venueService } from './services/VenueService';

import clubRoutes from './routes/club.routes';
import venueRoutes from './routes/venue.routes';
import activityRoutes from './routes/activity.routes';
import warningRoutes from './routes/warning.routes';
import reportRoutes from './routes/report.routes';
import notificationRoutes from './routes/notification.routes';
import userRoutes from './routes/user.routes';

import { errorResponse } from './utils/response';

const app: Express = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    code: 200,
    message: 'success',
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: AppDataSource.isInitialized ? 'connected' : 'disconnected',
      websocket: notificationService.getConnectionCount()
    }
  });
});

app.use('/api/clubs', clubRoutes);
app.use('/api/venues', venueRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api', warningRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userRoutes);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  return errorResponse(res, err.message || '服务器内部错误', 500);
});

app.use((req: Request, res: Response) => {
  return errorResponse(res, '接口不存在', 404);
});

const server = http.createServer(app);

const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket, req) => {
  const url = req.url || '';
  const params = new URLSearchParams(url.split('?')[1] || '');
  const userId = params.get('userId');

  if (!userId) {
    ws.close(4000, 'Missing userId');
    return;
  }

  console.log(`WebSocket connected: user=${userId}`);
  notificationService.registerClient(userId, ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      }
    } catch (err) {
      console.error('WebSocket message parse error:', err);
    }
  });

  ws.on('close', () => {
    console.log(`WebSocket disconnected: user=${userId}`);
    notificationService.removeClient(userId);
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error for user=${userId}:`, err);
  });
});

async function startServer() {
  try {
    await AppDataSource.initialize();
    console.log('Database connected successfully');

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`API Base URL: http://localhost:${PORT}/api`);
      console.log(`WebSocket URL: ws://localhost:${PORT}/ws`);
      console.log(`Health Check: http://localhost:${PORT}/api/health`);
    });

    setupCronJobs();

    process.on('SIGINT', async () => {
      console.log('\nShutting down server...');
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
        console.log('Database connection closed');
      }
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

function setupCronJobs() {
  console.log('Setting up cron jobs...');

  cron.schedule('0 0 0 * * *', async () => {
    console.log('[Cron] Starting daily report generation...');
    try {
      await reportService.generateDailyReport();
      console.log('[Cron] Daily report generated successfully');
    } catch (error) {
      console.error('[Cron] Daily report generation failed:', error);
    }
  });

  cron.schedule('0 * * * *', async () => {
    console.log('[Cron] Checking approval timeouts...');
    try {
      const result = await activityService.checkApprovalTimeouts();
      console.log(`[Cron] Approval timeouts checked: ${result.reminded} reminded, ${result.escalated} escalated`);
    } catch (error) {
      console.error('[Cron] Approval timeout check failed:', error);
    }
  });

  cron.schedule('30 * * * *', async () => {
    console.log('[Cron] Auto releasing expired venue locks...');
    try {
      const count = await venueService.autoReleaseExpiredLocks();
      console.log(`[Cron] Released ${count} expired venue locks`);
    } catch (error) {
      console.error('[Cron] Auto release locks failed:', error);
    }
  });

  cron.schedule('0 2 * * *', async () => {
    console.log('[Cron] Checking club activity warnings...');
    try {
      const warnings = await warningService.checkAllClubsActivity();
      console.log(`[Cron] Club activity warnings checked: ${warnings.length} warnings`);
    } catch (error) {
      console.error('[Cron] Activity warning check failed:', error);
    }
  });

  cron.schedule('0 3 * * *', async () => {
    console.log('[Cron] Auto signing out all active attendances...');
    try {
      const count = await attendanceService.autoSignOutAll();
      console.log(`[Cron] Auto signed out ${count} attendances`);
    } catch (error) {
      console.error('[Cron] Auto sign out failed:', error);
    }
  });

  console.log('Cron jobs configured:');
  console.log('  - 00:00: Generate daily report');
  console.log('  - Every hour: Check approval timeouts');
  console.log('  - Every 30 min: Auto release venue locks');
  console.log('  - 02:00: Check club activity warnings');
  console.log('  - 03:00: Auto sign out attendances');
}

startServer();
