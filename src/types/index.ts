export enum UserRole {
  STUDENT = 'student',
  CLUB_LEADER = 'club_leader',
  ADVISOR = 'advisor',
  LEAGUE_COMMITTEE = 'league_committee',
  FINANCE = 'finance',
  ADMIN = 'admin',
  MEMBER = 'student',
  LEADER = 'club_leader',
  COMMITTEE = 'league_committee'
}

export enum ClubCategory {
  ACADEMIC = 'academic',
  ARTS = 'arts',
  SPORTS = 'sports',
  TECHNOLOGY = 'technology',
  LITERARY = 'literary',
  SOCIAL = 'social',
  OTHER = 'other'
}

export enum ActivityCategory {
  LECTURE = 'lecture',
  COMPETITION = 'competition',
  PERFORMANCE = 'performance',
  TRAINING = 'training',
  SOCIAL = 'social',
  CHARITY = 'charity',
  OTHER = 'other'
}

export enum ClubStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  DISBANDED = 'disbanded'
}

export enum ActivityStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed'
}

export enum VenueStatus {
  AVAILABLE = 'available',
  OCCUPIED = 'occupied',
  MAINTENANCE = 'maintenance'
}

export enum BookingStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed'
}

export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ESCALATED = 'escalated',
  TIMEOUT = 'timeout',
  QUEUED = 'queued'
}

export enum ApprovalFlowAction {
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  REMINDER = 'reminder',
  ESCALATED = 'escalated',
  COMPLETED = 'completed',
  REACTIVATED = 'reactivated'
}

export enum ApprovalLevel {
  ADVISOR = 'advisor',
  LEAGUE_COMMITTEE = 'league_committee'
}

export enum ReimbursementStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ABNORMAL = 'abnormal',
  PAID = 'paid'
}

export enum NotificationType {
  CLUB_APPLICATION = 'club_application',
  ACTIVITY_APPROVAL = 'activity_approval',
  VENUE_BOOKING = 'venue_booking',
  SIGN_IN = 'sign_in',
  POINTS_UPDATE = 'points_update',
  ACTIVITY_WARNING = 'activity_warning',
  REIMBURSEMENT = 'reimbursement',
  SYSTEM = 'system',
  APPROVAL_REMINDER = 'approval_reminder'
}

export enum WarningLevel {
  NORMAL = 'normal',
  ATTENTION = 'attention',
  WARNING = 'warning',
  CRITICAL = 'critical'
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message: string;
  errors?: string[];
}

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
