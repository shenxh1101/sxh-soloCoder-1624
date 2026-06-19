import { Repository, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Reimbursement, ReimbursementItem, AbnormalOrder, Activity, User, Club } from '../entities';
import { ReimbursementStatus, NotificationType, UserRole } from '../types';
import { AppDataSource } from '../config/database';
import { notificationService } from './NotificationService';

const DEVIATION_THRESHOLD = 10;

interface ReimbursementItemData {
  itemName: string;
  category: string;
  quantity: number;
  unitPrice: number;
  remark?: string;
  invoiceNo?: string;
}

interface CreateReimbursementRequest {
  activityId: string;
  description?: string;
  items: ReimbursementItemData[];
}

class ReimbursementService {
  private reimbursementRepository: Repository<Reimbursement>;
  private itemRepository: Repository<ReimbursementItem>;
  private abnormalOrderRepository: Repository<AbnormalOrder>;
  private activityRepository: Repository<Activity>;
  private userRepository: Repository<User>;
  private clubRepository: Repository<Club>;

  constructor() {
    this.reimbursementRepository = AppDataSource.getRepository(Reimbursement);
    this.itemRepository = AppDataSource.getRepository(ReimbursementItem);
    this.abnormalOrderRepository = AppDataSource.getRepository(AbnormalOrder);
    this.activityRepository = AppDataSource.getRepository(Activity);
    this.userRepository = AppDataSource.getRepository(User);
    this.clubRepository = AppDataSource.getRepository(Club);
  }

  generateApplicationNo(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = uuidv4().slice(0, 8).toUpperCase();
    return `BX${year}${month}${day}${random}`;
  }

  generateOrderNo(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const random = uuidv4().slice(0, 6).toUpperCase();
    return `YC${year}${month}${random}`;
  }

  async createReimbursement(data: CreateReimbursementRequest): Promise<{
    reimbursement: Reimbursement;
    isAbnormal: boolean;
    deviationRate: number;
    abnormalOrder?: AbnormalOrder;
  }> {
    const activity = await this.activityRepository.findOne({
      where: { id: data.activityId },
      relations: ['club']
    });
    if (!activity) {
      throw new Error('活动不存在');
    }

    const club = await this.clubRepository.findOne({ where: { id: activity.clubId } });
    if (!club) {
      throw new Error('社团不存在');
    }

    const existingReimbursement = await this.reimbursementRepository.findOne({
      where: { activityId: data.activityId, status: In([ReimbursementStatus.PENDING, ReimbursementStatus.APPROVED, ReimbursementStatus.PAID] as ReimbursementStatus[]) as unknown as ReimbursementStatus }
    } as unknown as Record<string, unknown>);
    if (existingReimbursement) {
      throw new Error('该活动已有报销申请在处理中');
    }

    const requestedAmount = data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const budgetAmount = activity.budget;

    let deviationRate = 0;
    if (budgetAmount > 0) {
      deviationRate = Math.abs((requestedAmount - budgetAmount) / budgetAmount * 100);
      deviationRate = Math.round(deviationRate * 100) / 100;
    }

    const isAbnormal = deviationRate > DEVIATION_THRESHOLD;

    const applicationNo = this.generateApplicationNo();

    const reimbursement = this.reimbursementRepository.create({
      applicationNo,
      activityId: data.activityId,
      activity,
      clubId: activity.clubId,
      club,
      budgetAmount,
      requestedAmount,
      deviationRate,
      description: data.description || null,
      status: isAbnormal ? ReimbursementStatus.ABNORMAL : ReimbursementStatus.PENDING
    });

    const savedReimbursement = await this.reimbursementRepository.save(reimbursement);

    const items: ReimbursementItem[] = [];
    for (const itemData of data.items) {
      const item = this.itemRepository.create({
        reimbursementId: savedReimbursement.id,
        reimbursement: savedReimbursement,
        itemName: itemData.itemName,
        category: itemData.category,
        quantity: itemData.quantity,
        unitPrice: itemData.unitPrice,
        subtotal: itemData.quantity * itemData.unitPrice,
        remark: itemData.remark || null,
        invoiceNo: itemData.invoiceNo || null
      });
      items.push(await this.itemRepository.save(item));
    }
    savedReimbursement.items = items;

    let abnormalOrder: AbnormalOrder | undefined;
    if (isAbnormal) {
      abnormalOrder = await this.createAbnormalOrder(savedReimbursement, deviationRate);
    }

    await notificationService.createNotification(
      activity.club.leaderId,
      NotificationType.REIMBURSEMENT,
      '报销申请已提交',
      `活动 "${activity.title}" 的报销申请已提交，申请金额 ${requestedAmount} 元，预算 ${budgetAmount} 元，偏差率 ${deviationRate}%${isAbnormal ? '，因偏差超过10%已生成异常工单' : ''}`,
      savedReimbursement.id,
      'reimbursement'
    );

    if (isAbnormal) {
      const financeUsers = await this.userRepository.find({
        where: { role: In([UserRole.FINANCE, UserRole.ADMIN] as UserRole[]) as unknown as UserRole }
      } as unknown as Record<string, unknown>);

      for (const financeUser of financeUsers) {
        await notificationService.createNotification(
          financeUser.id,
          NotificationType.REIMBURSEMENT,
          '报销异常待复核',
          `活动 "${activity.title}" 的报销申请偏差率 ${deviationRate}%，超过 ${DEVIATION_THRESHOLD}% 阈值，请及时复核`,
          abnormalOrder!.id,
          'abnormal_order'
        );
      }
    } else {
      await notificationService.notifyLeadersAndCommittee(
        NotificationType.REIMBURSEMENT,
        '报销申请待审批',
        `活动 "${activity.title}" 的报销申请已提交，金额 ${requestedAmount} 元，请及时审批`,
        activity.club.leaderId,
        savedReimbursement.id,
        'reimbursement'
      );
    }

    notificationService.broadcastStatusUpdate(
      [activity.club.leaderId],
      'reimbursement',
      { reimbursementId: savedReimbursement.id, status: savedReimbursement.status, deviationRate }
    );

    return { reimbursement: savedReimbursement, isAbnormal, deviationRate, abnormalOrder };
  }

