import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { ActivityStatus } from '../types';
import { Club } from './Club';
import { VenueBooking } from './VenueBooking';
import { ActivityApproval } from './ActivityApproval';
import { Attendance } from './Attendance';
import { Reimbursement } from './Reimbursement';

@Entity()
export class Activity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column()
  category: string;

  @Column({ type: 'datetime' })
  startTime: Date;

  @Column({ type: 'datetime' })
  endTime: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  budget: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  actualCost: number;

  @Column({ default: 0 })
  expectedParticipants: number;

  @Column({ default: 0 })
  actualParticipants: number;

  @Column({
    type: 'simple-enum',
    enum: ActivityStatus,
    default: ActivityStatus.DRAFT
  })
  status: ActivityStatus;

  @Column({ type: 'text', nullable: true })
  rejectReason: string | null;

  @ManyToOne(() => Club, club => club.activities, { eager: true })
  @JoinColumn()
  club: Club;

  @Column()
  clubId: string;

  @OneToMany(() => VenueBooking, booking => booking.activity)
  bookings: VenueBooking[];

  @OneToMany(() => ActivityApproval, approval => approval.activity)
  approvals: ActivityApproval[];

  @OneToMany(() => Attendance, attendance => attendance.activity)
  attendances: Attendance[];

  @OneToMany(() => Reimbursement, reimbursement => reimbursement.activity)
  reimbursements: Reimbursement[];

  @Column({ type: 'datetime', nullable: true })
  approvedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
