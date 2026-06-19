import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { VenueStatus } from '../types';
import { VenueBooking } from './VenueBooking';

@Entity()
export class Venue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column()
  location: string;

  @Column()
  capacity: number;

  @Column({ type: 'varchar', nullable: true })
  category: string | null;

  @Column({
    type: 'simple-enum',
    enum: VenueStatus,
    default: VenueStatus.AVAILABLE
  })
  status: VenueStatus;

  @Column('simple-array', { nullable: true })
  facilities: string[];

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @OneToMany(() => VenueBooking, booking => booking.venue)
  bookings: VenueBooking[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
