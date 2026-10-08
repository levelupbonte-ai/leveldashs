import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { DashboardUser } from '@/lib/auth/types';

interface UserAvatarProfileProps {
  className?: string;
  showInfo?: boolean;
  user: Pick<DashboardUser, 'fullName' | 'email' | 'avatarUrl'> | null;
}

export function UserAvatarProfile({ className, showInfo = false, user }: UserAvatarProfileProps) {
  return (
    <div className='flex items-center gap-2'>
      <Avatar className={className}>
        <AvatarImage src={user?.avatarUrl || ''} alt={user?.fullName || ''} />
        <AvatarFallback className='rounded-lg'>
          {user?.fullName?.slice(0, 2)?.toUpperCase() || 'LU'}
        </AvatarFallback>
      </Avatar>

      {showInfo && (
        <div className='grid flex-1 text-left text-sm leading-tight'>
          <span className='truncate font-semibold'>{user?.fullName || ''}</span>
          <span className='truncate text-xs'>{user?.email || ''}</span>
        </div>
      )}
    </div>
  );
}
