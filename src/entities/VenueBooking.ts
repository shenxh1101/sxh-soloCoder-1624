import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { BookingStatus } from '../types';
import { Venue } from './Venue';
import { Activity } from './Activity';

@Entity()
export class VenueBooking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Venue, venue => venue.bookings, { eager: true })
  @JoinColumn()
  venue: Venue;

  @Column()
  venueId: string;

  @ManyToOne(() => Activity, activity => activity.bookings, { eager: true, nullable: true })
  @JoinColumn()
  activity: Activity | null;

  @Column({ type: 'varchar', nullable: true })
  activityId: string | null;

  @Column({ type: 'datetime' })
  startTime: Date;

  @Column({ type: 'datetime' })
  endTime: Date;

  @Column()
  purpose: string;

  @Column({ default: 0 })
  participants: number;

  @Column({
    type: 'simple-enum',
    enum: BookingStatus,
    default: BookingStatus.PENDING
  })
  status: BookingStatus;

  @Column({ default: false })
  isLocked: boolean;

  @Column({ type: 'datetime', nullable: true })
  lockedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  rejectReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
