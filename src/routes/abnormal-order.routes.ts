import { Router, Request, Response } from 'express';
import { reimbursementService } from '../services/ReimbursementService';
import { successResponse, errorResponse, paginatedResponse, validationErrorResponse } from '../utils/response';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
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

router.get('/:id', async (req: Request, res: Response) => {
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

router.post('/:id/process', async (req: Request, res: Response) => {
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
