import { Router, Request, Response } from 'express';
import { venueService } from '../services/VenueService';
import { successResponse, createdResponse, errorResponse, paginatedResponse, validationErrorResponse } from '../utils/response';
import { VenueStatus, BookingStatus } from '../types';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, location, capacity, category, facilities, description } = req.body;

    const errors: string[] = [];
    if (!name) errors.push('场地名称不能为空');
    if (!location) errors.push('场地位置不能为空');
    if (!capacity || capacity <= 0) errors.push('场地容量必须大于0');
    if (!category) errors.push('场地类别不能为空');

    if (errors.length > 0) {
      return validationErrorResponse(res, errors);
    }

    const venue = await venueService.createVenue({
      name,
      location,
      capacity,
      category,
      facilities,
      description
    });

    return createdResponse(res, venue, '场地创建成功');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/available/recommend', async (req: Request, res: Response) => {
  try {
    const { startTime, endTime, participants, category, facilities } = req.query;

    const errors: string[] = [];
    if (!startTime) errors.push('请提供开始时间');
    if (!endTime) errors.push('请提供结束时间');
    if (!participants) errors.push('请提供参与人数');

    if (errors.length > 0) {
      return validationErrorResponse(res, errors);
    }

    const facilityList = facilities
      ? (facilities as string).split(',').map(f => f.trim())
      : undefined;

    const venues = await venueService.findAvailableVenues(
      new Date(startTime as string),
      new Date(endTime as string),
      parseInt(participants as string, 10),
      category as string,
      facilityList
    );

    return successResponse(res, venues);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/bookings', async (req: Request, res: Response) => {
  try {
    const { venueId, activityId, status, page = '1', pageSize = '20' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const pageSizeNum = parseInt(pageSize as string, 10);

    const { items, total } = await venueService.getBookings(
      venueId as string,
      activityId as string,
      status as BookingStatus,
      pageNum,
      pageSizeNum
    );

    return paginatedResponse(res, items, total, pageNum, pageSizeNum);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.post('/bookings', async (req: Request, res: Response) => {
  try {
    const { venueId, activityId, startTime, endTime, purpose, participants } = req.body;

    const errors: string[] = [];
    if (!venueId) errors.push('请选择场地');
    if (!startTime) errors.push('请提供开始时间');
    if (!endTime) errors.push('请提供结束时间');
    if (!purpose) errors.push('请提供使用目的');
    if (!participants || participants <= 0) errors.push('参与人数必须大于0');

    if (errors.length > 0) {
      return validationErrorResponse(res, errors);
    }

    const result = await venueService.createBooking({
      venueId,
      activityId,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      purpose,
      participants
    });

    if (!result.validation.valid) {
      return errorResponse(res, '预约校验未通过', 422, result.validation.errors);
    }

    return createdResponse(res, result.booking, '场地预约已提交并锁定');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/bookings/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const booking = await venueService.getBookingById(id);

    if (!booking) {
      return errorResponse(res, '预约不存在', 404);
    }

    return successResponse(res, booking);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.post('/bookings/:id/confirm', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const booking = await venueService.confirmBooking(id);

    if (!booking) {
      return errorResponse(res, '预约不存在', 404);
    }

    return successResponse(res, booking, '场地预约已确认');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 400);
  }
});

router.post('/bookings/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return errorResponse(res, '请提供取消原因');
    }

    const booking = await venueService.cancelBooking(id, reason);

    if (!booking) {
      return errorResponse(res, '预约不存在', 404);
    }

    return successResponse(res, booking, '场地预约已取消');
  } catch (error) {
    return errorResponse(res, (error as Error).message, 400);
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const { category, status, page = '1', pageSize = '20' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const pageSizeNum = parseInt(pageSize as string, 10);

    const { items, total } = await venueService.getVenues(
      category as string,
      status as VenueStatus,
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
    const venue = await venueService.getVenueById(id);

    if (!venue) {
      return errorResponse(res, '场地不存在', 404);
    }

    return successResponse(res, venue);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/:id/check-capacity', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { participants } = req.query;

    if (!participants) {
      return errorResponse(res, '请提供参与人数');
    }

    const result = await venueService.checkCapacity(id, parseInt(participants as string, 10));
    return successResponse(res, result);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.get('/:id/time-slots', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { date } = req.query;

    if (!date) {
      return errorResponse(res, '请提供查询日期');
    }

    const slots = await venueService.getAvailableTimeSlots(id, new Date(date as string));
    return successResponse(res, slots);
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

router.post('/:id/check-conflict', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { startTime, endTime, excludeBookingId } = req.body;

    const errors: string[] = [];
    if (!startTime) errors.push('请提供开始时间');
    if (!endTime) errors.push('请提供结束时间');

    if (errors.length > 0) {
      return validationErrorResponse(res, errors);
    }

    const conflicts = await venueService.checkTimeConflict(
      id,
      new Date(startTime),
      new Date(endTime),
      excludeBookingId
    );

    return successResponse(res, {
      hasConflict: conflicts.length > 0,
      conflicts
    });
  } catch (error) {
    return errorResponse(res, (error as Error).message, 500);
  }
});

export default router;
