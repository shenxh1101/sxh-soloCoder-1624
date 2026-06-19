import { Router, Request, Response } from 'express';
import { warningService } from '../services/WarningService';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response';
import { WarningLevel } from '../types';

const router = Router();

router.get('/check-all', async (req: Request, res: Response) => {
  try {
    const warnings = await warningService.checkAllClubsActivity();
    return successResponse(res, { count: warnings.length, warnings }, '活跃度检查完成');
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

export default router;