  private async createAbnormalOrder(reimbursement: Reimbursement, deviationRate: number): Promise<AbnormalOrder> {
    const financeUsers = await this.userRepository.find({
      where: { role: In([UserRole.FINANCE, UserRole.ADMIN] as UserRole[]) as unknown as UserRole }
    } as unknown as Record<string, unknown>);

    const assignee = financeUsers.length > 0 ? financeUsers[0] : null;
    const deviationAmount = Math.abs(reimbursement.requestedAmount - reimbursement.budgetAmount);

    const order = this.abnormalOrderRepository.create({
      orderNo: this.generateOrderNo(),
      reimbursementId: reimbursement.id,
      reimbursement,
      type: 'budget_deviation',
      description: `报销金额与预算偏差超过${DEVIATION_THRESHOLD}%，预算${reimbursement.budgetAmount}元，申请${reimbursement.requestedAmount}元`,
      deviationRate,
      deviationAmount,
      assigneeId: assignee?.id || null,
      assignee,
      status: 'pending'
    });

    const savedOrder = await this.abnormalOrderRepository.save(order);

    notificationService.broadcastStatusUpdate(
      assignee ? [assignee.id] : [],
      'abnormal_order',
      { orderId: savedOrder.id, status: 'pending', deviationRate }
    );

    return savedOrder;
  }

  async processAbnormalOrder(
    orderId: string,
    resolvedBy: string,
    resolution: string,
    approve: boolean
  ): Promise<AbnormalOrder | null> {
    const order = await this.abnormalOrderRepository.findOne({
      where: { id: orderId },
      relations: ['reimbursement', 'reimbursement.activity', 'reimbursement.club']
    });
    if (!order) {
      return null;
    }

    if (order.status !== 'pending') {
      throw new Error('该异常工单已处理');
    }

    order.status = approve ? 'resolved' : 'rejected';
    order.resolution = resolution;
    order.resolvedAt = new Date();
    order.resolvedBy = resolvedBy;

    const savedOrder = await this.abnormalOrderRepository.save(order);

    if (approve) {
      order.reimbursement.status = ReimbursementStatus.PENDING;
      await this.reimbursementRepository.save(order.reimbursement);

      await notificationService.notifyLeadersAndCommittee(
        NotificationType.REIMBURSEMENT,
        '异常报销已通过复核',
        `活动 "${order.reimbursement.activity.title}" 的异常报销已通过财务复核，进入正常审批流程`,
        order.reimbursement.club.leaderId,
        order.reimbursement.id,
        'reimbursement'
      );
    } else {
      order.reimbursement.status = ReimbursementStatus.REJECTED;
      order.reimbursement.rejectReason = `财务复核未通过：${resolution}`;
      await this.reimbursementRepository.save(order.reimbursement);

      await notificationService.createNotification(
        order.reimbursement.club.leaderId,
        NotificationType.REIMBURSEMENT,
        '报销申请被拒绝',
        `活动 "${order.reimbursement.activity.title}" 的报销申请未通过财务复核，原因：${resolution}`,
        order.reimbursement.id,
        'reimbursement'
      );
    }

    notificationService.broadcastStatusUpdate(
      [order.reimbursement.club.leaderId],
      'abnormal_order',
      { orderId: savedOrder.id, status: savedOrder.status }
    );

    return savedOrder;
  }

