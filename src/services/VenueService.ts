import { Repository, Between, MoreThan, LessThan, In, LessThanOrEqual } from 'typeorm';
import { Venue, VenueBooking, Activity } from '../entities';
import { VenueStatus, BookingStatus, NotificationType } from '../types';
import { AppDataSource } from '../config/database';
import { notificationService } from './NotificationService';

interface CreateVenueRequest {
  name: string;
  location: string;
  capacity: number;
  category: string;
  facilities?: string[];
  description?: string;
}

interface BookingRequest {
  venueId: string;
  activityId?: string;
  startTime: Date;
  endTime: Date;
  purpose: string;
  participants: number;
}

interface TimeSlot {
  startTime: Date;
  endTime: Date;
}

interface VenueAvailability {
  venue: Venue;
  available: boolean;
  conflictBookings?: VenueBooking[];
  score: number;
}

const LOCK_DURATION_MINUTES = 30;

class VenueService {
  private venueRepository: Repository<Venue>;
  private bookingRepository: Repository<VenueBooking>;
  private activityRepository: Repository<Activity>;

  constructor() {
    this.venueRepository = AppDataSource.getRepository(Venue);
    this.bookingRepository = AppDataSource.getRepository(VenueBooking);
    this.activityRepository = AppDataSource.getRepository(Activity);
  }

  async createVenue(data: CreateVenueRequest): Promise<Venue> {
    const existing = await this.venueRepository.findOne({ where: { name: data.name.trim() } });
    if (existing) {
      throw new Error(`场地名称 "${data.name}" 已存在`);
    }

    const venue = this.venueRepository.create({
      name: data.name.trim(),
      location: data.location.trim(),
      capacity: data.capacity,
      category: data.category.trim(),
      facilities: data.facilities || [],
      description: data.description || null,
      status: VenueStatus.AVAILABLE
    });

    return this.venueRepository.save(venue);
  }

