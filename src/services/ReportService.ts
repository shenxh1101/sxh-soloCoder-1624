import { Repository, Between, In, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { DailyReport, Club, Activity, ActivityApproval, Reimbursement, ActivityWarning, VenueBooking } from '../entities';
import { ClubStatus, ActivityStatus, ApprovalStatus, ReimbursementStatus } from '../types';
import { AppDataSource } from '../config/database';
import { notificationService } from './NotificationService';

class ReportService {
  private reportRepository: Repository<DailyReport>;
  private clubRepository: Repository<Club>;
  private activityRepository: Repository<Activity>;
  private approvalRepository: Repository<ActivityApproval>;
  private reimbursementRepository: Repository<Reimbursement>;
  private warningRepository: Repository<ActivityWarning>;
  private bookingRepository: Repository<VenueBooking>;

  constructor() {
    this.reportRepository = AppDataSource.getRepository(DailyReport);
    this.clubRepository = AppDataSource.getRepository(Club);
    this.activityRepository = AppDataSource.getRepository(Activity);
    this.approvalRepository = AppDataSource.getRepository(ActivityApproval);
    this.reimbursementRepository = AppDataSource.getRepository(Reimbursement);
    this.warningRepository = AppDataSource.getRepository(ActivityWarning);
    this.bookingRepository = AppDataSource.getRepository(VenueBooking);
  }

  async generateDailyReport(reportDate?: Date): Promise<DailyReport> {
    const date = reportDate || new Date();
    const dateStr = date.toISOString().split('T')[0];

    const existing = await this.reportRepository.findOne({ where: { reportDate: dateStr } });
    if (existing) {
      return existing;
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const totalClubs = await this.clubRepository.count({ where: { status: In([ClubStatus.APPROVED, ClubStatus.PENDING] as ClubStatus[]) as unknown as ClubStatus } } as unknown as Record<string, unknown>);
    const activeClubs = await this.clubRepository.count({ where: { status: ClubStatus.APPROVED } });
    const newClubs = await this.clubRepository.count({ where: { createdAt: Between(startOfDay, endOfDay) as unknown as Date } } as unknown as Record<string, unknown>);

    const totalActivities = await this.activityRepository.count();
    const todayActivities = await this.activityRepository.count({
      where: { startTime: Between(startOfDay, endOfDay) as unknown as Date }
    } as unknown as Record<string, unknown>);

    const activitiesWithParticipants = await this.activityRepository.find({
      where: { startTime: Between(startOfDay, endOfDay) as unknown as Date }
    } as unknown as Record<string, unknown>);
    const todayParticipants = activitiesWithParticipants.reduce((sum, a) => sum + (a.actualParticipants || 0), 0);

    const allActivities = await this.activityRepository.find();
    const totalParticipants = allActivities.reduce((sum, a) => sum + (a.actualParticipants || 0), 0);
    const totalBudget = allActivities.reduce((sum, a) => sum + (a.budget || 0), 0);
    const totalActualCost = allActivities.reduce((sum, a) => sum + (a.actualCost || 0), 0);

    const budgetUtilizationRate = totalBudget > 0 ? Math.round((totalActualCost / totalBudget) * 10000) / 100 : 0;

    const pendingApprovals = await this.approvalRepository.count({ where: { status: ApprovalStatus.PENDING } });
    const pendingReimbursements = await this.reimbursementRepository.count({
      where: { status: In([ReimbursementStatus.PENDING, ReimbursementStatus.ABNORMAL] as ReimbursementStatus[]) as unknown as ReimbursementStatus }
    } as unknown as Record<string, unknown>);

    const warnings = await this.warningRepository.count({
      where: { createdAt: Between(startOfDay, endOfDay) as unknown as Date }
    } as unknown as Record<string, unknown>);

    const activityByCategory = await this.getActivityByCategory(startOfDay, endOfDay);
    const topClubs = await this.getTopClubs(startOfDay, endOfDay);
    const clubStats = await this.getClubStats(startOfDay, endOfDay);
    const categoryStats = await this.getCategoryStats(startOfDay, endOfDay);

    const summary = this.generateSummary({
      totalClubs,
      activeClubs,
      newClubs,
      todayActivities,
      todayParticipants,
      budgetUtilizationRate,
      pendingApprovals,
      pendingReimbursements,
      warnings
    });

    const report = this.reportRepository.create({
      reportDate: dateStr,
      totalClubs,
      activeClubs,
      totalActivities,
      todayActivities,
      totalParticipants,
      todayParticipants,
      totalBudget,
      totalActualCost,
      budgetUtilizationRate,
      pendingApprovals,
      pendingReimbursements,
      newClubs,
      warnings,
      activityByCategory,
      topClubs,
      clubStats,
      categoryStats,
      summary,
      generatedAt: new Date()
    });

    const savedReport = await this.reportRepository.save(report);

    await notificationService.notifyLeadersAndCommittee(
      'system' as any,
      '运营日报已生成',
      `${dateStr} 运营日报已生成，今日活动 ${todayActivities} 场，参与人数 ${todayParticipants} 人`,
      undefined,
      savedReport.id,
      'report'
    );

    return savedReport;
  }

  private async getActivityByCategory(startDate: Date, endDate: Date): Promise<Record<string, number>> {
    const activities = await this.activityRepository.find({
      where: { startTime: Between(startDate, endDate) as unknown as Date }
    } as unknown as Record<string, unknown>);

    const categoryMap: Record<string, number> = {};
    for (const activity of activities) {
      categoryMap[activity.category] = (categoryMap[activity.category] || 0) + 1;
    }

    return categoryMap;
  }

  private async getTopClubs(startDate: Date, endDate: Date, limit = 5): Promise<Array<{
    clubId: string;
    clubName: string;
    activityCount: number;
    participants: number;
  }>> {
    const activities = await this.activityRepository.find({
      where: { startTime: Between(startDate, endDate) as unknown as Date },
      relations: ['club']
    } as unknown as Record<string, unknown>);

    const clubMap: Record<string, { clubId: string; clubName: string; activityCount: number; participants: number }> = {};

    for (const activity of activities) {
      const clubId = activity.clubId;
      if (!clubMap[clubId]) {
        clubMap[clubId] = {
          clubId,
          clubName: activity.club?.name || '未知社团',
          activityCount: 0,
          participants: 0
        };
      }
      clubMap[clubId].activityCount++;
      clubMap[clubId].participants += activity.actualParticipants || 0;
    }

    return Object.values(clubMap)
      .sort((a, b) => b.activityCount - a.activityCount || b.participants - a.participants)
      .slice(0, limit);
  }

  private async getClubStats(startDate: Date, endDate: Date): Promise<Array<{
    clubId: string;
    clubName: string;
    category: string;
    activityCount: number;
    participants: number;
    budgetUsed: number;
    budgetUtilization: number;
  }>> {
    const clubs = await this.clubRepository.find({ where: { status: ClubStatus.APPROVED } });
    const stats: Array<{
      clubId: string;
      clubName: string;
      category: string;
      activityCount: number;
      participants: number;
      budgetUsed: number;
      budgetUtilization: number;
    }> = [];

    for (const club of clubs) {
      const activities = await this.activityRepository.find({
        where: {
          clubId: club.id,
          startTime: Between(startDate, endDate) as unknown as Date
        }
      } as unknown as Record<string, unknown>);

      const activityCount = activities.length;
      const participants = activities.reduce((sum, a) => sum + (a.actualParticipants || 0), 0);
      const budgetUsed = activities.reduce((sum, a) => sum + (a.actualCost || 0), 0);
      const totalBudget = activities.reduce((sum, a) => sum + (a.budget || 0), 0);
      const budgetUtilization = totalBudget > 0 ? Math.round((budgetUsed / totalBudget) * 10000) / 100 : 0;

      stats.push({
        clubId: club.id,
        clubName: club.name,
        category: club.category,
        activityCount,
        participants,
        budgetUsed,
        budgetUtilization
      });
    }

    return stats.sort((a, b) => b.activityCount - a.activityCount);
  }

  private async getCategoryStats(startDate: Date, endDate: Date): Promise<Array<{
    category: string;
    activityCount: number;
    participants: number;
    budget: number;
    actualCost: number;
  }>> {
    const activities = await this.activityRepository.find({
      where: { startTime: Between(startDate, endDate) as unknown as Date }
    } as unknown as Record<string, unknown>);

    const categoryMap: Record<string, {
      category: string;
      activityCount: number;
      participants: number;
      budget: number;
      actualCost: number;
    }> = {};

    for (const activity of activities) {
      const category = activity.category;
      if (!categoryMap[category]) {
        categoryMap[category] = {
          category,
          activityCount: 0,
          participants: 0,
          budget: 0,
          actualCost: 0
        };
      }
      categoryMap[category].activityCount++;
      categoryMap[category].participants += activity.actualParticipants || 0;
      categoryMap[category].budget += activity.budget || 0;
      categoryMap[category].actualCost += activity.actualCost || 0;
    }

    return Object.values(categoryMap).sort((a, b) => b.activityCount - a.activityCount);
  }

  private generateSummary(data: {
    totalClubs: number;
    activeClubs: number;
    newClubs: number;
    todayActivities: number;
    todayParticipants: number;
    budgetUtilizationRate: number;
    pendingApprovals: number;
    pendingReimbursements: number;
    warnings: number;
  }): string {
    const parts: string[] = [];

    parts.push(`今日新增社团 ${data.newClubs} 个，现有活跃社团 ${data.activeClubs}/${data.totalClubs} 个。`);
    parts.push(`今日举办活动 ${data.todayActivities} 场，参与人数 ${data.todayParticipants} 人。`);
    parts.push(`整体经费使用率 ${data.budgetUtilizationRate}%。`);

    if (data.pendingApprovals > 0) {
      parts.push(`待处理活动审批 ${data.pendingApprovals} 项。`);
    }
    if (data.pendingReimbursements > 0) {
      parts.push(`待处理报销申请 ${data.pendingReimbursements} 项。`);
    }
    if (data.warnings > 0) {
      parts.push(`今日发出活跃度预警 ${data.warnings} 条。`);
    }

    return parts.join(' ');
  }

  async getReports(startDate?: string, endDate?: string, page = 1, pageSize = 20): Promise<{ items: DailyReport[]; total: number }> {
    const where: Record<string, unknown> = {};

    if (startDate && endDate) {
      where.reportDate = Between(startDate, endDate) as unknown as string;
    } else if (startDate) {
      where.reportDate = MoreThanOrEqual(startDate) as unknown as string;
    } else if (endDate) {
      where.reportDate = LessThanOrEqual(endDate) as unknown as string;
    }

    const [items, total] = await this.reportRepository.findAndCount({
      where,
      order: { reportDate: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize
    });

    return { items, total };
  }

  async getReportByDate(date: string): Promise<DailyReport | null> {
    return this.reportRepository.findOne({ where: { reportDate: date } });
  }

  async getReportById(id: string): Promise<DailyReport | null> {
    return this.reportRepository.findOne({ where: { id } });
  }

  async exportToExcel(reportId: string): Promise<Buffer> {
    const report = await this.reportRepository.findOne({ where: { id: reportId } });
    if (!report) {
      throw new Error('报表不存在');
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = '社团管理系统';
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet('运营概览');
    summarySheet.columns = [
      { header: '指标', key: 'metric', width: 30 },
      { header: '数值', key: 'value', width: 30 },
      { header: '说明', key: 'note', width: 50 }
    ];

    summarySheet.addRow({ metric: '报告日期', value: report.reportDate });
    summarySheet.addRow({ metric: '社团总数', value: report.totalClubs });
    summarySheet.addRow({ metric: '活跃社团数', value: report.activeClubs });
    summarySheet.addRow({ metric: '今日新增社团', value: report.newClubs });
    summarySheet.addRow({ metric: '活动总数', value: report.totalActivities });
    summarySheet.addRow({ metric: '今日活动数', value: report.todayActivities });
    summarySheet.addRow({ metric: '累计参与人次', value: report.totalParticipants });
    summarySheet.addRow({ metric: '今日参与人次', value: report.todayParticipants });
    summarySheet.addRow({ metric: '累计预算', value: report.totalBudget });
    summarySheet.addRow({ metric: '累计实际支出', value: report.totalActualCost });
    summarySheet.addRow({ metric: '预算使用率', value: `${report.budgetUtilizationRate}%` });
    summarySheet.addRow({ metric: '待处理审批', value: report.pendingApprovals });
    summarySheet.addRow({ metric: '待处理报销', value: report.pendingReimbursements });
    summarySheet.addRow({ metric: '今日预警数', value: report.warnings });
    summarySheet.addRow({ metric: '摘要', value: report.summary || '' });

    summarySheet.getRow(1).font = { bold: true };
    summarySheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    if (report.clubStats && report.clubStats.length > 0) {
      const clubSheet = workbook.addWorksheet('社团统计');
      clubSheet.columns = [
        { header: '社团名称', key: 'clubName', width: 25 },
        { header: '类别', key: 'category', width: 15 },
        { header: '活动数', key: 'activityCount', width: 10 },
        { header: '参与人次', key: 'participants', width: 12 },
        { header: '实际支出', key: 'budgetUsed', width: 12 },
        { header: '预算使用率(%)', key: 'budgetUtilization', width: 15 }
      ];

      for (const stat of report.clubStats) {
        clubSheet.addRow({
          clubName: stat.clubName,
          category: stat.category,
          activityCount: stat.activityCount,
          participants: stat.participants,
          budgetUsed: stat.budgetUsed,
          budgetUtilization: stat.budgetUtilization
        });
      }

      clubSheet.getRow(1).font = { bold: true };
      clubSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    }

    if (report.categoryStats && report.categoryStats.length > 0) {
      const categorySheet = workbook.addWorksheet('类别统计');
      categorySheet.columns = [
        { header: '活动类别', key: 'category', width: 20 },
        { header: '活动数', key: 'activityCount', width: 12 },
        { header: '参与人次', key: 'participants', width: 12 },
        { header: '预算总额', key: 'budget', width: 12 },
        { header: '实际支出', key: 'actualCost', width: 12 }
      ];

      for (const stat of report.categoryStats) {
        categorySheet.addRow({
          category: stat.category,
          activityCount: stat.activityCount,
          participants: stat.participants,
          budget: stat.budget,
          actualCost: stat.actualCost
        });
      }

      categorySheet.getRow(1).font = { bold: true };
      categorySheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    }

    if (report.topClubs && report.topClubs.length > 0) {
      const topSheet = workbook.addWorksheet('社团排行');
      topSheet.columns = [
        { header: '排名', key: 'rank', width: 8 },
        { header: '社团名称', key: 'clubName', width: 25 },
        { header: '活动数', key: 'activityCount', width: 12 },
        { header: '参与人次', key: 'participants', width: 12 }
      ];

      for (let i = 0; i < report.topClubs.length; i++) {
        const club = report.topClubs[i];
        topSheet.addRow({
          rank: i + 1,
          clubName: club.clubName,
          activityCount: club.activityCount,
          participants: club.participants
        });
      }

      topSheet.getRow(1).font = { bold: true };
      topSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    }

    const buffer = await workbook.xlsx.writeBuffer() as unknown as Buffer;
    return buffer;
  }

  async exportReportsToExcel(startDate?: string, endDate?: string, category?: string): Promise<Buffer> {
    const { items } = await this.getReports(startDate, endDate, 1, 1000);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = '社团管理系统';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('运营日报汇总');
    sheet.columns = [
      { header: '日期', key: 'reportDate', width: 15 },
      { header: '社团总数', key: 'totalClubs', width: 12 },
      { header: '活跃社团', key: 'activeClubs', width: 12 },
      { header: '新增社团', key: 'newClubs', width: 12 },
      { header: '活动总数', key: 'totalActivities', width: 12 },
      { header: '今日活动', key: 'todayActivities', width: 12 },
      { header: '累计参与', key: 'totalParticipants', width: 12 },
      { header: '今日参与', key: 'todayParticipants', width: 12 },
      { header: '预算使用率(%)', key: 'budgetUtilizationRate', width: 15 },
      { header: '待审批', key: 'pendingApprovals', width: 10 },
      { header: '待报销', key: 'pendingReimbursements', width: 10 },
      { header: '预警数', key: 'warnings', width: 10 }
    ];

    for (const report of items) {
      sheet.addRow({
        reportDate: report.reportDate,
        totalClubs: report.totalClubs,
        activeClubs: report.activeClubs,
        newClubs: report.newClubs,
        totalActivities: report.totalActivities,
        todayActivities: report.todayActivities,
        totalParticipants: report.totalParticipants,
        todayParticipants: report.todayParticipants,
        budgetUtilizationRate: report.budgetUtilizationRate,
        pendingApprovals: report.pendingApprovals,
        pendingReimbursements: report.pendingReimbursements,
        warnings: report.warnings
      });
    }

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    const buffer = await workbook.xlsx.writeBuffer() as unknown as Buffer;
    return buffer;
  }
}

export const reportService = new ReportService();
