import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ApprovalFlowAction, ApprovalLevel } from '../types';
import { Activity } from './Activity';
import { User } from './User';

@Entity()
export class ActivityApprovalFlow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Activity, { onDelete: 'CASCADE' })
  @JoinColumn()
  activity: Activity;

  @Column({ type: 'varchar' })
  activityId: string;

  @Column({
    type: 'simple-enum',
    enum: ApprovalFlowAction
  })
  action: ApprovalFlowAction;

  @Column({
    type: 'simple-enum',
    enum: ApprovalLevel,
    nullable: true
  })
  level: ApprovalLevel | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn()
  actor: User | null;

  @Column({ type: 'varchar', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', nullable: true })
  actorName: string | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
