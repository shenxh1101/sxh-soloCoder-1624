import { Repository, LessThan, In } from 'typeorm';
import { Attendance, Activity, User, ClubMember } from '../entities';
import { ActivityStatus, NotificationType } from '../types';
import { AppDataSource } from '../config/database';
import { notificationService } from './NotificationService';
import { clubService } from './ClubService';

interface SignInRequest {
  activityId: string;
  userId: string;
  signInMethod?: string;
}

interface SignOutRequest {
  activityId: string;
  userId: string;
}

class AttendanceService {
  private attendanceRepository: Repository<Attendance>;
  private activityRepository: Repository<Activity>;
  private userRepository: Repository<User>;
  private memberRepository: Repository<ClubMember>;

  constructor() {
    this.attendanceRepository = AppDataSource.getRepository(Attendance);
    this.activityRepository = AppDataSource.getRepository(Activity);
    this.userRepository = AppDataSource.getRepository(User);
    this.memberRepository = AppDataSource.getRepository(ClubMember);
  }

  async signIn(data: SignInRequest): Promise<Attendance> {
    const activity = await this.activityRepository.findOne({ where: { id: data.activityId }, relations: ['club'] });
    if (!activity) {
      throw new Error('活动不存在');
    }

    if (activity.status !== ActivityStatus.APPROVED) {
      throw new Error('该活动状态不允许签到');
    }

    const now = new Date();
    if (now < activity.startTime) {
      throw new Error('活动尚未开始，暂时无法签到');
    }
    if (now > activity.endTime) {
      throw new Error('活动已结束，无法签到');
    }

    const user = await this.userRepository.findOne({ where: { id: data.userId } });
    if (!user) {
      throw new Error('用户不存在');
    }

    const existingAttendance = await this.attendanceRepository.findOne({
      where: { activityId: data.activityId, userId: data.userId }
    });
    if (existingAttendance) {
      if (existingAttendance.signInTime) {
        throw new Error('您已完成签到，请勿重复操作');
      }
      existingAttendance.signInTime = now;
      existingAttendance.isPresent = true;
      existingAttendance.signInMethod = data.signInMethod || 'manual';

      const saved = await this.attendanceRepository.save(existingAttendance);
      await this.updateActivityParticipants(data.activityId);
      return saved;
    }

    const isClubMember = await this.memberRepository.findOne({
      where: { clubId: activity.clubId, userId: data.userId, isActive: true }
    });

    if (!isClubMember) {
      throw new Error('您不是该社团成员，无法签到');
    }

    const attendance = this.attendanceRepository.create({
      activityId: data.activityId,
      activity,
      userId: data.userId,
      user,
      signInTime: now,
      isPresent: true,
      signInMethod: data.signInMethod || 'manual'
    });

    const saved = await this.attendanceRepository.save(attendance);
    await this.updateActivityParticipants(data.activityId);

    await notificationService.createNotification(
      data.userId,
      NotificationType.SIGN_IN,
      '签到成功',
      `您已成功签到活动 "${activity.title}"`,
      activity.id,
      'attendance'
    );

    notificationService.pushStatusUpdate(
      data.userId,
      'attendance',
      { activityId: data.activityId, signedIn: true, time: now }
    );

    return saved;
  }

  async signOut(data: SignOutRequest): Promise<Attendance | null> {
    const activity = await this.activityRepository.findOne({ where: { id: data.activityId }, relations: ['club'] });
    if (!activity) {
      throw new Error('活动不存在');
    }

    const attendance = await this.attendanceRepository.findOne({
      where: { activityId: data.activityId, userId: data.userId }
    });
    if (!attendance) {
      throw new Error('未找到签到记录，请先完成签到');
    }

    if (!attendance.signInTime) {
      throw new Error('您尚未完成签到，无法签退');
    }

    if (attendance.signOutTime) {
      throw new Error('您已完成签退，请勿重复操作');
    }

    const now = new Date();
    attendance.signOutTime = now;

    const durationMs = now.getTime() - attendance.signInTime.getTime();
    const durationHours = Math.round((durationMs / (1000 * 60 * 60)) * 100) / 100;
    attendance.durationHours = durationHours;

    const saved = await this.attendanceRepository.save(attendance);

    const pointsEarned = Math.floor(durationHours * 2);
    if (pointsEarned > 0) {
      await clubService.addClubPoints(
        activity.clubId,
        pointsEarned,
        `成员参与活动"${activity.title}"，时长${durationHours}小时`,
        activity.id
      );
    }

    await notificationService.createNotification(
      data.userId,
      NotificationType.SIGN_IN,
      '签退成功',
      `您已成功签退活动 "${activity.title}"，参与时长 ${durationHours} 小时，社团获得 ${pointsEarned} 积分`,
      activity.id,
      'attendance'
    );

    notificationService.pushStatusUpdate(
      data.userId,
      'attendance',
      { activityId: data.activityId, signedOut: true, durationHours, pointsEarned }
    );

    return saved;
  }

  private async updateActivityParticipants(activityId: string): Promise<void> {
    const signedInCount = await this.attendanceRepository.count({
      where: { activityId, isPresent: true }
    });

    await this.activityRepository.update(activityId, {
      actualParticipants: signedInCount
    });
  }

  async bulkSignIn(activityId: string, userIds: string[], signInMethod?: string): Promise<Attendance[]> {
    const results: Attendance[] = [];
    const errors: string[] = [];

    for (const userId of userIds) {
      try {
        const attendance = await this.signIn({ activityId, userId, signInMethod });
        results.push(attendance);
      } catch (error) {
        errors.push(`用户 ${userId}: ${(error as Error).message}`);
      }
    }

    if (errors.length > 0) {
      console.warn('批量签到部分失败:', errors);
    }

    return results;
  }

