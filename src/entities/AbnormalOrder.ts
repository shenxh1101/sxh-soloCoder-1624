import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Reimbursement } from './Reimbursement';
import { User } from './User';

@Entity()
export class AbnormalOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  orderNo: string;

  @ManyToOne(() => Reimbursement, reimbursement => reimbursement.abnormalOrders, { eager: true })
  @JoinColumn()
  reimbursement: Reimbursement;

  @Column()
  reimbursementId: string;

  @Column()
  type: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  deviationRate: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  deviationAmount: number;

  @ManyToOne(() => User, { eager: true, nullable: true })
  @JoinColumn()
  assignee: User | null;

  @Column({ type: 'varchar', nullable: true })
  assigneeId: string | null;

  @Column({ default: 'pending' })
  status: string;

  @Column({ type: 'text', nullable: true })
  resolution: string | null;

  @Column({ type: 'datetime', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  resolvedBy: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
