import { Router, Request, Response } from 'express';
import { activityService } from '../services/ActivityService';
import { attendanceService } from '../services/AttendanceService';
import { successResponse, createdResponse, errorResponse, paginatedResponse, validationErrorResponse } from '../utils/response';
import { ActivityStatus, ApprovalLevel, ApprovalStatus, UserRole } from '../types';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { title, description, category, startTime, endTime, budget, expectedParticipants, clubId } = req.body;

    const errors: string[] = [];
    if (!title) errors.push('活动标题不能为空');
    if (!description) errors.push('活动描述不能为空');
    if (!category) errors.push('活动类别不能为空');
    if (!startTime) errors.push('开始时间不能为空');
    if (!endTime) errors.push('结束时间不能为空');
    if (budget === undefined || budget < 0) errors.push('活动预算不能为负数');
    if (!expectedParticipants || expectedParticipants <= 0) errors.push('预期参与人数必须大于0');
    if (!clubId) errors.push('社团ID不能为空');

    if (errors.length > 0) {
      return validationErrorResponse(res, errors);
    }

    const activity = await activityService.createActivity({
      title,
      description,
      category,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      budget,
      expectedParticipants,
      clubId
    });

    return createdResponse(res, activity, '活动创建成功');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.post('/:id/submit', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await activityService.submitForApproval(id);
    return successResponse(res, result, '活动已提交审批');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 400);
  }
});

router.post('/approvals/:id/process', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { approverId, approved, comment } = req.body;

    if (!approverId) {
      return errorResponse(res, '请提供审批人ID');
    }
    if (approved === undefined) {
      return errorResponse(res, '请提供审批结果');
    }

    const approval = await activityService.processApproval(id, approverId, approved, comment);

    if (!approval) {
      return errorResponse(res, '审批记录不存在', 404);
    }

    return successResponse(res, approval, approved ? '审批已通过' : '审批已拒绝');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 400);
  }
});

router.get('/approvals/check-timeouts', async (req: Request, res: Response) => {
  try {
    const result = await activityService.checkApprovalTimeouts();
    return successResponse(res, result, `审批超时检查完成，共处理 ${result.total} 条`);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/approvals/dashboard', async (req: Request, res: Response) => {
  try {
    const { userId, userRole } = req.query;

    if (!userId) {
      return errorResponse(res, '请提供用户ID', 400);
    }
    if (!userRole) {
      return errorResponse(res, '请提供用户角色', 400);
    }

    const dashboard = await activityService.getApprovalDashboard(
      userId as string,
      userRole as UserRole
    );

    return successResponse(res, dashboard);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/approvals', async (req: Request, res: Response) => {
  try {
    const { activityId, level, status, page = '1', pageSize = '20' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const pageSizeNum = parseInt(pageSize as string, 10);

    const { items, total, currentLevel } = await activityService.getApprovals(
      activityId as string,
      level as ApprovalLevel,
      status as ApprovalStatus,
      pageNum,
      pageSizeNum
    );

    return successResponse(res, { items, total, page: pageNum, pageSize: pageSizeNum, currentLevel });
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/:id/approval-flow', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const flow = await activityService.getApprovalFlow(id);
    return successResponse(res, flow);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const activity = await activityService.getActivityById(id);

    if (!activity) {
      return errorResponse(res, '活动不存在', 404);
    }

    return successResponse(res, activity);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const { clubId, status, startDate, endDate, page = '1', pageSize = '20' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const pageSizeNum = parseInt(pageSize as string, 10);

    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;

    const { items, total } = await activityService.getActivities(
      clubId as string,
      status as ActivityStatus,
      start,
      end,
      pageNum,
      pageSizeNum
    );

    return paginatedResponse(res, items, total, pageNum, pageSizeNum);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.post('/:id/complete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { actualCost, actualParticipants } = req.body;

    if (actualCost === undefined || actualCost < 0) {
      return errorResponse(res, '实际支出不能为负数');
    }
    if (actualParticipants === undefined || actualParticipants < 0) {
      return errorResponse(res, '实际参与人数不能为负数');
    }

    const activity = await activityService.completeActivity(id, actualCost, actualParticipants);

    if (!activity) {
      return errorResponse(res, '活动不存在', 404);
    }

    return successResponse(res, activity, '活动已完成');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 400);
  }
});

router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return errorResponse(res, '请提供取消原因');
    }

    const activity = await activityService.cancelActivity(id, reason);

    if (!activity) {
      return errorResponse(res, '活动不存在', 404);
    }

    return successResponse(res, activity, '活动已取消');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 400);
  }
});

router.post('/attendance/sign-in', async (req: Request, res: Response) => {
  try {
    const { activityId, userId, signInMethod } = req.body;

    const errors: string[] = [];
    if (!activityId) errors.push('活动ID不能为空');
    if (!userId) errors.push('用户ID不能为空');

    if (errors.length > 0) {
      return validationErrorResponse(res, errors);
    }

    const attendance = await attendanceService.signIn({ activityId, userId, signInMethod });
    return successResponse(res, attendance, '签到成功');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 400);
  }
});

router.post('/attendance/sign-out', async (req: Request, res: Response) => {
  try {
    const { activityId, userId } = req.body;

    const errors: string[] = [];
    if (!activityId) errors.push('活动ID不能为空');
    if (!userId) errors.push('用户ID不能为空');

    if (errors.length > 0) {
      return validationErrorResponse(res, errors);
    }

    const attendance = await attendanceService.signOut({ activityId, userId });
    return successResponse(res, attendance, '签退成功');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 400);
  }
});

router.post('/attendance/bulk-sign-in', async (req: Request, res: Response) => {
  try {
    const { activityId, userIds, signInMethod } = req.body;

    const errors: string[] = [];
    if (!activityId) errors.push('活动ID不能为空');
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      errors.push('用户ID列表不能为空');
    }

    if (errors.length > 0) {
      return validationErrorResponse(res, errors);
    }

    const attendances = await attendanceService.bulkSignIn(activityId, userIds, signInMethod);
    return successResponse(res, { count: attendances.length, attendances }, '批量签到完成');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/:id/attendance', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await attendanceService.getActivityAttendance(id);
    return successResponse(res, result);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/:id/attendance/stats', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const stats = await attendanceService.getAttendanceStats(id);
    return successResponse(res, stats);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.post('/:id/attendance/auto-sign-out', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const count = await attendanceService.autoSignOutAll(id);
    return successResponse(res, { count }, `已自动签退 ${count} 人`);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/attendance/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { page = '1', pageSize = '20' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const pageSizeNum = parseInt(pageSize as string, 10);

    const result = await attendanceService.getUserAttendance(userId, pageNum, pageSizeNum);
    return successResponse(res, result);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/attendance/user/:userId/total-hours', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;

    const totalHours = await attendanceService.calculateUserTotalHours(userId, start, end);
    return successResponse(res, { totalHours });
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

export default router;
