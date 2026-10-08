import {
  IconAdjustmentsHorizontal,
  IconDevices,
  IconShieldCheck,
  IconShieldLock,
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowRight,
  IconBell,
  IconBold,
  IconBox,
  IconBrandGithub,
  IconBrandGoogle,
  IconMail,
  IconWorld,
  IconInbox,
  IconListDetails,
  IconSpeakerphone,
  IconCopy,
  IconScissors,
  IconHourglass,
  IconBrandTwitter,
  IconBrightness,
  IconCalendar,
  IconCheck,
  IconChecks,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconChevronsDown,
  IconChevronsLeft,
  IconChevronsRight,
  IconCircle,
  IconCircleCheck,
  IconCirclePlus,
  IconCircleX,
  IconClipboardText,
  IconClock,
  IconCode,
  IconCreditCard,
  IconDeviceLaptop,
  IconDots,
  IconDotsVertical,
  IconEdit,
  IconExternalLink,
  IconEyeOff,
  IconFile,
  IconFileText,
  IconFileTypePdf,
  IconFileTypeDoc,
  IconFileTypeXls,
  IconFileZip,
  IconFolder,
  IconGripVertical,
  IconHelpCircle,
  IconInfoCircle,
  IconItalic,
  IconLayoutDashboard,
  IconLayoutKanban,
  IconLayoutSidebar,
  IconLoader2,
  IconLock,
  IconLogin,
  IconLogout,
  IconMessage,
  IconMinus,
  IconMoon,
  IconMusic,
  IconPalette,
  IconPaperclip,
  IconPhone,
  IconPhoto,
  IconPizza,
  IconPlus,
  IconProps,
  IconRosetteDiscountCheck,
  IconSearch,
  IconSelector,
  IconSend,
  IconSettings,
  IconShare,
  IconSlash,
  IconSparkles,
  IconStack2,
  IconStar,
  IconSun,
  IconTrash,
  IconTrendingDown,
  IconTrendingUp,
  IconTypography,
  IconUnderline,
  IconUpload,
  IconUser,
  IconUserCircle,
  IconUserEdit,
  IconUserX,
  IconUsers,
  IconVideo,
  IconCrown,
  IconX
} from '@tabler/icons-react';

export type Icon = React.ComponentType<IconProps>;

// LevelUp star (same facets as src/app/icon.svg), flat colors so several copies
// can share a page without gradient id clashes.
const STAR_FACETS: [string, string][] = [
  ['256,278 256,38 202,192', '#BA97FE'],
  ['256,278 256,38 310,192', '#7A31EE'],
  ['256,278 310,192 484,204', '#681FE1'],
  ['256,278 484,204 344,280', '#460DB7'],
  ['256,278 344,280 397,470', '#3A0897'],
  ['256,278 397,470 256,362', '#480DB7'],
  ['256,278 256,362 115,470', '#5C15CC'],
  ['256,278 115,470 168,280', '#6E22E1'],
  ['256,278 168,280 28,204', '#8941F7'],
  ['256,278 28,204 202,192', '#A974FE']
];

function LevelUpStar({ size = 24, className, title }: IconProps) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox='20 30 472 448'
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {STAR_FACETS.map(([points, fill]) => (
        <polygon key={points} points={points} fill={fill} />
      ))}
    </svg>
  );
}

export const Icons = {
  // General
  alertCircle: IconAlertCircle,
  warning: IconAlertTriangle,
  arrowRight: IconArrowRight,
  check: IconCheck,
  checks: IconChecks,
  circleCheck: IconCircleCheck,
  close: IconX,
  clock: IconClock,
  code: IconCode,
  dots: IconDots,
  ellipsis: IconDotsVertical,
  externalLink: IconExternalLink,
  help: IconHelpCircle,
  info: IconInfoCircle,
  spinner: IconLoader2,
  search: IconSearch,
  settings: IconSettings,
  trash: IconTrash,

  // Navigation / Chevrons
  chevronDown: IconChevronDown,
  chevronLeft: IconChevronLeft,
  chevronRight: IconChevronRight,
  chevronUp: IconChevronUp,
  chevronsDown: IconChevronsDown,
  chevronsLeft: IconChevronsLeft,
  chevronsRight: IconChevronsRight,
  chevronsUpDown: IconSelector,

  // Layout
  dashboard: IconLayoutDashboard,
  kanban: IconLayoutKanban,
  panelLeft: IconLayoutSidebar,

  // User
  user: IconUser,
  user2: IconUserCircle,
  account: IconUserCircle,
  profile: IconUser,
  employee: IconUserX,
  userPen: IconUserEdit,
  teams: IconUsers,

  // Brand
  github: IconBrandGithub,
  google: IconBrandGoogle,
  mail: IconMail,
  photo: IconPhoto,
  world: IconWorld,
  inbox: IconInbox,
  star: IconStar,
  listDetails: IconListDetails,
  speakerphone: IconSpeakerphone,
  copy: IconCopy,
  scissors: IconScissors,
  hourglass: IconHourglass,
  twitter: IconBrandTwitter,
  logo: LevelUpStar,

  // Communication
  chat: IconMessage,
  notification: IconBell,
  phone: IconPhone,
  video: IconVideo,
  send: IconSend,
  paperclip: IconPaperclip,

  // Files
  page: IconFile,
  post: IconFileText,
  fileTypePdf: IconFileTypePdf,
  fileTypeDoc: IconFileTypeDoc,
  fileTypeXls: IconFileTypeXls,
  fileZip: IconFileZip,
  media: IconPhoto,
  music: IconMusic,

  // Actions
  add: IconPlus,
  edit: IconEdit,
  upload: IconUpload,
  share: IconShare,
  login: IconLogin,
  logout: IconLogout,
  gripVertical: IconGripVertical,

  // Shapes / Indicators
  circle: IconCircle,
  circleX: IconCircleX,
  plusCircle: IconCirclePlus,
  xCircle: IconCircleX,
  minus: IconMinus,

  // Theme
  sun: IconSun,
  moon: IconMoon,
  brightness: IconBrightness,
  laptop: IconDeviceLaptop,
  palette: IconPalette,

  // Commerce / Plans
  billing: IconCreditCard,
  creditCard: IconCreditCard,
  product: IconBox,
  pro: IconCrown,
  exclusive: IconStar,
  sparkles: IconSparkles,
  badgeCheck: IconRosetteDiscountCheck,
  lock: IconLock,
  shield: IconShieldLock,
  shieldCheck: IconShieldCheck,
  devices: IconDevices,

  // Data / Charts
  trendingDown: IconTrendingDown,
  trendingUp: IconTrendingUp,
  eyeOff: IconEyeOff,
  adjustments: IconAdjustmentsHorizontal,

  // Text formatting
  bold: IconBold,
  italic: IconItalic,
  underline: IconUnderline,
  text: IconTypography,

  // Toast
  toastSuccess: IconCircleCheck,
  toastInfo: IconInfoCircle,
  toastWarning: IconAlertTriangle,
  toastError: IconCircleX,
  toastLoading: IconLoader2,

  // Misc
  pizza: IconPizza,
  workspace: IconFolder,
  forms: IconClipboardText,
  slash: IconSlash,
  calendar: IconCalendar,
  galleryVerticalEnd: IconStack2,
  moreHorizontal: IconDots
};
