import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { ClubStatus } from '../types';
import { User } from './User';
import { ClubMember } from './ClubMember';
import { Activity } from './Activity';
import { ClubPoints } from './ClubPoints';
import { ActivityWarning } from './ActivityWarning';

@Entity()
export class Club {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column()
  description: string;

  @Column()
  category: string;

  @Column({
    type: 'simple-enum',
    enum: ClubStatus,
    default: ClubStatus.PENDING
  })
  status: ClubStatus;

  @Column({ type: 'text', nullable: true })
  rejectReason: string | null;

  @Column({ default: 0 })
  points: number;

  @ManyToOne(() => User, user => user.leadingClubs, { eager: true })
  @JoinColumn()
  leader: User;

  @Column()
  leaderId: string;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn()
  advisor: User | null;

  @Column({ type: 'varchar', nullable: true })
  advisorId: string | null;

  @OneToMany(() => ClubMember, member => member.club, { cascade: true })
  members: ClubMember[];

  @OneToMany(() => Activity, activity => activity.club)
  activities: Activity[];

  @OneToMany(() => ClubPoints, points => points.club)
  pointsHistory: ClubPoints[];

  @OneToMany(() => ActivityWarning, warning => warning.club)
  warnings: ActivityWarning[];

  @Column({ type: 'datetime', nullable: true })
  approvedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
