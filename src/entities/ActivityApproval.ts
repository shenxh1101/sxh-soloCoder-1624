import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ApprovalStatus, ApprovalLevel } from '../types';
import { Activity } from './Activity';
import { User } from './User';

@Entity()
export class ActivityApproval {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Activity, activity => activity.approvals, { eager: true })
  @JoinColumn()
  activity: Activity;

  @Column()
  activityId: string;

  @Column({
    type: 'simple-enum',
    enum: ApprovalLevel
  })
  level: ApprovalLevel;

  @ManyToOne(() => User, user => user.approvals, { eager: true, nullable: true })
  @JoinColumn()
  approver: User | null;

  @Column({ type: 'varchar', nullable: true })
  approverId: string | null;

  @Column({
    type: 'simple-enum',
    enum: ApprovalStatus,
    default: ApprovalStatus.PENDING
  })
  status: ApprovalStatus;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column({ type: 'datetime', nullable: true })
  reviewedAt: Date | null;

  @Column({ default: 0 })
  reminderCount: number;

  @Column({ type: 'datetime', nullable: true })
  lastReminderAt: Date | null;

  @Column({ default: false })
  escalated: boolean;

  @Column({ type: 'datetime', nullable: true })
  escalatedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
