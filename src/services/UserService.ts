import { Repository, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { User, Club, ClubMember } from '../entities';
import { UserRole, ClubStatus } from '../types';
import { AppDataSource } from '../config/database';

class UserService {
  private userRepository: Repository<User>;
  private clubRepository: Repository<Club>;
  private memberRepository: Repository<ClubMember>;

  constructor() {
    this.userRepository = AppDataSource.getRepository(User);
    this.clubRepository = AppDataSource.getRepository(Club);
    this.memberRepository = AppDataSource.getRepository(ClubMember);
  }

  async createUser(data: {
    username: string;
    password: string;
    name: string;
    studentId?: string;
    phone?: string;
    email?: string;
    role: UserRole;
  }): Promise<User> {
    const existingUser = await this.userRepository.findOne({
      where: { username: data.username } as unknown as Record<string, unknown>
    });

    if (existingUser) {
      throw new Error('用户名已存在');
    }

    if (data.studentId) {
      const existingStudent = await this.userRepository.findOne({
        where: { studentId: data.studentId } as unknown as Record<string, unknown>
      });
      if (existingStudent) {
        throw new Error('学号已注册');
      }
    }

    const user = this.userRepository.create({
      username: data.username,
      password: data.password,
      name: data.name,
      studentId: data.studentId,
      phone: data.phone,
      email: data.email,
      role: data.role
    } as unknown as User);

    return this.userRepository.save(user as unknown as User);
  }

  async login(username: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findOne({
      where: { username, password } as unknown as Record<string, unknown>
    });

    return user || null;
  }

  async getUserById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } as unknown as Record<string, unknown> });
  }

  async getUserByUsername(username: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { username } as unknown as Record<string, unknown> });
  }

  async getUsers(role?: UserRole, page = 1, pageSize = 20): Promise<{ items: User[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (role) {
      where.role = role;
    }

    const [items, total] = await this.userRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize
    });

    return { items, total };
  }

  async updateUser(id: string, data: Partial<{
    name: string;
    phone: string;
    email: string;
    password: string;
  }>): Promise<User | null> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      return null;
    }

    if (data.name) user.name = data.name;
    if (data.phone) user.phone = data.phone;
    if (data.email) user.email = data.email;
    if (data.password) user.password = data.password;
    user.updatedAt = new Date();

    return this.userRepository.save(user);
  }

  async deleteUser(id: string): Promise<boolean> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      return false;
    }

    await this.userRepository.remove(user);
    return true;
  }

  async getUserClubs(userId: string): Promise<Club[]> {
    const memberships = await this.memberRepository.find({
      where: { userId },
      relations: ['club']
    });

    const clubs = memberships
      .filter(m => m.club && m.club.status === ClubStatus.APPROVED)
      .map(m => m.club!);

    return clubs;
  }

  async getUserRoleClubs(userId: string): Promise<{ leading: Club[]; member: Club[] }> {
    const leadingClubs = await this.clubRepository.find({
      where: {
        leaderId: userId,
        status: ClubStatus.APPROVED
      }
    });

    const memberships = await this.memberRepository.find({
      where: { userId },
      relations: ['club']
    });

    const memberClubs = memberships
      .filter(m => m.club && m.club.status === ClubStatus.APPROVED && m.club.leaderId !== userId)
      .map(m => m.club!);

    return {
      leading: leadingClubs,
      member: memberClubs
    };
  }

  async getLeaders(): Promise<User[]> {
    return this.userRepository.find({
      where: { role: UserRole.LEADER }
    });
  }

  async getCommitteeMembers(): Promise<User[]> {
    return this.userRepository.find({
      where: { role: In([UserRole.COMMITTEE, UserRole.FINANCE, UserRole.ADMIN]) as unknown as UserRole }
    } as unknown as Record<string, unknown>);
  }

  async getFinanceStaff(): Promise<User[]> {
    return this.userRepository.find({
      where: { role: In([UserRole.FINANCE, UserRole.ADMIN]) as unknown as UserRole }
    } as unknown as Record<string, unknown>);
  }

  async getUserWithClubs(userId: string): Promise<{ user: User; leadingClubs: Club[]; memberClubs: Club[] } | null> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      return null;
    }

    const { leading, member } = await this.getUserRoleClubs(userId);

    return {
      user,
      leadingClubs: leading,
      memberClubs: member
    };
  }
}

export const userService = new UserService();
