import { Repository, Between, LessThanOrEqual } from 'typeorm';
import { Activity, ActivityApproval, Club } from '../entities';
import { ActivityStatus, ApprovalStatus, ApprovalLevel, NotificationType, UserRole } from '../types';
import { AppDataSource } from '../config/database';
import { notificationService } from './NotificationService';
import { clubService } from './ClubService';

interface CreateActivityRequest {
  title: string;
  description: string;
  category: string;
  startTime: Date;
  endTime: Date;
  budget: number;
  expectedParticipants: number;
  clubId: string;
}

const BUDGET_THRESHOLD = 1000;
const APPROVAL_TIMEOUT_HOURS = 4;

class ActivityService {
  private activityRepository: Repository<Activity>;
  private approvalRepository: Repository<ActivityApproval>;
  private clubRepository: Repository<Club>;

  constructor() {
    this.activityRepository = AppDataSource.getRepository(Activity);
    this.approvalRepository = AppDataSource.getRepository(ActivityApproval);
    this.clubRepository = AppDataSource.getRepository(Club);
  }

  async createActivity(data: CreateActivityRequest): Promise<Activity> {
    const club = await this.clubRepository.findOne({ where: { id: data.clubId } });
    if (!club) {
      throw new Error('社团不存在');
    }

    if (data.startTime >= data.endTime) {
      throw new Error('活动开始时间必须早于结束时间');
    }

    const activity = this.activityRepository.create({
      title: data.title.trim(),
      description: data.description.trim(),
      category: data.category.trim(),
      startTime: data.startTime,
      endTime: data.endTime,
      budget: data.budget,
      expectedParticipants: data.expectedParticipants,
      clubId: data.clubId,
      club,
      status: ActivityStatus.DRAFT
    });

    return this.activityRepository.save(activity);
  }

  async submitForApproval(activityId: string): Promise<{ activity: Activity; approvals: ActivityApproval[] }> {
    const activity = await this.activityRepository.findOne({
      where: { id: activityId },
      relations: ['club']
    });
    if (!activity) {
      throw new Error('活动不存在');
    }

    if (activity.status !== ActivityStatus.DRAFT) {
      throw new Error('该活动状态不允许提交审批');
    }

    const approvals: ActivityApproval[] = [];

    if (activity.budget > BUDGET_THRESHOLD) {
      activity.status = ActivityStatus.PENDING_APPROVAL;

      if (activity.club.advisorId) {
        const advisorApproval = this.approvalRepository.create({
          activityId: activity.id,
          activity,
          level: ApprovalLevel.ADVISOR,
          approverId: activity.club.advisorId,
          status: ApprovalStatus.PENDING
        });
        approvals.push(await this.approvalRepository.save(advisorApproval));

        await notificationService.createNotification(
          activity.club.advisorId,
          NotificationType.ACTIVITY_APPROVAL,
          '活动审批待处理',
          `活动 "${activity.title}" 预算 ${activity.budget} 元超支，需要您的审批`,
          activity.id,
          'activity'
        );
      }

      const leagueApproval = this.approvalRepository.create({
        activityId: activity.id,
        activity,
        level: ApprovalLevel.LEAGUE_COMMITTEE,
        status: ApprovalStatus.PENDING
      });
      approvals.push(await this.approvalRepository.save(leagueApproval));

      await notificationService.notifyLeadersAndCommittee(
        NotificationType.ACTIVITY_APPROVAL,
        '活动审批待处理',
        `活动 "${activity.title}" 预算 ${activity.budget} 元超支，需要团委审批`,
        activity.club.leaderId,
        activity.id,
        'activity'
      );

      await notificationService.createNotification(
        activity.club.leaderId,
        NotificationType.ACTIVITY_APPROVAL,
        '活动已提交审批',
        `活动 "${activity.title}" 预算 ${activity.budget} 元超支，已提交多级审批，请等待审核`,
        activity.id,
        'activity'
      );
    } else {
      activity.status = ActivityStatus.APPROVED;
      activity.approvedAt = new Date();

      await notificationService.createNotification(
        activity.club.leaderId,
        NotificationType.ACTIVITY_APPROVAL,
        '活动已自动通过',
        `活动 "${activity.title}" 预算 ${activity.budget} 元在阈值内，已自动通过审批`,
        activity.id,
        'activity'
      );
    }

    const savedActivity = await this.activityRepository.save(activity);

    notificationService.broadcastStatusUpdate(
      [activity.club.leaderId],
      'activity_status',
      { activityId: savedActivity.id, status: savedActivity.status }
    );

    return { activity: savedActivity, approvals };
  }