  async approveReimbursement(reimbursementId: string, approvedBy: string, approvedAmount?: number): Promise<Reimbursement | null> {
    const reimbursement = await this.reimbursementRepository.findOne({
      where: { id: reimbursementId },
      relations: ['activity', 'club']
    });
    if (!reimbursement) {
      return null;
    }

    if (reimbursement.status !== ReimbursementStatus.PENDING) {
      throw new Error('该报销状态不允许审批');
    }

    reimbursement.status = ReimbursementStatus.APPROVED;
    reimbursement.approvedAmount = approvedAmount ?? reimbursement.requestedAmount;
    reimbursement.approvedAt = new Date();
    reimbursement.approvedBy = approvedBy;

    const saved = await this.reimbursementRepository.save(reimbursement);

    await notificationService.createNotification(
      reimbursement.club.leaderId,
      NotificationType.REIMBURSEMENT,
      '报销已批准',
      `活动 "${reimbursement.activity.title}" 的报销申请已批准，批准金额 ${saved.approvedAmount} 元`,
      saved.id,
      'reimbursement'
    );

    notificationService.broadcastStatusUpdate(
      [reimbursement.club.leaderId],
      'reimbursement',
      { reimbursementId: saved.id, status: ReimbursementStatus.APPROVED }
    );

    return saved;
  }

  async rejectReimbursement(reimbursementId: string, rejectedBy: string, reason: string): Promise<Reimbursement | null> {
    const reimbursement = await this.reimbursementRepository.findOne({
      where: { id: reimbursementId },
      relations: ['activity', 'club']
    });
    if (!reimbursement) {
      return null;
    }

    if (![ReimbursementStatus.PENDING, ReimbursementStatus.ABNORMAL].includes(reimbursement.status)) {
      throw new Error('该报销状态不允许拒绝');
    }

    reimbursement.status = ReimbursementStatus.REJECTED;
    reimbursement.rejectReason = reason;

    const saved = await this.reimbursementRepository.save(reimbursement);

    await notificationService.createNotification(
      reimbursement.club.leaderId,
      NotificationType.REIMBURSEMENT,
      '报销被拒绝',
      `活动 "${reimbursement.activity.title}" 的报销申请被拒绝，原因：${reason}`,
      saved.id,
      'reimbursement'
    );

    return saved;
  }

  async markAsPaid(reimbursementId: string, paidBy: string): Promise<Reimbursement | null> {
    const reimbursement = await this.reimbursementRepository.findOne({
      where: { id: reimbursementId },
      relations: ['activity', 'club']
    });
    if (!reimbursement) {
      return null;
    }

    if (reimbursement.status !== ReimbursementStatus.APPROVED) {
      throw new Error('该报销状态不允许标记为已付款');
    }

    reimbursement.status = ReimbursementStatus.PAID;

    const saved = await this.reimbursementRepository.save(reimbursement);

    await notificationService.createNotification(
      reimbursement.club.leaderId,
      NotificationType.REIMBURSEMENT,
      '报销已付款',
      `活动 "${reimbursement.activity.title}" 的报销款项 ${saved.approvedAmount} 元已支付`,
      saved.id,
      'reimbursement'
    );

    return saved;
  }

  async getReimbursements(
    clubId?: string,
    activityId?: string,
    status?: ReimbursementStatus,
    page = 1,
    pageSize = 20
  ): Promise<{ items: Reimbursement[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (clubId) where.clubId = clubId;
    if (activityId) where.activityId = activityId;
    if (status) where.status = status;

    const [items, total] = await this.reimbursementRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize
    });

    return { items, total };
  }

  async getReimbursementById(reimbursementId: string): Promise<Reimbursement | null> {
    return this.reimbursementRepository.findOne({
      where: { id: reimbursementId },
      relations: ['activity', 'club', 'items', 'abnormalOrders']
    });
  }

  async getAbnormalOrders(
    status?: string,
    assigneeId?: string,
    page = 1,
    pageSize = 20
  ): Promise<{ items: AbnormalOrder[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (assigneeId) where.assigneeId = assigneeId;

    const [items, total] = await this.abnormalOrderRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize
    });

    return { items, total };
  }

  async getAbnormalOrderById(orderId: string): Promise<AbnormalOrder | null> {
    return this.abnormalOrderRepository.findOne({
      where: { id: orderId },
      relations: ['reimbursement', 'reimbursement.activity', 'reimbursement.club', 'assignee']
    });
  }
}

export const reimbursementService = new ReimbursementService();
