import { Router, Request, Response } from 'express';
import { reimbursementService } from '../services/ReimbursementService';
import { successResponse, errorResponse, paginatedResponse, validationErrorResponse } from '../utils/response';
import { ReimbursementStatus } from '../types';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
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

router.get('/', async (req: Request, res: Response) => {
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

router.get('/:id', async (req: Request, res: Response) => {
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

router.post('/:id/approve', async (req: Request, res: Response) => {
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

router.post('/:id/reject', async (req: Request, res: Response) => {
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

router.post('/:id/paid', async (req: Request, res: Response) => {
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

export default router;
