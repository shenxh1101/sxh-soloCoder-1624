import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Club } from './Club';
import { Activity } from './Activity';

@Entity()
export class ClubPoints {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Club, club => club.pointsHistory, { eager: true })
  @JoinColumn()
  club: Club;

  @Column()
  clubId: string;

  @ManyToOne(() => Activity, { eager: true, nullable: true })
  @JoinColumn()
  activity: Activity | null;

  @Column({ type: 'varchar', nullable: true })
  activityId: string | null;

  @Column()
  points: number;

  @Column()
  reason: string;

  @Column({ default: 0 })
  previousPoints: number;

  @Column({ default: 0 })
  newPoints: number;

  @CreateDateColumn()
  createdAt: Date;
}
