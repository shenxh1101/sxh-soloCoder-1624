import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity()
export class DailyReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'date', unique: true })
  reportDate: string;

  @Column({ default: 0 })
  totalClubs: number;

  @Column({ default: 0 })
  activeClubs: number;

  @Column({ default: 0 })
  totalActivities: number;

  @Column({ default: 0 })
  todayActivities: number;

  @Column({ default: 0 })
  totalParticipants: number;

  @Column({ default: 0 })
  todayParticipants: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalBudget: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalActualCost: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  budgetUtilizationRate: number;

  @Column({ default: 0 })
  pendingApprovals: number;

  @Column({ default: 0 })
  pendingReimbursements: number;

  @Column({ default: 0 })
  newClubs: number;

  @Column({ default: 0 })
  warnings: number;

  @Column({ type: 'simple-json', nullable: true })
  activityByCategory: Record<string, number> | null;

  @Column({ type: 'simple-json', nullable: true })
  topClubs: Array<{
    clubId: string;
    clubName: string;
    activityCount: number;
    participants: number;
  }> | null;

  @Column({ type: 'simple-json', nullable: true })
  clubStats: Array<{
    clubId: string;
    clubName: string;
    category: string;
    activityCount: number;
    participants: number;
    budgetUsed: number;
    budgetUtilization: number;
  }> | null;

  @Column({ type: 'simple-json', nullable: true })
  categoryStats: Array<{
    category: string;
    activityCount: number;
    participants: number;
    budget: number;
    actualCost: number;
  }> | null;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'datetime', nullable: true })
  generatedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