  async getVenues(category?: string, status?: VenueStatus, page = 1, pageSize = 20): Promise<{ items: Venue[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (status) where.status = status;

    const [items, total] = await this.venueRepository.findAndCount({
      where,
      order: { name: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize
    });

    return { items, total };
  }

  async getVenueById(venueId: string): Promise<Venue | null> {
    return this.venueRepository.findOne({
      where: { id: venueId },
      relations: ['bookings']
    });
  }

  async checkCapacity(venueId: string, participants: number): Promise<{ valid: boolean; message: string }> {
    const venue = await this.venueRepository.findOne({ where: { id: venueId } });
    if (!venue) {
      return { valid: false, message: '场地不存在' };
    }

    if (venue.status !== VenueStatus.AVAILABLE) {
      return { valid: false, message: `场地当前状态为 ${venue.status}，不可预约` };
    }

    if (participants > venue.capacity) {
      return {
        valid: false,
        message: `超出场地容量限制。场地容量：${venue.capacity}人，申请人数：${participants}人`
      };
    }

    return {
      valid: true,
      message: `容量符合要求。场地容量：${venue.capacity}人，申请人数：${participants}人`
    };
  }

  async checkTimeConflict(venueId: string, startTime: Date, endTime: Date, excludeBookingId?: string): Promise<VenueBooking[]> {
    const query = this.bookingRepository
      .createQueryBuilder('booking')
      .where('booking.venueId = :venueId', { venueId })
      .andWhere('booking.status IN (:...statuses)', { statuses: [BookingStatus.CONFIRMED, BookingStatus.PENDING] })
      .andWhere('booking.startTime < :endTime', { endTime })
      .andWhere('booking.endTime > :startTime', { startTime });

    if (excludeBookingId) {
      query.andWhere('booking.id != :excludeBookingId', { excludeBookingId });
    }

    return query.getMany();
  }

  async getAvailableTimeSlots(venueId: string, date: Date): Promise<TimeSlot[]> {
    const venue = await this.venueRepository.findOne({ where: { id: venueId } });
    if (!venue) {
      throw new Error('场地不存在');
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(8, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(22, 0, 0, 0);

    const bookings = await this.bookingRepository.find({
      where: {
        venueId,
        startTime: LessThan(endOfDay) as unknown as Date,
        endTime: MoreThan(startOfDay) as unknown as Date,
        status: In([BookingStatus.CONFIRMED, BookingStatus.PENDING]) as unknown as BookingStatus
      },
      order: { startTime: 'ASC' }
    });

    const slots: TimeSlot[] = [];
    let currentTime = new Date(startOfDay);

    for (const booking of bookings) {
      if (currentTime < booking.startTime) {
        slots.push({
          startTime: new Date(currentTime),
          endTime: new Date(booking.startTime)
        });
      }
      currentTime = new Date(Math.max(currentTime.getTime(), booking.endTime.getTime()));
    }

    if (currentTime < endOfDay) {
      slots.push({
        startTime: new Date(currentTime),
        endTime: new Date(endOfDay)
      });
    }

    return slots.filter(slot => {
      const duration = (slot.endTime.getTime() - slot.startTime.getTime()) / (1000 * 60);
      return duration >= 30;
    });
  }

  async findAvailableVenues(
    startTime: Date,
    endTime: Date,
    participants: number,
    category?: string,
    facilities?: string[]
  ): Promise<VenueAvailability[]> {
    const where: Record<string, unknown> = { status: VenueStatus.AVAILABLE };
    if (category) where.category = category;

    let venues = await this.venueRepository.find({ where, order: { capacity: 'ASC' } });

    if (facilities && facilities.length > 0) {
      venues = venues.filter(v =>
        facilities.every(f => v.facilities?.includes(f)));
    }

    venues = venues.filter(v => v.capacity >= participants);

    const results: VenueAvailability[] = [];

    for (const venue of venues) {
      const conflicts = await this.checkTimeConflict(venue.id, startTime, endTime);
      const available = conflicts.length === 0;

      let score = 0;
      if (available) {
        const capacityFit = 1 - (venue.capacity - participants) / venue.capacity;
        score = capacityFit * 0.6;

        if (facilities) {
          const facilityMatch = facilities.filter(f => venue.facilities?.includes(f)).length / facilities.length;
          score += facilityMatch * 0.4;
        } else {
          score += 0.4;
        }
      }

      results.push({
        venue,
        available,
        conflictBookings: conflicts,
        score: Math.round(score * 100) / 100
      });
    }

    results.sort((a, b) => {
      if (a.available && !b.available) return -1;
      if (!a.available && b.available) return 1;
      return b.score - a.score;
    });

    return results;
  }

  async lockVenue(bookingId: string): Promise<VenueBooking | null> {
    const booking = await this.bookingRepository.findOne({ where: { id: bookingId } });
    if (!booking) {
      return null;
    }

    if (booking.isLocked) {
      throw new Error('该预约已锁定');
    }

    booking.isLocked = true;
    booking.lockedAt = new Date();

    const saved = await this.bookingRepository.save(booking);

    setTimeout(() => {
      this.autoReleaseLock(bookingId);
    }, LOCK_DURATION_MINUTES * 60 * 1000);

    return saved;
  }

  private async autoReleaseLock(bookingId: string): Promise<void> {
    const booking = await this.bookingRepository.findOne({ where: { id: bookingId } });
    if (booking && booking.isLocked && booking.status === BookingStatus.PENDING) {
      booking.isLocked = false;
      booking.lockedAt = null;
      await this.bookingRepository.save(booking);

      if (booking.activityId) {
        const activity = await this.activityRepository.findOne({ where: { id: booking.activityId } });
        if (activity) {
          await notificationService.createNotification(
            activity.club.leaderId,
            NotificationType.VENUE_BOOKING,
            '场地锁定已自动释放',
            `活动 "${activity.title}" 的场地 "${booking.venue.name}" 锁定已超时自动释放，请重新预约`,
            booking.id,
            'booking'
          );
        }
      }
    }
  }

  async autoReleaseExpiredLocks(): Promise<number> {
    const now = new Date();
    const timeoutDate = new Date(now.getTime() - LOCK_DURATION_MINUTES * 60 * 1000);

    const expiredBookings = await this.bookingRepository.find({
      where: {
        isLocked: true,
        status: BookingStatus.PENDING,
        lockedAt: LessThanOrEqual(timeoutDate) as unknown as Date
      } as unknown as Record<string, unknown>,
      relations: ['venue', 'activity', 'activity.club']
    });

    let released = 0;
    for (const booking of expiredBookings) {
      booking.isLocked = false;
      booking.lockedAt = null;
      await this.bookingRepository.save(booking);
      released++;

      if (booking.activityId && booking.activity) {
        await notificationService.createNotification(
          booking.activity.club.leaderId,
          NotificationType.VENUE_BOOKING,
          '场地锁定已自动释放',
          `活动 "${booking.activity.title}" 的场地 "${booking.venue.name}" 锁定已超时自动释放，请重新预约`,
          booking.id,
          'booking'
        );
      }
    }

    return released;
  }

  async createBooking(data: BookingRequest): Promise<{ booking: VenueBooking; validation: { valid: boolean; errors: string[] } }> {
    const errors: string[] = [];

    const venue = await this.venueRepository.findOne({ where: { id: data.venueId } });
    if (!venue) {
      errors.push('场地不存在');
      return { booking: null!, validation: { valid: false, errors } };
    }

    const capacityCheck = await this.checkCapacity(data.venueId, data.participants);
    if (!capacityCheck.valid) {
      errors.push(capacityCheck.message);
    }

    const conflicts = await this.checkTimeConflict(data.venueId, data.startTime, data.endTime);
    if (conflicts.length > 0) {
      const conflictDetails = conflicts.map(c =>
        `${c.startTime.toLocaleString()}-${c.endTime.toLocaleString()}`).join('、');
      errors.push(`场地时段冲突，冲突时段：${conflictDetails}`);
    }

    let activity: Activity | null = null;
    if (data.activityId) {
      activity = await this.activityRepository.findOne({ where: { id: data.activityId } });
      if (!activity) {
        errors.push('关联活动不存在');
      }
    }

    if (errors.length > 0) {
      const booking = this.bookingRepository.create({
        venueId: data.venueId,
        venue: venue!,
        activityId: data.activityId || null,
        activity: activity || null,
        startTime: data.startTime,
        endTime: data.endTime,
        purpose: data.purpose,
        participants: data.participants,
        status: BookingStatus.CANCELLED,
        rejectReason: errors.join('；')
      });

      const savedBooking = await this.bookingRepository.save(booking);

      return { booking: savedBooking, validation: { valid: false, errors } };
    }

    const booking = this.bookingRepository.create({
      venueId: data.venueId,
      venue: venue!,
      activityId: data.activityId || null,
      activity: activity || null,
      startTime: data.startTime,
      endTime: data.endTime,
      purpose: data.purpose,
      participants: data.participants,
      status: BookingStatus.PENDING
    });

    const savedBooking = await this.bookingRepository.save(booking);

    const lockedBooking = await this.lockVenue(savedBooking.id);

    if (activity && activity.club.leaderId) {
      await notificationService.createNotification(
        activity.club.leaderId,
        NotificationType.VENUE_BOOKING,
        '场地预约已提交',
        `活动 "${activity.title}" 的场地 "${venue!.name}" 预约已提交并锁定，请在 ${LOCK_DURATION_MINUTES} 分钟内完成确认`,
        savedBooking.id,
        'booking'
      );
    }

    notificationService.broadcastStatusUpdate(
      activity ? [activity.club.leaderId] : [],
      'venue_booking',
      { bookingId: savedBooking.id, status: BookingStatus.PENDING, locked: true }
    );

    return { booking: lockedBooking!, validation: { valid: true, errors: [] } };
  }

  async confirmBooking(bookingId: string): Promise<VenueBooking | null> {
    const booking = await this.bookingRepository.findOne({ where: { id: bookingId }, relations: ['activity', 'venue'] });
    if (!booking) {
      return null;
    }

    if (booking.status !== BookingStatus.PENDING) {
      throw new Error('该预约状态不允许确认');
    }

    booking.status = BookingStatus.CONFIRMED;

    const saved = await this.bookingRepository.save(booking);

    if (booking.activity) {
      await notificationService.notifyClubMembers(
        booking.activity.clubId,
        NotificationType.VENUE_BOOKING,
        '场地预约已确认',
        `活动 "${booking.activity.title}" 的场地 "${booking.venue.name}" 预约已确认`,
        booking.id,
        'booking'
      );
    }

    notificationService.broadcastStatusUpdate(
      booking.activity ? [booking.activity.club.leaderId] : [],
      'venue_booking',
      { bookingId: saved.id, status: BookingStatus.CONFIRMED }
    );

    return saved;
  }

  async cancelBooking(bookingId: string, reason: string): Promise<VenueBooking | null> {
    const booking = await this.bookingRepository.findOne({ where: { id: bookingId }, relations: ['activity', 'venue'] });
    if (!booking) {
      return null;
    }

    booking.status = BookingStatus.CANCELLED;
    booking.rejectReason = reason;
    booking.isLocked = false;
    booking.lockedAt = null;

    const saved = await this.bookingRepository.save(booking);

    if (booking.activity) {
      await notificationService.createNotification(
        booking.activity.club.leaderId,
        NotificationType.VENUE_BOOKING,
        '场地预约已取消',
        `活动 "${booking.activity.title}" 的场地 "${booking.venue.name}" 预约已取消，原因：${reason}`,
        booking.id,
        'booking'
      );
    }

    return saved;
  }

  async getBookings(venueId?: string, activityId?: string, status?: BookingStatus, page = 1, pageSize = 20): Promise<{ items: VenueBooking[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (venueId) where.venueId = venueId;
    if (activityId) where.activityId = activityId;
    if (status) where.status = status;

    const [items, total] = await this.bookingRepository.findAndCount({
      where,
      order: { startTime: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize
    });

    return { items, total };
  }

  async getBookingById(bookingId: string): Promise<VenueBooking | null> {
    return this.bookingRepository.findOne({
      where: { id: bookingId },
      relations: ['venue', 'activity']
    });
  }
}

export const venueService = new VenueService();
