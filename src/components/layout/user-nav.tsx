'use client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { UserAvatarProfile } from '@/components/user-avatar-profile';
import { signOut } from '@/lib/auth/actions';
import { useDashboardSession } from '@/lib/auth/session-context';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LocaleMenuSub } from '@/components/i18n/locale-switcher';
export function UserNav() {
  const { user } = useDashboardSession();
  const router = useRouter();
  const t = useTranslations('common.userMenu');
  if (user) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant='ghost' className='relative h-8 w-8 rounded-full' />}
        >
          <UserAvatarProfile user={user} />
        </DropdownMenuTrigger>
        <DropdownMenuContent className='w-56' align='end' sideOffset={10}>
          <DropdownMenuGroup>
            <DropdownMenuLabel className='font-normal'>
              <div className='flex flex-col space-y-1'>
                <p className='text-sm leading-none font-medium'>{user.fullName}</p>
                <p className='text-muted-foreground text-xs leading-none'>{user.email}</p>
              </div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => router.push('/dashboard/profile')}>
              {t('profile')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push('/dashboard/site/settings')}>
              {t('siteSettings')}
            </DropdownMenuItem>
            <LocaleMenuSub />
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => void signOut()}>{t('signOut')}</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
}
