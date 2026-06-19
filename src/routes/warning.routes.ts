import { Router, Request, Response } from 'express';
import { warningService } from '../services/WarningService';
import { reimbursementService } from '../services/ReimbursementService';
import { successResponse, errorResponse, paginatedResponse, validationErrorResponse } from '../utils/response';
import { WarningLevel, ReimbursementStatus } from '../types';

const router = Router();

router.get('/check-all', async (req: Request, res: Response) => {
  try {
    const warnings = await warningService.checkAllClubsActivity();
    return successResponse(res, { count: warnings.length, warnings }, '活跃度检查完成');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/club/:clubId', async (req: Request, res: Response) => {
  try {
    const { clubId } = req.params;
    const { page = '1', pageSize = '20' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const pageSizeNum = parseInt(pageSize as string, 10);

    const { items, total } = await warningService.getClubWarnings(clubId, pageNum, pageSizeNum);

    return paginatedResponse(res, items, total, pageNum, pageSizeNum);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/club/:clubId/stats', async (req: Request, res: Response) => {
  try {
    const { clubId } = req.params;
    const { months } = req.query;

    const monthsNum = months ? parseInt(months as string, 10) : 6;

    const stats = await warningService.getClubActivityStats(clubId, monthsNum);
    return successResponse(res, stats);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const { level, acknowledged, page = '1', pageSize = '20' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const pageSizeNum = parseInt(pageSize as string, 10);

    const ack = acknowledged !== undefined ? acknowledged === 'true' : undefined;

    const { items, total } = await warningService.getAllWarnings(
      level as WarningLevel,
      ack,
      pageNum,
      pageSizeNum
    );

    return paginatedResponse(res, items, total, pageNum, pageSizeNum);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const warning = await warningService.getWarningById(id);

    if (!warning) {
      return errorResponse(res, '预警不存在', 404);
    }

    return successResponse(res, warning);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.post('/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { acknowledgedBy } = req.body;

    if (!acknowledgedBy) {
      return errorResponse(res, '请提供确认人ID');
    }

    const warning = await warningService.acknowledgeWarning(id, acknowledgedBy);

    if (!warning) {
      return errorResponse(res, '预警不存在', 404);
    }

    return successResponse(res, warning, '预警已确认');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 400);
  }
});

router.post('/reimbursement', async (req: Request, res: Response) => {
  try {
    const { activityId, description, items } = req.body;

    const errors: string[] = [];
    if (!activityId) errors.push('活动ID不能为空');
    if (!items || !Array.isArray(items) || items.length === 0) {
      errors.push('报销明细不能为空');
    }

    if (errors.length > 0) {
      return validationErrorResponse(res, errors);
    }

    const result = await reimbursementService.createReimbursement({
      activityId,
      description,
      items
    });

    return successResponse(res, result, result.isAbnormal ? '报销申请已提交，因预算偏差已生成异常工单' : '报销申请已提交');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/reimbursement', async (req: Request, res: Response) => {
  try {
    const { clubId, activityId, status, page = '1', pageSize = '20' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const pageSizeNum = parseInt(pageSize as string, 10);

    const { items, total } = await reimbursementService.getReimbursements(
      clubId as string,
      activityId as string,
      status as ReimbursementStatus,
      pageNum,
      pageSizeNum
    );

    return paginatedResponse(res, items, total, pageNum, pageSizeNum);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/reimbursement/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const reimbursement = await reimbursementService.getReimbursementById(id);

    if (!reimbursement) {
      return errorResponse(res, '报销申请不存在', 404);
    }

    return successResponse(res, reimbursement);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.post('/reimbursement/:id/approve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { approvedBy, approvedAmount } = req.body;

    if (!approvedBy) {
      return errorResponse(res, '请提供审批人ID');
    }

    const reimbursement = await reimbursementService.approveReimbursement(id, approvedBy, approvedAmount);

    if (!reimbursement) {
      return errorResponse(res, '报销申请不存在', 404);
    }

    return successResponse(res, reimbursement, '报销已批准');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 400);
  }
});

router.post('/reimbursement/:id/reject', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { rejectedBy, reason } = req.body;

    const errors: string[] = [];
    if (!rejectedBy) errors.push('请提供拒绝人ID');
    if (!reason) errors.push('请提供拒绝原因');

    if (errors.length > 0) {
      return validationErrorResponse(res, errors);
    }

    const reimbursement = await reimbursementService.rejectReimbursement(id, rejectedBy, reason);

    if (!reimbursement) {
      return errorResponse(res, '报销申请不存在', 404);
    }

    return successResponse(res, reimbursement, '报销已拒绝');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 400);
  }
});

router.post('/reimbursement/:id/paid', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { paidBy } = req.body;

    if (!paidBy) {
      return errorResponse(res, '请提供付款人ID');
    }

    const reimbursement = await reimbursementService.markAsPaid(id, paidBy);

    if (!reimbursement) {
      return errorResponse(res, '报销申请不存在', 404);
    }

    return successResponse(res, reimbursement, '报销已标记为已付款');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 400);
  }
});

router.get('/abnormal-orders', async (req: Request, res: Response) => {
  try {
    const { status, assigneeId, page = '1', pageSize = '20' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const pageSizeNum = parseInt(pageSize as string, 10);

    const { items, total } = await reimbursementService.getAbnormalOrders(
      status as string,
      assigneeId as string,
      pageNum,
      pageSizeNum
    );

    return paginatedResponse(res, items, total, pageNum, pageSizeNum);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/abnormal-orders/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const order = await reimbursementService.getAbnormalOrderById(id);

    if (!order) {
      return errorResponse(res, '异常工单不存在', 404);
    }

    return successResponse(res, order);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.post('/abnormal-orders/:id/process', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { resolvedBy, resolution, approve } = req.body;

    const errors: string[] = [];
    if (!resolvedBy) errors.push('请提供处理人ID');
    if (!resolution) errors.push('请提供处理意见');
    if (approve === undefined) errors.push('请提供处理结果');

    if (errors.length > 0) {
      return validationErrorResponse(res, errors);
    }

    const order = await reimbursementService.processAbnormalOrder(id, resolvedBy, resolution, approve);

    if (!order) {
      return errorResponse(res, '异常工单不存在', 404);
    }

    return successResponse(res, order, approve ? '异常工单已通过' : '异常工单已拒绝');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 400);
  }
});

export default router;
