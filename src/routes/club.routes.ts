import { Router, Request, Response } from 'express';
import { clubService } from '../services/ClubService';
import { successResponse, createdResponse, errorResponse, paginatedResponse, validationErrorResponse } from '../utils/response';
import { ClubStatus } from '../types';

const router = Router();

router.get('/check-name', async (req: Request, res: Response) => {
  try {
    const { name } = req.query;
    if (!name || typeof name !== 'string') {
      return errorResponse(res, '请提供社团名称');
    }

    const result = await clubService.checkNameAvailability(name);
    return successResponse(res, result);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/validate', async (req: Request, res: Response) => {
  try {
    const { name, memberIds, leaderId } = req.query;

    if (!name || typeof name !== 'string') {
      return errorResponse(res, '请提供社团名称');
    }
    if (!leaderId || typeof leaderId !== 'string') {
      return errorResponse(res, '请提供社长ID');
    }
    if (!memberIds || typeof memberIds !== 'string') {
      return errorResponse(res, '请提供成员ID列表');
    }

    const memberIdArray = memberIds.split(',').map(id => id.trim());

    const validation = await clubService.validateClubApplication({
      name,
      description: 'temp',
      category: 'temp',
      leaderId,
      memberIds: memberIdArray
    });

    return successResponse(res, validation);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, description, category, leaderId, memberIds, advisorId } = req.body;

    const errors: string[] = [];
    if (!name) errors.push('社团名称不能为空');
    if (!description) errors.push('社团描述不能为空');
    if (!category) errors.push('社团类别不能为空');
    if (!leaderId) errors.push('社长ID不能为空');
    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      errors.push('成员列表不能为空');
    }

    if (errors.length > 0) {
      return validationErrorResponse(res, errors);
    }

    const result = await clubService.createClubApplication({
      name,
      description,
      category,
      leaderId,
      memberIds,
      advisorId
    });

    if (!result.validation.valid) {
      return errorResponse(res, '申请校验未通过', 422, result.validation.errors);
    }

    return createdResponse(res, result.club, '社团创建申请已提交');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const club = await clubService.approveClub(id);

    if (!club) {
      return errorResponse(res, '社团不存在', 404);
    }

    return successResponse(res, club, '社团申请已通过');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 400);
  }
});

router.post('/:id/reject', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return errorResponse(res, '请提供拒绝原因');
    }

    const club = await clubService.rejectClub(id, reason);

    if (!club) {
      return errorResponse(res, '社团不存在', 404);
    }

    return successResponse(res, club, '社团申请已拒绝');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 400);
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const club = await clubService.getClubById(id);

    if (!club) {
      return errorResponse(res, '社团不存在', 404);
    }

    return successResponse(res, club);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, page = '1', pageSize = '20' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const pageSizeNum = parseInt(pageSize as string, 10);

    const clubStatus = status as ClubStatus | undefined;

    const { items, total } = await clubService.getClubs(clubStatus, pageNum, pageSizeNum);

    return paginatedResponse(res, items, total, pageNum, pageSizeNum);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/:id/members', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const members = await clubService.getClubMembers(id);
    return successResponse(res, members);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.post('/:id/points', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { points, reason, activityId } = req.body;

    if (points === undefined || points === null) {
      return errorResponse(res, '请提供积分变动值');
    }
    if (!reason) {
      return errorResponse(res, '请提供积分变动原因');
    }

    const club = await clubService.addClubPoints(id, points, reason, activityId);

    if (!club) {
      return errorResponse(res, '社团不存在', 404);
    }

    return successResponse(res, club, '积分已更新');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

export default router;