  async processApproval(
    approvalId: string,
    approverId: string,
    approved: boolean,
    comment?: string
  ): Promise<ActivityApproval | null> {
    const approval = await this.approvalRepository.findOne({
      where: { id: approvalId },
      relations: ['activity', 'activity.club']
    });
    if (!approval) {
      return null;
    }

    if (approval.status !== ApprovalStatus.PENDING) {
      throw new Error('该审批已处理');
    }

    approval.approverId = approverId;
    approval.status = approved ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
    approval.comment = comment || null;
    approval.reviewedAt = new Date();

    const savedApproval = await this.approvalRepository.save(approval);

    await this.checkAndUpdateActivityStatus(approval.activityId);

    const activity = approval.activity;
    const statusText = approved ? '已通过' : '已拒绝';
    const levelText = approval.level === ApprovalLevel.ADVISOR ? '指导老师' : '团委';

    await notificationService.createNotification(
      activity.club.leaderId,
      NotificationType.ACTIVITY_APPROVAL,
      `活动审批${statusText}`,
      `活动 "${activity.title}" 的${levelText}审批${statusText}${comment ? `，意见：${comment}` : ''}`,
      activity.id,
      'activity'
    );

    notificationService.broadcastStatusUpdate(
      [activity.club.leaderId],
      'approval_status',
      { approvalId: savedApproval.id, status: savedApproval.status }
    );

    return savedApproval;
  }

  private async checkAndUpdateActivityStatus(activityId: string): Promise<void> {
    const activity = await this.activityRepository.findOne({
      where: { id: activityId },
      relations: ['approvals']
    });
    if (!activity) return;

    const approvals = activity.approvals;
    if (approvals.length === 0) return;

    const hasRejected = approvals.some(a => a.status === ApprovalStatus.REJECTED);
    if (hasRejected) {
      activity.status = ActivityStatus.REJECTED;
      const rejectedApproval = approvals.find(a => a.status === ApprovalStatus.REJECTED);
      activity.rejectReason = rejectedApproval?.comment || '审批未通过';
      await this.activityRepository.save(activity);
      return;
    }

    const advisorApproval = approvals.find(a => a.level === ApprovalLevel.ADVISOR);
    const leagueApproval = approvals.find(a => a.level === ApprovalLevel.LEAGUE_COMMITTEE);

    const allApproved = approvals.every(a => a.status === ApprovalStatus.APPROVED);
    if (allApproved) {
      activity.status = ActivityStatus.APPROVED;
      activity.approvedAt = new Date();
      await this.activityRepository.save(activity);

      await notificationService.notifyClubMembers(
        activity.clubId,
        NotificationType.ACTIVITY_APPROVAL,
        '活动审批已通过',
        `活动 "${activity.title}" 已通过全部审批，可以开始筹备`,
        activity.id,
        'activity'
      );
      return;
    }

    if (advisorApproval?.status === ApprovalStatus.APPROVED && leagueApproval?.status === ApprovalStatus.PENDING) {
      leagueApproval.escalated = true;
      leagueApproval.escalatedAt = new Date();
      await this.approvalRepository.save(leagueApproval);

      await notificationService.notifyLeadersAndCommittee(
        NotificationType.ACTIVITY_APPROVAL,
        '活动审批待团委处理',
        `活动 "${activity.title}" 已通过指导老师审批，请团委及时处理`,
        undefined,
        activity.id,
        'activity'
      );
    }
  }

  async checkApprovalTimeouts(): Promise<{ reminded: number; escalated: number }> {
    const now = new Date();
    const timeoutDate = new Date(now.getTime() - APPROVAL_TIMEOUT_HOURS * 60 * 60 * 1000);

    const pendingApprovals = await this.approvalRepository.find({
      where: {
        status: ApprovalStatus.PENDING,
        createdAt: LessThanOrEqual(timeoutDate) as unknown as Date
      } as unknown as Record<string, unknown>,
      relations: ['activity', 'activity.club'],
      order: { createdAt: 'ASC' }
    });

    const expiredApprovals = pendingApprovals.filter(a => {
      const lastReminder = a.lastReminderAt || a.createdAt;
      return lastReminder <= timeoutDate;
    });

    let reminded = 0;
    let escalated = 0;

    for (const approval of expiredApprovals) {
      approval.reminderCount++;
      approval.lastReminderAt = now;
      await this.approvalRepository.save(approval);

      const activity = approval.activity;
      const levelText = approval.level === ApprovalLevel.ADVISOR ? '指导老师' : '团委';

      if (approval.reminderCount >= 2) {
        approval.status = ApprovalStatus.ESCALATED;
        approval.escalated = true;
        approval.escalatedAt = now;
        await this.approvalRepository.save(approval);
        escalated++;

        if (approval.level === ApprovalLevel.ADVISOR && activity.club.advisorId) {
          await notificationService.createNotification(
            activity.club.advisorId,
            NotificationType.APPROVAL_REMINDER,
            '审批超时已升级',
            `活动 "${activity.title}" 的${levelText}审批已超时 ${APPROVAL_TIMEOUT_HOURS * approval.reminderCount} 小时，已自动升级至团委审批`,
            activity.id,
            'activity'
          );

          await notificationService.notifyLeadersAndCommittee(
            NotificationType.APPROVAL_REMINDER,
            '审批超时升级通知',
            `活动 "${activity.title}" 的${levelText}审批已超时，已自动升级至团委处理`,
            activity.club.leaderId,
            activity.id,
            'activity'
          );

          const leagueApproval = await this.approvalRepository.findOne({
            where: {
              activityId: activity.id,
              level: ApprovalLevel.LEAGUE_COMMITTEE
            }
          });
          if (leagueApproval) {
            leagueApproval.escalated = true;
            leagueApproval.escalatedAt = now;
            await this.approvalRepository.save(leagueApproval);
          }
        }
      } else {
        reminded++;
        const approverId = approval.approverId;
        if (approverId) {
          await notificationService.createNotification(
            approverId,
            NotificationType.APPROVAL_REMINDER,
            '审批催办通知',
            `活动 "${activity.title}" 的${levelText}审批已待处理 ${APPROVAL_TIMEOUT_HOURS} 小时，请及时处理（第 ${approval.reminderCount} 次提醒）`,
            activity.id,
            'activity'
          );
        }

        await notificationService.createNotification(
          activity.club.leaderId,
          NotificationType.APPROVAL_REMINDER,
          '审批进度提醒',
          `活动 "${activity.title}" 的${levelText}审批正在处理中，已发送催办通知`,
          activity.id,
          'activity'
        );
      }
    }

    return { reminded, escalated };
  }

