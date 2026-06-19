import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { ReimbursementStatus } from '../types';
import { Activity } from './Activity';
import { Club } from './Club';
import { ReimbursementItem } from './ReimbursementItem';
import { AbnormalOrder } from './AbnormalOrder';

@Entity()
export class Reimbursement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  applicationNo: string;

  @ManyToOne(() => Activity, activity => activity.reimbursements, { eager: true })
  @JoinColumn()
  activity: Activity;

  @Column()
  activityId: string;

  @ManyToOne(() => Club, { eager: true })
  @JoinColumn()
  club: Club;

  @Column()
  clubId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  budgetAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  requestedAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  approvedAmount: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  deviationRate: number;

  @Column({
    type: 'simple-enum',
    enum: ReimbursementStatus,
    default: ReimbursementStatus.PENDING
  })
  status: ReimbursementStatus;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true })
  rejectReason: string | null;

  @OneToMany(() => ReimbursementItem, item => item.reimbursement, { cascade: true })
  items: ReimbursementItem[];

  @OneToMany(() => AbnormalOrder, order => order.reimbursement)
  abnormalOrders: AbnormalOrder[];

  @Column({ type: 'datetime', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  approvedBy: string | null;

  @Column({ type: 'varchar', nullable: true })
  rejectedBy: string | null;

  @Column({ type: 'datetime', nullable: true })
  rejectedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  paidBy: string | null;

  @Column({ type: 'datetime', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
