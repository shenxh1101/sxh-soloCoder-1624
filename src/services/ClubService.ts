import { In, Repository } from 'typeorm';
import { Club, ClubMember, User, ClubPoints } from '../entities';
import { ClubStatus, NotificationType } from '../types';
import { AppDataSource } from '../config/database';
import { notificationService } from './NotificationService';

const MIN_INITIAL_MEMBERS = 5;

interface CreateClubRequest {
  name: string;
  description: string;
  category: string;
  leaderId: string;
  memberIds: string[];
  advisorId?: string;
}

interface ValidateClubResult {
  valid: boolean;
  errors: string[];
}

class ClubService {
  private clubRepository: Repository<Club>;
  private memberRepository: Repository<ClubMember>;
  private userRepository: Repository<User>;
  private pointsRepository: Repository<ClubPoints>;

  constructor() {
    this.clubRepository = AppDataSource.getRepository(Club);
    this.memberRepository = AppDataSource.getRepository(ClubMember);
    this.userRepository = AppDataSource.getRepository(User);
    this.pointsRepository = AppDataSource.getRepository(ClubPoints);
  }

  async validateClubApplication(data: CreateClubRequest): Promise<ValidateClubResult> {
    const errors: string[] = [];

    if (!data.name || !data.name.trim()) {
      errors.push('社团名称不能为空');
    } else {
      const existingClub = await this.clubRepository.findOne({
        where: { name: data.name.trim() } as unknown as Record<string, unknown>
      });
      if (existingClub) {
        errors.push(`社团名称 "${data.name}" 已存在，请使用其他名称`);
      }
    }

    if (!data.description || !data.description.trim()) {
      errors.push('社团描述不能为空');
    }

    if (!data.category || !data.category.trim()) {
      errors.push('社团类别不能为空');
    }

    const allIds = [data.leaderId, ...(data.memberIds || [])];
    const uniqueMemberIds = [...new Set(allIds.filter(Boolean))];

    if (!data.leaderId) {
      errors.push('社长ID不能为空');
    } else if (!uniqueMemberIds.includes(data.leaderId)) {
      uniqueMemberIds.push(data.leaderId);
    }

    if (uniqueMemberIds.length < MIN_INITIAL_MEMBERS) {
      errors.push(`初始成员人数不足，最少需要 ${MIN_INITIAL_MEMBERS} 人（含社长），当前仅 ${uniqueMemberIds.length} 人`);
    }

    if (uniqueMemberIds.length > 0) {
      const validUsers = await this.userRepository.find({
        where: { id: In(uniqueMemberIds) }
      });
      if (validUsers.length !== uniqueMemberIds.length) {
        const foundIds = validUsers.map(u => u.id);
        const invalidIds = uniqueMemberIds.filter(id => !foundIds.includes(id));
        errors.push(`以下用户ID不存在：${invalidIds.join(', ')}`);
      }
    }

    if (data.advisorId) {
      const advisor = await this.userRepository.findOne({
        where: { id: data.advisorId } as unknown as Record<string, unknown>
      });
      if (!advisor) {
        errors.push('指定的指导老师不存在');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async createClubApplication(data: CreateClubRequest): Promise<{ club: Club | null; validation: ValidateClubResult }> {
    const validation = await this.validateClubApplication(data);

    if (!validation.valid) {
      const rejectReason = validation.errors.join('；');

      await notificationService.createNotification(
        data.leaderId,
        NotificationType.CLUB_APPLICATION,
        '社团申请被退回',
        `社团 "${data.name}" 创建申请未通过，原因：${rejectReason}`,
        undefined,
        'club'
      );

      return { club: null, validation };
    }

    const leader = await this.userRepository.findOne({ where: { id: data.leaderId } });
    const advisor = data.advisorId
      ? await this.userRepository.findOne({ where: { id: data.advisorId } })
      : null;

    const club = this.clubRepository.create({
      name: data.name.trim(),
      description: data.description.trim(),
      category: data.category.trim(),
      leaderId: data.leaderId,
      leader: leader!,
      advisorId: data.advisorId || null,
      advisor: advisor || null,
      status: ClubStatus.PENDING
    });

    const savedClub = await this.clubRepository.save(club);

    const allIds = [data.leaderId, ...(data.memberIds || [])];
    const uniqueMemberIds = [...new Set(allIds.filter(Boolean))];

    const members: ClubMember[] = [];

    for (const userId of uniqueMemberIds) {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      const member = this.memberRepository.create({
        clubId: savedClub.id,
        club: savedClub,
        userId,
        user: user!,
        position: userId === data.leaderId ? '社长' : '成员',
        joinedAt: new Date()
      });
      members.push(member);
    }

    await this.memberRepository.save(members);
    savedClub.members = members;

    await notificationService.notifyLeadersAndCommittee(
      NotificationType.CLUB_APPLICATION,
      '新社团申请待审批',
      `社团 "${savedClub.name}" 提交了创建申请，请及时审批`,
      data.leaderId,
      savedClub.id,
      'club'
    );

    return { club: savedClub, validation };
  }

  async approveClub(clubId: string, approverId?: string, reason?: string): Promise<Club | null> {
    const club = await this.clubRepository.findOne({ where: { id: clubId } as unknown as Record<string, unknown> });
    if (!club) {
      return null;
    }

    if (club.status !== ClubStatus.PENDING) {
      throw new Error('该社团申请状态不允许审批');
    }

    club.status = ClubStatus.APPROVED;
    club.approvedAt = new Date();

    const initialPoints = 100;
    club.points = initialPoints;

    const savedClub = await this.clubRepository.save(club);

    const pointsRecord = this.pointsRepository.create({
      clubId: savedClub.id,
      club: savedClub,
      points: initialPoints,
      reason: '社团创建初始积分',
      previousPoints: 0,
      newPoints: initialPoints
    });
    await this.pointsRepository.save(pointsRecord);

    await notificationService.notifyClubMembers(
      savedClub.id,
      NotificationType.CLUB_APPLICATION,
      '社团申请已通过',
      `恭喜！社团 "${savedClub.name}" 创建申请已通过审批，获得初始积分 ${initialPoints} 分`,
      savedClub.id,
      'club'
    );

    notificationService.broadcastStatusUpdate(
      [savedClub.leaderId],
      'club_status',
      { clubId: savedClub.id, status: ClubStatus.APPROVED }
    );

    return savedClub;
  }

  async rejectClub(clubId: string, reason: string): Promise<Club | null> {
    const club = await this.clubRepository.findOne({ where: { id: clubId } });
    if (!club) {
      return null;
    }

    if (club.status !== ClubStatus.PENDING) {
      throw new Error('该社团申请状态不允许审批');
    }

    club.status = ClubStatus.REJECTED;
    club.rejectReason = reason;

    const savedClub = await this.clubRepository.save(club);

    await notificationService.createNotification(
      savedClub.leaderId,
      NotificationType.CLUB_APPLICATION,
      '社团申请被拒绝',
      `您的社团 "${savedClub.name}" 创建申请被拒绝，原因：${reason}`,
      savedClub.id,
      'club'
    );

    return savedClub;
  }

  async getClubById(clubId: string): Promise<Club | null> {
    return this.clubRepository.findOne({
      where: { id: clubId },
      relations: ['members', 'activities']
    });
  }

  async getClubs(status?: ClubStatus, page = 1, pageSize = 20): Promise<{ items: Club[]; total: number }> {
    const where = status ? { status } : {};
    const [items, total] = await this.clubRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize
    });
    return { items, total };
  }

  async getClubMembers(clubId: string): Promise<ClubMember[]> {
    return this.memberRepository.find({
      where: { clubId, isActive: true },
      relations: ['user']
    });
  }

  async checkNameAvailability(name: string): Promise<{ available: boolean; message: string }> {
    const existing = await this.clubRepository.findOne({
      where: { name: name.trim() }
    });

    if (existing) {
      return {
        available: false,
        message: `社团名称 "${name}" 已被社团 "${existing.name}" 使用`
      };
    }

    return {
      available: true,
      message: '社团名称可用'
    };
  }

  async addClubPoints(clubId: string, points: number, reason: string, activityId?: string): Promise<Club | null> {
    const club = await this.clubRepository.findOne({ where: { id: clubId } });
    if (!club) {
      return null;
    }

    const previousPoints = club.points;
    club.points += points;

    const savedClub = await this.clubRepository.save(club);

    const pointsRecord = this.pointsRepository.create({
      clubId: savedClub.id,
      club: savedClub,
      activityId: activityId || null,
      points,
      reason,
      previousPoints,
      newPoints: club.points
    });
    await this.pointsRepository.save(pointsRecord);

    await notificationService.notifyClubMembers(
      savedClub.id,
      NotificationType.POINTS_UPDATE,
      '社团积分更新',
      `社团 "${savedClub.name}" ${reason}，积分变动 ${points > 0 ? '+' : ''}${points}，当前积分：${club.points}`,
      savedClub.id,
      'club'
    );

    notificationService.broadcastStatusUpdate(
      [savedClub.leaderId],
      'club_points',
      { clubId: savedClub.id, points: club.points, change: points }
    );

    return savedClub;
  }
}

export const clubService = new ClubService();