  async getActivityById(activityId: string): Promise<Activity | null> {
    return this.activityRepository.findOne({
      where: { id: activityId },
      relations: ['club', 'approvals', 'bookings', 'attendances']
    });
  }

  async getActivities(
    clubId?: string,
    status?: ActivityStatus,
    startDate?: Date,
    endDate?: Date,
    page = 1,
    pageSize = 20
  ): Promise<{ items: Activity[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (clubId) where.clubId = clubId;
    if (status) where.status = status;

    let query = this.activityRepository.createQueryBuilder('activity')
      .where(where)
      .leftJoinAndSelect('activity.club', 'club');

    if (startDate && endDate) {
      query = query.andWhere('activity.startTime BETWEEN :startDate AND :endDate', { startDate, endDate });
    } else if (startDate) {
      query = query.andWhere('activity.startTime >= :startDate', { startDate });
    } else if (endDate) {
      query = query.andWhere('activity.startTime <= :endDate', { endDate });
    }

    const [items, total] = await query
      .orderBy('activity.startTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { items, total };
  }

  async getApprovals(
    activityId?: string,
    level?: ApprovalLevel,
    status?: ApprovalStatus,
    page = 1,
    pageSize = 20
  ): Promise<{ items: ActivityApproval[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (activityId) where.activityId = activityId;
    if (level) where.level = level;
    if (status) where.status = status;

    const [items, total] = await this.approvalRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize
    });

    return { items, total };
  }

  async completeActivity(activityId: string, actualCost: number, actualParticipants: number): Promise<Activity | null> {
    const activity = await this.activityRepository.findOne({ where: { id: activityId }, relations: ['club'] });
    if (!activity) {
      return null;
    }

    if (activity.status !== ActivityStatus.APPROVED) {
      throw new Error('该活动状态不允许完成');
    }

    activity.status = ActivityStatus.COMPLETED;
    activity.actualCost = actualCost;
    activity.actualParticipants = actualParticipants;

    const saved = await this.activityRepository.save(activity);

    const basePoints = 10;
    const participantPoints = Math.floor(actualParticipants * 0.5);
    const totalPoints = basePoints + participantPoints;

    await clubService.addClubPoints(
      activity.clubId,
      totalPoints,
      `活动 "${activity.title}" 顺利完成`,
      activity.id
    );

    await notificationService.notifyClubMembers(
      activity.clubId,
      NotificationType.SYSTEM,
      '活动已完成',
      `活动 "${activity.title}" 已完成，参与人数 ${actualParticipants} 人，获得积分 ${totalPoints} 分`,
      activity.id,
      'activity'
    );

    return saved;
  }

  async cancelActivity(activityId: string, reason: string): Promise<Activity | null> {
    const activity = await this.activityRepository.findOne({ where: { id: activityId }, relations: ['club'] });
    if (!activity) {
      return null;
    }

    if (![ActivityStatus.DRAFT, ActivityStatus.APPROVED, ActivityStatus.PENDING_APPROVAL].includes(activity.status)) {
      throw new Error('该活动状态不允许取消');
    }

    activity.status = ActivityStatus.CANCELLED;
    activity.rejectReason = reason;

    const saved = await this.activityRepository.save(activity);

    await notificationService.notifyClubMembers(
      activity.clubId,
      NotificationType.SYSTEM,
      '活动已取消',
      `活动 "${activity.title}" 已取消，原因：${reason}`,
      activity.id,
      'activity'
    );

    return saved;
  }
}

export const activityService = new ActivityService();
