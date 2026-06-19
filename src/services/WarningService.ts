import { Repository, Between, In } from 'typeorm';
import { Club, ActivityWarning, Activity } from '../entities';
import { WarningLevel, NotificationType, ClubStatus, ActivityStatus } from '../types';
import { AppDataSource } from '../config/database';
import { notificationService } from './NotificationService';

const MIN_ACTIVITY_THRESHOLD = 2;
const WARNING_THRESHOLD_MONTHS = 2;

class WarningService {
  private clubRepository: Repository<Club>;
  private warningRepository: Repository<ActivityWarning>;
  private activityRepository: Repository<Activity>;

  constructor() {
    this.clubRepository = AppDataSource.getRepository(Club);
    this.warningRepository = AppDataSource.getRepository(ActivityWarning);
    this.activityRepository = AppDataSource.getRepository(Activity);
  }

  async getMonthlyActivityCount(clubId: string, monthsAgo: number): Promise<number> {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() - monthsAgo + 1, 0, 23, 59, 59);

    const count = await this.activityRepository.count({
      where: {
        clubId,
        status: In([ActivityStatus.APPROVED, ActivityStatus.COMPLETED] as ActivityStatus[]) as unknown as ActivityStatus,
        startTime: Between(startDate, endDate) as unknown as Date
      } as unknown as Record<string, unknown>
    });

