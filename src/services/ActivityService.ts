import { Repository, Between, LessThanOrEqual, In } from 'typeorm';
import { Activity, ActivityApproval, ActivityApprovalFlow, Club, User } from '../entities';
import { ActivityStatus, ApprovalStatus, ApprovalLevel, NotificationType, UserRole, ApprovalFlowAction, FlowNodeStatus } from '../types';
import type { ApprovalFlowNode, ApprovalDashboardStats, ApprovalDashboardItem } from '../types';
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
  private flowRepository: Repository<ActivityApprovalFlow>;
  private clubRepository: Repository<Club>;
  private userRepository: Repository<User>;

  constructor() {
    this.activityRepository = AppDataSource.getRepository(Activity);
    this.approvalRepository = AppDataSource.getRepository(ActivityApproval);
    this.flowRepository = AppDataSource.getRepository(ActivityApprovalFlow);
    this.clubRepository = AppDataSource.getRepository(Club);
    this.userRepository = AppDataSource.getRepository(User);
  }

  private async addFlowRecord(
    activityId: string,
    action: ApprovalFlowAction,
    options: {
      level?: ApprovalLevel | null;
      actorId?: string | null;
      actorName?: string | null;
      comment?: string | null;
      description?: string | null;
    } = {}
  ): Promise<ActivityApprovalFlow> {
    const record = this.flowRepository.create({
      activityId,
      action,
      level: options.level ?? null,
      actorId: options.actorId ?? null,
      actorName: options.actorName ?? null,
      comment: options.comment ?? null,
      description: options.description ?? null,
    });
    return this.flowRepository.save(record);
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
        status: ApprovalStatus.QUEUED
      });
      approvals.push(await this.approvalRepository.save(leagueApproval));

      await notificationService.createNotification(
        activity.club.leaderId,
        NotificationType.ACTIVITY_APPROVAL,
        '活动已提交审批',
        `活动 "${activity.title}" 预算 ${activity.budget} 元超支，已提交多级审批，请等待审核`,
        activity.id,
        'activity'
      );

      await this.addFlowRecord(activity.id, ApprovalFlowAction.SUBMITTED, {
        description: '活动提交超预算多级审批，当前待指导老师审批',
      });
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

      await this.addFlowRecord(activity.id, ApprovalFlowAction.COMPLETED, {
        description: '活动预算在阈值内，自动通过审批',
      });
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
      relations: ['activity', 'activity.club', 'activity.approvals', 'approver']
    });
    if (!approval) {
      return null;
    }

    if (approval.status === ApprovalStatus.QUEUED) {
      const levelText = approval.level === ApprovalLevel.ADVISOR ? '指导老师' : '团委';
      throw new Error(`该审批尚未进入待处理状态（${levelText}），请等待前级审批完成`);
    }

    if (approval.status !== ApprovalStatus.PENDING && approval.status !== ApprovalStatus.ESCALATED) {
      throw new Error('该审批已处理');
    }

    if (approval.level === ApprovalLevel.LEAGUE_COMMITTEE) {
      const advisorApproval = approval.activity.approvals.find(
        a => a.level === ApprovalLevel.ADVISOR
      );
      if (advisorApproval && advisorApproval.status === ApprovalStatus.PENDING) {
        throw new Error('指导老师尚未审批，团委不能直接处理。请等待指导老师先完成审批');
      }
      if (advisorApproval && advisorApproval.status === ApprovalStatus.QUEUED) {
        throw new Error('指导老师审批尚未启动，团委不能提前处理');
      }
    }

    const approver = await this.userRepository.findOne({ where: { id: approverId } });
    const approverName = approver?.name || approverId;

    approval.approverId = approverId;
    approval.status = approved ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
    approval.comment = comment || null;
    approval.reviewedAt = new Date();

    const savedApproval = await this.approvalRepository.save(approval);

    const levelText = approval.level === ApprovalLevel.ADVISOR ? '指导老师' : '团委';
    const statusText = approved ? '通过' : '拒绝';

    await this.addFlowRecord(approval.activityId, approved ? ApprovalFlowAction.APPROVED : ApprovalFlowAction.REJECTED, {
      level: approval.level,
      actorId: approverId,
      actorName: approverName,
      comment: comment || null,
      description: `${levelText}${statusText}${comment ? `，意见：${comment}` : ''}`,
    });

    if (approval.level === ApprovalLevel.LEAGUE_COMMITTEE) {
      const advisorApproval = approval.activity.approvals.find(
        a => a.level === ApprovalLevel.ADVISOR
      );
      if (advisorApproval && advisorApproval.status === ApprovalStatus.ESCALATED) {
        advisorApproval.status = approved ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
        advisorApproval.approverId = approverId;
        advisorApproval.comment = comment || '超时升级后由团委一并处理';
        advisorApproval.reviewedAt = new Date();
        await this.approvalRepository.save(advisorApproval);

        await this.addFlowRecord(approval.activityId, approved ? ApprovalFlowAction.APPROVED : ApprovalFlowAction.REJECTED, {
          level: ApprovalLevel.ADVISOR,
          actorId: approverId,
          actorName: approverName,
          comment: comment || '超时升级后由团委一并处理',
          description: `指导老师审批超时升级，由团委${statusText}`,
        });
      }
    }

    await this.checkAndUpdateActivityStatus(approval.activityId);

    const activity = approval.activity;

    await notificationService.createNotification(
      activity.club.leaderId,
      NotificationType.ACTIVITY_APPROVAL,
      `活动审批${statusText}`,
      `活动 "${activity.title}" 的${levelText}审批${statusText}${comment ? `，意见：${comment}` : ''}`,
      activity.id,
      'activity'
    );

    if (approved && approval.level === ApprovalLevel.ADVISOR) {
      const leagueApproval = approval.activity.approvals.find(
        a => a.level === ApprovalLevel.LEAGUE_COMMITTEE
      );
      if (leagueApproval && (leagueApproval.status === ApprovalStatus.QUEUED || leagueApproval.status === ApprovalStatus.PENDING)) {
        leagueApproval.status = ApprovalStatus.PENDING;
        await this.approvalRepository.save(leagueApproval);

        const committeeUsers = await this.userRepository.find({
          where: { role: In([UserRole.LEAGUE_COMMITTEE, UserRole.ADMIN] as UserRole[]) as unknown as UserRole }
        } as unknown as Record<string, unknown>);

        for (const cu of committeeUsers) {
          await notificationService.createNotification(
            cu.id,
            NotificationType.ACTIVITY_APPROVAL,
            '活动审批待团委处理',
            `活动 "${activity.title}" 已通过指导老师审批，请您进行团委审批`,
            activity.id,
            'activity'
          );
        }

        await this.addFlowRecord(approval.activityId, ApprovalFlowAction.REACTIVATED, {
          level: ApprovalLevel.LEAGUE_COMMITTEE,
          description: '指导老师已通过，进入团委审批阶段',
        });
      }
    }

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
      relations: ['approvals', 'club']
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

      await this.addFlowRecord(activityId, ApprovalFlowAction.COMPLETED, {
        description: '审批流程结束：活动被拒绝',
      });
      return;
    }

    const allApproved = approvals.every(a => a.status === ApprovalStatus.APPROVED);
    if (allApproved) {
      activity.status = ActivityStatus.APPROVED;
      activity.approvedAt = new Date();
      await this.activityRepository.save(activity);

      await this.addFlowRecord(activityId, ApprovalFlowAction.COMPLETED, {
        description: '审批流程结束：活动已通过全部审批',
      });

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
  }

  async checkApprovalTimeouts(): Promise<{ reminded: number; escalated: number; total: number; }> {
    const now = new Date();
    const timeoutDate = new Date(now.getTime() - APPROVAL_TIMEOUT_HOURS * 60 * 60 * 1000);

    const pendingApprovals = await this.approvalRepository.find({
      where: {
        status: In([ApprovalStatus.PENDING, ApprovalStatus.ESCALATED] as ApprovalStatus[]) as unknown as ApprovalStatus,
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

      if (approval.level === ApprovalLevel.ADVISOR && approval.reminderCount >= 2) {
        approval.status = ApprovalStatus.ESCALATED;
        approval.escalated = true;
        approval.escalatedAt = now;
        await this.approvalRepository.save(approval);
        escalated++;

        if (activity.club.advisorId) {
          await notificationService.createNotification(
            activity.club.advisorId,
            NotificationType.APPROVAL_REMINDER,
            '审批超时已升级',
            `活动 "${activity.title}" 的${levelText}审批已超时 ${APPROVAL_TIMEOUT_HOURS * approval.reminderCount} 小时，已自动升级至团委审批`,
            activity.id,
            'activity'
          );
        }

        const leagueApproval = await this.approvalRepository.findOne({
          where: {
            activityId: activity.id,
            level: ApprovalLevel.LEAGUE_COMMITTEE,
          }
        });
        if (leagueApproval && (leagueApproval.status === ApprovalStatus.QUEUED || leagueApproval.status === ApprovalStatus.PENDING)) {
          leagueApproval.status = ApprovalStatus.PENDING;
          leagueApproval.escalated = true;
          leagueApproval.escalatedAt = now;
          await this.approvalRepository.save(leagueApproval);

          const committeeUsers = await this.userRepository.find({
            where: { role: In([UserRole.LEAGUE_COMMITTEE, UserRole.ADMIN] as UserRole[]) as unknown as UserRole }
          } as unknown as Record<string, unknown>);
          for (const cu of committeeUsers) {
            await notificationService.createNotification(
              cu.id,
              NotificationType.APPROVAL_REMINDER,
              '审批超时升级通知',
              `活动 "${activity.title}" 的指导老师审批已超时，已升级至团委处理，请及时审批`,
              activity.id,
              'activity'
            );
          }
        }

        await this.addFlowRecord(activity.id, ApprovalFlowAction.ESCALATED, {
          level: ApprovalLevel.ADVISOR,
          description: `指导老师审批超时 ${APPROVAL_TIMEOUT_HOURS * approval.reminderCount} 小时，已升级至团委`,
        });

        await notificationService.createNotification(
          activity.club.leaderId,
          NotificationType.APPROVAL_REMINDER,
          '审批进度提醒',
          `活动 "${activity.title}" 的指导老师审批已超时，已自动升级至团委处理`,
          activity.id,
          'activity'
        );
      } else if (approval.level === ApprovalLevel.LEAGUE_COMMITTEE && approval.reminderCount >= 2) {
        approval.status = ApprovalStatus.ESCALATED;
        approval.escalated = true;
        approval.escalatedAt = now;
        await this.approvalRepository.save(approval);
        escalated++;

        const adminUsers = await this.userRepository.find({
          where: { role: UserRole.ADMIN }
        });
        for (const au of adminUsers) {
          await notificationService.createNotification(
            au.id,
            NotificationType.APPROVAL_REMINDER,
            '团委审批超时升级通知',
            `活动 "${activity.title}" 的团委审批已超时 ${APPROVAL_TIMEOUT_HOURS * approval.reminderCount} 小时，请管理员关注`,
            activity.id,
            'activity'
          );
        }

        const committeeUsers = await this.userRepository.find({
          where: { role: UserRole.LEAGUE_COMMITTEE }
        });
        for (const cu of committeeUsers) {
          await notificationService.createNotification(
            cu.id,
            NotificationType.APPROVAL_REMINDER,
            '审批催办通知',
            `活动 "${activity.title}" 的团委审批已待处理 ${APPROVAL_TIMEOUT_HOURS * approval.reminderCount} 小时，请及时处理（第 ${approval.reminderCount} 次提醒）`,
            activity.id,
            'activity'
          );
        }

        await this.addFlowRecord(activity.id, ApprovalFlowAction.ESCALATED, {
          level: ApprovalLevel.LEAGUE_COMMITTEE,
          description: `团委审批超时 ${APPROVAL_TIMEOUT_HOURS * approval.reminderCount} 小时，已通知管理员`,
        });

        await notificationService.createNotification(
          activity.club.leaderId,
          NotificationType.APPROVAL_REMINDER,
          '审批进度提醒',
          `活动 "${activity.title}" 的团委审批已超时，已通知管理员跟进`,
          activity.id,
          'activity'
        );
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
        } else if (approval.level === ApprovalLevel.LEAGUE_COMMITTEE) {
          const committeeUsers = await this.userRepository.find({
            where: { role: UserRole.LEAGUE_COMMITTEE }
          });
          for (const cu of committeeUsers) {
            await notificationService.createNotification(
              cu.id,
              NotificationType.APPROVAL_REMINDER,
              '审批催办通知',
              `活动 "${activity.title}" 的团委审批已待处理 ${APPROVAL_TIMEOUT_HOURS} 小时，请及时处理（第 ${approval.reminderCount} 次提醒）`,
              activity.id,
              'activity'
            );
          }
        }

        if (approval.level === ApprovalLevel.LEAGUE_COMMITTEE) {
          const adminUsers = await this.userRepository.find({
            where: { role: UserRole.ADMIN }
          });
          for (const au of adminUsers) {
            await notificationService.createNotification(
              au.id,
              NotificationType.APPROVAL_REMINDER,
              '团委审批催办提醒',
              `活动 "${activity.title}" 的团委审批已待处理 ${APPROVAL_TIMEOUT_HOURS} 小时，请关注`,
              activity.id,
              'activity'
            );
          }
        }

        await notificationService.createNotification(
          activity.club.leaderId,
          NotificationType.APPROVAL_REMINDER,
          '审批进度提醒',
          `活动 "${activity.title}" 的${levelText}审批正在处理中，已发送催办通知`,
          activity.id,
          'activity'
        );

        await this.addFlowRecord(activity.id, ApprovalFlowAction.REMINDER, {
          level: approval.level,
          description: `第 ${approval.reminderCount} 次催办：${levelText}审批已待处理 ${APPROVAL_TIMEOUT_HOURS} 小时`,
        });
      }
    }

    return { reminded, escalated, total: reminded + escalated };
  }

  async getActivityById(activityId: string): Promise<Activity | null> {
    return this.activityRepository.findOne({
      where: { id: activityId },
      relations: ['club', 'approvals', 'bookings', 'attendances']
    });
  }

  async getApprovalFlow(activityId: string): Promise<{ nodes: ApprovalFlowNode[]; total: number; }> {
    const flowRecords = await this.flowRepository.find({
      where: { activityId },
      order: { createdAt: 'ASC' }
    });

    const activity = await this.activityRepository.findOne({
      where: { id: activityId },
      relations: ['approvals']
    });

    const currentLevel = activity ? this.getCurrentApprovalLevel(activity.approvals) : null;
    const isCompleted = activity && (activity.status === ActivityStatus.APPROVED || activity.status === ActivityStatus.REJECTED);

    const actionTextMap: Record<ApprovalFlowAction, string> = {
      [ApprovalFlowAction.SUBMITTED]: '提交审批',
      [ApprovalFlowAction.APPROVED]: '通过',
      [ApprovalFlowAction.REJECTED]: '拒绝',
      [ApprovalFlowAction.REMINDER]: '催办',
      [ApprovalFlowAction.ESCALATED]: '升级',
      [ApprovalFlowAction.COMPLETED]: '审批完成',
      [ApprovalFlowAction.REACTIVATED]: '进入下一阶段',
    };

    const iconMap: Record<ApprovalFlowAction, string> = {
      [ApprovalFlowAction.SUBMITTED]: '📝',
      [ApprovalFlowAction.APPROVED]: '✅',
      [ApprovalFlowAction.REJECTED]: '❌',
      [ApprovalFlowAction.REMINDER]: '⏰',
      [ApprovalFlowAction.ESCALATED]: '⬆️',
      [ApprovalFlowAction.COMPLETED]: '🏁',
      [ApprovalFlowAction.REACTIVATED]: '➡️',
    };

    const levelTextMap: Record<ApprovalLevel, string> = {
      [ApprovalLevel.ADVISOR]: '指导老师',
      [ApprovalLevel.LEAGUE_COMMITTEE]: '团委',
    };

    const nodes: ApprovalFlowNode[] = flowRecords.map((record, index) => {
      let displayStatus = FlowNodeStatus.COMPLETED;
      
      if (!isCompleted && index === flowRecords.length - 1) {
        if (record.action === ApprovalFlowAction.SUBMITTED || 
            record.action === ApprovalFlowAction.REACTIVATED ||
            record.action === ApprovalFlowAction.REMINDER ||
            record.action === ApprovalFlowAction.ESCALATED) {
          displayStatus = FlowNodeStatus.CURRENT;
        }
      }

      return {
        id: record.id,
        action: record.action,
        level: record.level,
        levelText: record.level ? levelTextMap[record.level] : null,
        actionText: actionTextMap[record.action],
        displayStatus,
        actorId: record.actorId,
        actorName: record.actorName,
        comment: record.comment,
        description: record.description,
        createdAt: record.createdAt,
        timeText: this.formatDateTime(record.createdAt),
        icon: iconMap[record.action],
      };
    });

    if (activity && !isCompleted) {
      const advisorApproval = activity.approvals.find(a => a.level === ApprovalLevel.ADVISOR);
      const leagueApproval = activity.approvals.find(a => a.level === ApprovalLevel.LEAGUE_COMMITTEE);

      if (leagueApproval && leagueApproval.status === ApprovalStatus.QUEUED) {
        nodes.push({
          id: `pending-league-${activityId}`,
          action: ApprovalFlowAction.REACTIVATED,
          level: ApprovalLevel.LEAGUE_COMMITTEE,
          levelText: '团委',
          actionText: '待团委审批',
          displayStatus: FlowNodeStatus.PENDING,
          actorId: null,
          actorName: null,
          comment: null,
          description: '等待前级审批完成',
          createdAt: new Date(),
          timeText: '待定',
          icon: '⏳',
        });
      }
    }

    return { nodes, total: nodes.length };
  }

  private formatDateTime(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  getCurrentApprovalLevel(approvals: ActivityApproval[]): ApprovalLevel | null {
    const advisor = approvals.find(a => a.level === ApprovalLevel.ADVISOR);
    const league = approvals.find(a => a.level === ApprovalLevel.LEAGUE_COMMITTEE);

    if (advisor && advisor.status === ApprovalStatus.PENDING) {
      return ApprovalLevel.ADVISOR;
    }
    if (league && (league.status === ApprovalStatus.PENDING || league.status === ApprovalStatus.ESCALATED)) {
      return ApprovalLevel.LEAGUE_COMMITTEE;
    }
    return null;
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
  ): Promise<{ items: ActivityApproval[]; total: number; currentLevel: ApprovalLevel | null }> {
    const where: Record<string, unknown> = {};
    if (activityId) where.activityId = activityId;
    if (level) where.level = level;
    if (status) where.status = status;

    const [items, total] = await this.approvalRepository.findAndCount({
      where,
      relations: ['activity', 'approver'],
      order: { createdAt: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize
    });

    let currentLevel: ApprovalLevel | null = null;
    if (activityId) {
      const allApprovals = await this.approvalRepository.find({ where: { activityId } });
      currentLevel = this.getCurrentApprovalLevel(allApprovals);
    }

    return { items, total, currentLevel };
  }

  async getApprovalDashboard(
    userId: string,
    userRole: UserRole
  ): Promise<{
    stats: ApprovalDashboardStats;
    pendingAdvisor: ApprovalDashboardItem[];
    pendingLeague: ApprovalDashboardItem[];
    timeout: ApprovalDashboardItem[];
    completed: ApprovalDashboardItem[];
  }> {
    const now = new Date();
    const timeoutDate = new Date(now.getTime() - APPROVAL_TIMEOUT_HOURS * 60 * 60 * 1000);

    const activityQuery = this.activityRepository.createQueryBuilder('activity')
      .leftJoinAndSelect('activity.club', 'club')
      .leftJoinAndSelect('activity.approvals', 'approval')
      .where('activity.status IN (:...statuses)', { statuses: [ActivityStatus.PENDING_APPROVAL, ActivityStatus.APPROVED, ActivityStatus.REJECTED] });

    if (userRole === UserRole.CLUB_LEADER) {
      activityQuery.andWhere('club.leaderId = :userId', { userId });
    } else if (userRole === UserRole.ADVISOR) {
      activityQuery.andWhere('club.advisorId = :userId', { userId });
    }

    const activities = await activityQuery
      .orderBy('activity.createdAt', 'DESC')
      .getMany();

    const statusTextMap: Record<ApprovalStatus, string> = {
      [ApprovalStatus.PENDING]: '待处理',
      [ApprovalStatus.APPROVED]: '已通过',
      [ApprovalStatus.REJECTED]: '已拒绝',
      [ApprovalStatus.ESCALATED]: '已升级',
      [ApprovalStatus.TIMEOUT]: '已超时',
      [ApprovalStatus.QUEUED]: '排队中',
    };

    const levelTextMap: Record<ApprovalLevel, string> = {
      [ApprovalLevel.ADVISOR]: '指导老师',
      [ApprovalLevel.LEAGUE_COMMITTEE]: '团委',
    };

    const buildItem = (activity: Activity): ApprovalDashboardItem => {
      const currentLevel = this.getCurrentApprovalLevel(activity.approvals);
      const oldestPendingApproval = activity.approvals
        .filter(a => a.status === ApprovalStatus.PENDING || a.status === ApprovalStatus.ESCALATED)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

      const isTimeout = oldestPendingApproval ? 
        (oldestPendingApproval.lastReminderAt || oldestPendingApproval.createdAt) <= timeoutDate : false;

      const relevantApproval = activity.approvals.find(a => currentLevel ? 
        (a.level === currentLevel && (a.status === ApprovalStatus.PENDING || a.status === ApprovalStatus.ESCALATED)) :
        (a.status === ApprovalStatus.APPROVED || a.status === ApprovalStatus.REJECTED)
      ) || activity.approvals[0];

      return {
        id: activity.id,
        activityTitle: activity.title,
        clubName: activity.club?.name || '未知社团',
        currentLevel,
        currentLevelText: currentLevel ? levelTextMap[currentLevel] : null,
        status: relevantApproval?.status || ApprovalStatus.PENDING,
        statusText: relevantApproval ? statusTextMap[relevantApproval.status] : '待处理',
        isTimeout,
        createdAt: activity.createdAt,
        reminderCount: oldestPendingApproval?.reminderCount || 0,
      };
    };

    const items = activities.map(buildItem);

    const pendingAdvisor = items.filter(item => 
      item.currentLevel === ApprovalLevel.ADVISOR && 
      (item.status === ApprovalStatus.PENDING || item.status === ApprovalStatus.ESCALATED)
    );

    const pendingLeague = items.filter(item => 
      item.currentLevel === ApprovalLevel.LEAGUE_COMMITTEE && 
      (item.status === ApprovalStatus.PENDING || item.status === ApprovalStatus.ESCALATED)
    );

    const timeout = items.filter(item => 
      item.isTimeout && 
      (item.status === ApprovalStatus.PENDING || item.status === ApprovalStatus.ESCALATED)
    );

    const completed = items.filter(item => 
      item.status === ApprovalStatus.APPROVED || item.status === ApprovalStatus.REJECTED
    );

    const stats: ApprovalDashboardStats = {
      pendingAdvisor: pendingAdvisor.length,
      pendingLeague: pendingLeague.length,
      timeout: timeout.length,
      completed: completed.length,
      total: items.length,
    };

    return { stats, pendingAdvisor, pendingLeague, timeout, completed };
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
