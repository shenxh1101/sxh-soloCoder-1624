import { In, Repository } from 'typeorm';
import { Notification, User } from '../entities';
import { NotificationType } from '../types';
import { AppDataSource } from '../config/database';
import { WebSocket } from 'ws';

interface WebSocketClient {
  ws: WebSocket;
  userId: string;
}

class NotificationService {
  private notificationRepository: Repository<Notification>;
  private userRepository: Repository<User>;
  private wsClients: Map<string, WebSocketClient[]> = new Map();

  constructor() {
    this.notificationRepository = AppDataSource.getRepository(Notification);
    this.userRepository = AppDataSource.getRepository(User);
  }

  registerClient(userId: string, ws: WebSocket) {
    const client: WebSocketClient = { ws, userId };
    if (!this.wsClients.has(userId)) {
      this.wsClients.set(userId, []);
    }
    this.wsClients.get(userId)!.push(client);
    console.log(`用户 ${userId} 已连接 WebSocket`);
  }

  unregisterClient(userId: string, ws: WebSocket) {
    const clients = this.wsClients.get(userId);
    if (clients) {
      const index = clients.findIndex(c => c.ws === ws);
      if (index > -1) {
        clients.splice(index, 1);
      }
      if (clients.length === 0) {
        this.wsClients.delete(userId);
      }
    }
  }

  removeClient(userId: string) {
    this.wsClients.delete(userId);
  }

  getConnectionCount(): number {
    let count = 0;
    this.wsClients.forEach(clients => {
      count += clients.filter(c => c.ws.readyState === WebSocket.OPEN).length;
    });
    return count;
  }

  private sendToUser(userId: string, data: unknown) {
    const clients = this.wsClients.get(userId);
    if (clients) {
      clients.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify(data));
        }
      });
    }
  }

  private sendToUsers(userIds: string[], data: unknown) {
    userIds.forEach(userId => this.sendToUser(userId, data));
  }

  async createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    content: string,
    relatedId?: string,
    relatedType?: string
  ): Promise<Notification> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('用户不存在');
    }

    const notification = this.notificationRepository.create({
      user,
      userId,
      type,
      title,
      content,
      relatedId: relatedId || null,
      relatedType: relatedType || null
    });

    const saved = await this.notificationRepository.save(notification);

    this.sendToUser(userId, {
      type: 'notification',
      data: saved
    });

    return saved;
  }

  async broadcastToUsers(
    senderId: string,
    userIds: string[],
    title: string,
    content: string,
    type?: NotificationType,
    relatedId?: string,
    relatedType?: string
  ): Promise<Notification[]> {
    const users = await this.userRepository.find({ where: { id: In(userIds) } });
    const notifications: Notification[] = [];

    for (const user of users) {
      const notification = await this.createNotification(
        user.id,
        type || NotificationType.SYSTEM,
        title,
        content,
        relatedId,
        relatedType
      );
      notifications.push(notification);
    }

    return notifications;
  }

  async notifyClubMembers(
    clubId: string,
    type: NotificationType,
    title: string,
    content: string,
    relatedId?: string,
    relatedType?: string
  ): Promise<Notification[]> {
    const members = await AppDataSource.getRepository('ClubMember')
      .createQueryBuilder('member')
      .where('member.clubId = :clubId', { clubId })
      .andWhere('member.isActive = :isActive', { isActive: true })
      .getMany() as Array<{ userId: string }>;

    const userIds = members.map(m => m.userId);
    return this.broadcastToUsers('system', userIds, title, content, type, relatedId, relatedType);
  }

  async notifyLeadersAndCommittee(
    type: NotificationType,
    title: string,
    content: string,
    leaderId?: string,
    relatedId?: string,
    relatedType?: string
  ): Promise<Notification[]> {
    const committeeMembers = await this.userRepository
      .createQueryBuilder('user')
      .where('user.role IN (:...roles)', { roles: ['league_committee', 'finance', 'admin'] })
      .getMany();

    const userIds = committeeMembers.map(u => u.id);
    if (leaderId && !userIds.includes(leaderId)) {
      userIds.push(leaderId);
    }

    return this.broadcastToUsers('system', userIds, title, content, type, relatedId, relatedType);
  }

  async deleteNotification(id: string): Promise<boolean> {
    const result = await this.notificationRepository.delete(id);
    return result.affected ? result.affected > 0 : false;
  }

  async getUserNotifications(
    userId: string,
    page = 1,
    pageSize = 20,
    unreadOnly = false
  ): Promise<{ items: Notification[]; total: number }> {
    const where: Record<string, unknown> = { userId };
    if (unreadOnly) {
      where.isRead = false;
    }

    const [items, total] = await this.notificationRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize
    });

    return { items, total };
  }

  async markAsRead(notificationId: string): Promise<Notification | null> {
    const notification = await this.notificationRepository.findOne({ where: { id: notificationId } });
    if (!notification) {
      return null;
    }

    notification.isRead = true;
    notification.readAt = new Date();
    return this.notificationRepository.save(notification);
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.notificationRepository
      .createQueryBuilder()
      .update(Notification)
      .set({
        isRead: true,
        readAt: new Date()
      })
      .where('userId = :userId', { userId })
      .andWhere('isRead = :isRead', { isRead: false })
      .execute();

    return result.affected || 0;
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationRepository.count({
      where: { userId, isRead: false }
    });
  }

  pushStatusUpdate(userId: string, statusType: string, data: unknown) {
    this.sendToUser(userId, {
      type: 'status_update',
      statusType,
      data,
      timestamp: new Date().toISOString()
    });
  }

  broadcastStatusUpdate(userIds: string[], statusType: string, data: unknown) {
    this.sendToUsers(userIds, {
      type: 'status_update',
      statusType,
      data,
      timestamp: new Date().toISOString()
    });
  }
}

export const notificationService = new NotificationService();