    return count;
  }

  async getRecentActivityCounts(clubId: string, months: number): Promise<number[]> {
    const counts: number[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const count = await this.getMonthlyActivityCount(clubId, i);
      counts.push(count);
    }
    return counts;
  }

  async checkClubActivityWarning(clubId: string): Promise<ActivityWarning | null> {
    const club = await this.clubRepository.findOne({ where: { id: clubId } });
    if (!club || club.status !== ClubStatus.APPROVED) {
      return null;
    }

    const activityCounts = await this.getRecentActivityCounts(clubId, WARNING_THRESHOLD_MONTHS);
    const consecutiveLowMonths = activityCounts.filter(c => c < MIN_ACTIVITY_THRESHOLD).length;

    const avgActivity = activityCounts.reduce((sum, c) => sum + c, 0) / activityCounts.length;
    const activityRate = avgActivity / MIN_ACTIVITY_THRESHOLD;

    if (consecutiveLowMonths >= WARNING_THRESHOLD_MONTHS) {
      const existingWarning = await this.warningRepository.findOne({
        where: {
          clubId,
          acknowledged: false
        },
        order: { createdAt: 'DESC' }
      });

      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      if (existingWarning && existingWarning.createdAt > oneWeekAgo) {
        return null;
      }

      let level = WarningLevel.WARNING;
      if (activityRate < 0.25) {
        level = WarningLevel.CRITICAL;
      } else if (activityRate < 0.5) {
        level = WarningLevel.WARNING;
      } else {
        level = WarningLevel.ATTENTION;
      }

      const suggestions = this.generateSuggestions(activityCounts, level);

      const warning = this.warningRepository.create({
        clubId,
        club,
        level,
        title: this.generateTitle(level),
        message: this.generateMessage(club.name, activityCounts, level),
        suggestions,
        monthlyActivityCounts: activityCounts,
        activityRate: Math.round(activityRate * 100) / 100
      });

      const savedWarning = await this.warningRepository.save(warning);

      await notificationService.createNotification(
        club.leaderId,
        NotificationType.ACTIVITY_WARNING,
        savedWarning.title,
        `${savedWarning.message} 建议：${suggestions}`,
        savedWarning.id,
        'warning'
      );

      await notificationService.notifyLeadersAndCommittee(
        NotificationType.ACTIVITY_WARNING,
        '社团活跃度预警',
        `社团 "${club.name}" 连续 ${WARNING_THRESHOLD_MONTHS} 个月活跃度低于阈值，请关注`,
        club.leaderId,
        savedWarning.id,
        'warning'
      );

      notificationService.broadcastStatusUpdate(
        [club.leaderId],
        'club_warning',
        { clubId, warningId: savedWarning.id, level }
      );

      return savedWarning;
    }

    return null;
  }

  private generateTitle(level: WarningLevel): string {
    switch (level) {
      case WarningLevel.CRITICAL:
        return '严重：社团活跃度严重不足';
      case WarningLevel.WARNING:
        return '警告：社团活跃度偏低';
      case WarningLevel.ATTENTION:
        return '注意：社团活跃度需关注';
      default:
        return '社团活跃度提醒';
    }
  }

  private generateMessage(clubName: string, activityCounts: number[], level: WarningLevel): string {
    const monthsText = activityCounts.map((c, i) => {
      const month = new Date();
      month.setMonth(month.getMonth() - (activityCounts.length - 1 - i));
      return `${month.getMonth() + 1}月${c}次`;
    }).join('、');

    const avg = activityCounts.reduce((sum, c) => sum + c, 0) / activityCounts.length;

    return `社团 "${clubName}" 近 ${activityCounts.length} 个月活动次数分别为：${monthsText}，平均每月 ${avg.toFixed(1)} 次，低于最低要求的每月 ${MIN_ACTIVITY_THRESHOLD} 次。`;
  }

  private generateSuggestions(activityCounts: number[], level: WarningLevel): string {
    const suggestions: string[] = [];

    suggestions.push('建议立即策划1-2次主题活动，提升社团活跃度');
    suggestions.push('可以组织内部交流会，增强成员凝聚力');
    suggestions.push('与其他社团合作举办联合活动，扩大影响力');

    if (level === WarningLevel.CRITICAL) {
      suggestions.push('请社长高度重视，制定详细的活动计划并提交团委审核');
      suggestions.push('建议召开全体成员大会，共同讨论社团发展方向');
    } else if (level === WarningLevel.WARNING) {
      suggestions.push('请社长尽快制定活动计划，确保下月活动次数达标');
    }

    return suggestions.join('；');
  }

  async checkAllClubsActivity(): Promise<ActivityWarning[]> {
    const clubs = await this.clubRepository.find({
      where: { status: ClubStatus.APPROVED }
    });

    const warnings: ActivityWarning[] = [];

    for (const club of clubs) {
      const warning = await this.checkClubActivityWarning(club.id);
      if (warning) {
        warnings.push(warning);
      }
    }

    return warnings;
  }

  async acknowledgeWarning(warningId: string, acknowledgedBy: string): Promise<ActivityWarning | null> {
    const warning = await this.warningRepository.findOne({ where: { id: warningId }, relations: ['club'] });
    if (!warning) {
      return null;
    }

    if (warning.acknowledged) {
      throw new Error('该预警已确认');
    }

    warning.acknowledged = true;
    warning.acknowledgedAt = new Date();
    warning.acknowledgedBy = acknowledgedBy;

    const saved = await this.warningRepository.save(warning);

    await notificationService.notifyLeadersAndCommittee(
      NotificationType.ACTIVITY_WARNING,
      '预警已确认',
      `社团 "${saved.club.name}" 的活跃度预警已由相关负责人确认`,
      saved.club.leaderId,
      saved.id,
      'warning'
    );

    return saved;
  }

  async getClubWarnings(clubId: string, page = 1, pageSize = 20): Promise<{ items: ActivityWarning[]; total: number }> {
    const [items, total] = await this.warningRepository.findAndCount({
      where: { clubId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize
    });

    return { items, total };
  }

  async getAllWarnings(level?: WarningLevel, acknowledged?: boolean, page = 1, pageSize = 20): Promise<{ items: ActivityWarning[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (level) where.level = level;
    if (acknowledged !== undefined) where.acknowledged = acknowledged;

    const [items, total] = await this.warningRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize
    });

    return { items, total };
  }

  async getWarningById(warningId: string): Promise<ActivityWarning | null> {
    return this.warningRepository.findOne({
      where: { id: warningId },
      relations: ['club']
    });
  }

  async getClubActivityStats(clubId: string, months = 6): Promise<{
    monthlyCounts: number[];
    average: number;
    trend: 'up' | 'down' | 'stable';
    meetsThreshold: boolean;
  }> {
    const monthlyCounts = await this.getRecentActivityCounts(clubId, months);
    const average = monthlyCounts.reduce((sum, c) => sum + c, 0) / months;
    const meetsThreshold = average >= MIN_ACTIVITY_THRESHOLD;

    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (months >= 2) {
      const firstHalf = monthlyCounts.slice(0, Math.floor(months / 2)).reduce((sum, c) => sum + c, 0);
      const secondHalf = monthlyCounts.slice(Math.floor(months / 2)).reduce((sum, c) => sum + c, 0);
      if (secondHalf > firstHalf * 1.2) {
        trend = 'up';
      } else if (secondHalf < firstHalf * 0.8) {
        trend = 'down';
      }
    }

    return {
      monthlyCounts,
      average: Math.round(average * 100) / 100,
      trend,
      meetsThreshold
    };
  }
}

export const warningService = new WarningService();
