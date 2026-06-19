import { Router, Request, Response } from 'express';
import { notificationService } from '../services/NotificationService';
import { successResponse, errorResponse, validationErrorResponse } from '../utils/response';

const router = Router();

router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { page, pageSize, unread } = req.query;

    const result = await notificationService.getUserNotifications(
      userId,
      page ? parseInt(page as string) : 1,
      pageSize ? parseInt(pageSize as string) : 20,
      unread === 'true'
    );

    return successResponse(res, result);
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '获取通知列表失败');
  }
});

router.get('/user/:userId/unread/count', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const count = await notificationService.getUnreadCount(userId);

    return successResponse(res, { count });
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '获取未读通知数失败');
  }
});

router.post('/:id/read', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const notification = await notificationService.markAsRead(id);

    if (!notification) {
      return errorResponse(res, '通知不存在');
    }

    return successResponse(res, notification, '通知已标记为已读');
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '标记已读失败');
  }
});

router.post('/user/:userId/read/all', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    await notificationService.markAllAsRead(userId);

    return successResponse(res, null, '所有通知已标记为已读');
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '批量标记已读失败');
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await notificationService.deleteNotification(id);

    if (!result) {
      return errorResponse(res, '通知不存在');
    }

    return successResponse(res, null, '通知删除成功');
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '删除通知失败');
  }
});

router.post('/push', async (req: Request, res: Response) => {
  try {
    const { senderId, receiverIds, title, content, type, relatedId, relatedType } = req.body;

    const errors: string[] = [];
    if (!senderId) errors.push('请提供发送人ID');
    if (!receiverIds || !Array.isArray(receiverIds) || receiverIds.length === 0) errors.push('请提供接收人ID列表');
    if (!title) errors.push('请提供通知标题');
    if (!content) errors.push('请提供通知内容');

    if (errors.length > 0) {
      return validationErrorResponse(res, errors);
    }

    const notifications = await notificationService.broadcastToUsers(
      senderId,
      receiverIds,
      title,
      content,
      type,
      relatedId,
      relatedType
    );

    return successResponse(res, notifications, '通知发送成功');
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '发送通知失败');
  }
});

export default router;
