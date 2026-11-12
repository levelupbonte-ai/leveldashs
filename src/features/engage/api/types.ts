export const CAMPAIGN_KINDS = ['bar', 'popup', 'slot'] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'archived';
export const CAMPAIGN_THEMES = ['dark', 'light', 'accent'] as const;
export type CampaignTheme = (typeof CAMPAIGN_THEMES)[number];
export type CampaignFrequency = 'always' | 'session' | 'once';

export interface CampaignText {
  title?: string;
  text?: string;
  cta?: string;
}

/** A campaign the LevelUp tag shows on the website (site_campaigns). */
export interface Campaign {
  id: string;
  website_id: string;
  name: string;
  kind: CampaignKind;
  status: CampaignStatus;
  content: { fr?: CampaignText; en?: CampaignText };
  cta_url: string | null;
  coupon_code: string | null;
  countdown_to: string | null;
  starts_at: string | null;
  ends_at: string | null;
  pages: string[];
  slot: string | null;
  position: 'top' | 'bottom';
  delay_seconds: number;
  frequency: CampaignFrequency;
  theme: CampaignTheme;
  accent: string | null;
  priority: number;
  created_at: string;
  updated_at: string;
  stats: { views: number; clicks: number; closes: number };
}

export type CampaignInput = Omit<
  Campaign,
  'id' | 'website_id' | 'created_at' | 'updated_at' | 'stats'
>;

export const CONFIG_KINDS = ['text', 'number', 'boolean', 'date', 'json'] as const;
export type ConfigKind = (typeof CONFIG_KINDS)[number];

/** A value the website reads (LevelUp.config(key) or the site bundle). Public: never a secret. */
export interface ConfigValue {
  key: string;
  kind: ConfigKind;
  value: unknown;
  description: string | null;
  updated_at: string;
}

/** A promo code the website's server checks before the payment page. */
export interface PromoCode {
  id: string;
  code: string;
  description: string | null;
  discount_kind: 'percent' | 'amount';
  /** Percent (1-100) or an amount in the smallest currency unit. */
  discount_value: number;
  currency: string;
  offers: string[];
  max_uses: number | null;
  uses: number;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
  created_at: string;
}

export type PromoInput = Omit<PromoCode, 'id' | 'uses' | 'created_at'>;