  async getActivityAttendance(activityId: string): Promise<{ items: Attendance[]; total: number; presentCount: number }> {
    const [items, total] = await this.attendanceRepository.findAndCount({
      where: { activityId },
      order: { signInTime: 'ASC' }
    });

    const presentCount = items.filter(a => a.isPresent).length;

    return { items, total, presentCount };
  }

  async getUserAttendance(userId: string, page = 1, pageSize = 20): Promise<{ items: Attendance[]; total: number; totalHours: number }> {
    const [items, total] = await this.attendanceRepository.findAndCount({
      where: { userId },
      relations: ['activity'],
      order: { signInTime: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize
    });

    const totalHours = items.reduce((sum, a) => sum + (a.durationHours || 0), 0);

    return { items, total, totalHours };
  }

  async calculateUserTotalHours(userId: string, startDate?: Date, endDate?: Date): Promise<number> {
    let query = this.attendanceRepository
      .createQueryBuilder('attendance')
      .where('attendance.userId = :userId', { userId })
      .andWhere('attendance.signOutTime IS NOT NULL');

    if (startDate) {
      query = query.andWhere('attendance.signInTime >= :startDate', { startDate });
    }
    if (endDate) {
      query = query.andWhere('attendance.signInTime <= :endDate', { endDate });
    }

    const result = await query
      .select('SUM(attendance.durationHours)', 'total')
      .getRawOne();

    return parseFloat(result?.total || '0');
  }

  async getAttendanceStats(activityId: string): Promise<{
    totalSignedIn: number;
    totalSignedOut: number;
    averageDuration: number;
    totalParticipationHours: number;
  }> {
    const attendances = await this.attendanceRepository.find({
      where: { activityId }
    });

    const signedIn = attendances.filter(a => a.signInTime).length;
    const signedOut = attendances.filter(a => a.signOutTime).length;
    const completed = attendances.filter(a => a.signInTime && a.signOutTime);
    const totalHours = completed.reduce((sum, a) => sum + (a.durationHours || 0), 0);
    const avgDuration = completed.length > 0 ? totalHours / completed.length : 0;

    return {
      totalSignedIn: signedIn,
      totalSignedOut: signedOut,
      averageDuration: Math.round(avgDuration * 100) / 100,
      totalParticipationHours: Math.round(totalHours * 100) / 100
    };
  }

  async getAttendanceById(attendanceId: string): Promise<Attendance | null> {
    return this.attendanceRepository.findOne({
      where: { id: attendanceId },
      relations: ['activity', 'user']
    });
  }

  async autoSignOutAll(activityId?: string): Promise<number> {
    let updatedCount = 0;

    if (activityId) {
      const activity = await this.activityRepository.findOne({ where: { id: activityId } });
      if (!activity) {
        throw new Error('活动不存在');
      }

      const attendances = await this.attendanceRepository.find({
        where: {
          activityId,
          signOutTime: null as unknown as Date
        } as unknown as Record<string, unknown>
      });

      for (const attendance of attendances) {
        if (!attendance.signOutTime) {
          attendance.signOutTime = activity.endTime;
          const durationMs = activity.endTime.getTime() - (attendance.signInTime || activity.startTime).getTime();
          attendance.durationHours = Math.round((durationMs / (1000 * 60 * 60)) * 100) / 100;
          await this.attendanceRepository.save(attendance);
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        const activityRecord = await this.activityRepository.findOne({ where: { id: activityId }, relations: ['club'] });
        if (activityRecord) {
          const totalHours = attendances.reduce((sum, a) => sum + (a.durationHours || 0), 0);
          const pointsEarned = Math.floor(totalHours * 2);
          if (pointsEarned > 0) {
            await clubService.addClubPoints(
              activityRecord.clubId,
              pointsEarned,
              `活动"${activityRecord.title}"自动签退，总参与时长${totalHours}小时`,
              activityId
            );
          }
        }
      }
    } else {
      const now = new Date();
      const activities = await this.activityRepository.find({
        where: {
          endTime: LessThan(now) as unknown as Date,
          status: In([ActivityStatus.APPROVED, ActivityStatus.COMPLETED] as ActivityStatus[]) as unknown as ActivityStatus
        } as unknown as Record<string, unknown>,
        relations: ['club']
      });

      for (const activity of activities) {
        const attendances = await this.attendanceRepository.find({
          where: {
            activityId: activity.id,
            signOutTime: null as unknown as Date
          } as unknown as Record<string, unknown>
        });

        let activityUpdated = 0;
        for (const attendance of attendances) {
          if (!attendance.signOutTime) {
            attendance.signOutTime = activity.endTime;
            const durationMs = activity.endTime.getTime() - (attendance.signInTime || activity.startTime).getTime();
            attendance.durationHours = Math.round((durationMs / (1000 * 60 * 60)) * 100) / 100;
            await this.attendanceRepository.save(attendance);
            updatedCount++;
            activityUpdated++;
          }
        }

        if (activityUpdated > 0) {
          const totalHours = attendances.reduce((sum, a) => sum + (a.durationHours || 0), 0);
          const pointsEarned = Math.floor(totalHours * 2);
          if (pointsEarned > 0) {
            await clubService.addClubPoints(
              activity.clubId,
              pointsEarned,
              `活动"${activity.title}"自动签退，总参与时长${totalHours}小时`,
              activity.id
            );
          }
        }
      }
    }

    return updatedCount;
  }
}

export const attendanceService = new AttendanceService();
