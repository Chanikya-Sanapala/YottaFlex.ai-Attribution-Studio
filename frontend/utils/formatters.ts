import { AttributionModel } from '../types/attribution';

/**
 * Format currency amounts in Indian Rupees (INR) with consistent en-IN conventions.
 */
export function formatINR(
  value: number | null | undefined,
  options: { compact?: boolean; maximumFractionDigits?: number } = {}
): string {
  if (value == null || isNaN(value)) {
    return '—';
  }

  const { compact = false, maximumFractionDigits = 0 } = options;

  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits,
      notation: compact && Math.abs(value) >= 10000000 ? 'compact' : 'standard',
    }).format(value);
  } catch {
    // Fallback if Intl fails
    const formatted = Math.round(value).toLocaleString('en-IN');
    return `₹${formatted}`;
  }
}

/**
 * Format large counts and integer metrics with en-IN comma grouping.
 */
export function formatNumber(value: number | null | undefined): string {
  if (value == null || isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-IN').format(value);
}

/**
 * Format ROI percentage with explicit sign and two decimals.
 */
export function formatROI(value: number | null | undefined): {
  text: string;
  isPositive: boolean;
  isZero: boolean;
} {
  if (value == null || isNaN(value)) {
    return { text: 'Unavailable', isPositive: false, isZero: false };
  }
  const isZero = value === 0;
  const isPositive = value > 0;
  const formatted = `${isPositive ? '+' : ''}${value.toFixed(2)}%`;
  return { text: formatted, isPositive, isZero };
}

/**
 * Format timestamp into clean date string.
 */
export function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return isoString;
  }
}

/**
 * Convert SNAKE_CASE or camelCase to clean Title Case.
 */
export function titleCase(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export interface ModelDetail {
  id: AttributionModel;
  name: string;
  tagline: string;
  description: string;
  weighting: string;
  formula: string;
}

export const MODEL_DETAILS: Record<AttributionModel, ModelDetail> = {
  FIRST_TOUCH: {
    id: 'FIRST_TOUCH',
    name: 'First Touch',
    tagline: '100% credit to the earliest eligible discovery touchpoint',
    description:
      'Attributes 100% of conversion revenue to the first validated customer interaction within the 90-day lookback window. Ideal for analyzing top-of-funnel acquisition channels.',
    weighting: 'First: 100% | Middle: 0% | Last: 0%',
    formula: 'Credit = 1.0 on earliest touchpoint',
  },
  LAST_TOUCH: {
    id: 'LAST_TOUCH',
    name: 'Last Touch',
    tagline: '100% credit to the final touchpoint preceding conversion',
    description:
      'Attributes 100% of conversion revenue to the immediate pre-conversion interaction. Emphasizes direct closing drivers and high-intent conversion catalysts.',
    weighting: 'First: 0% | Middle: 0% | Last: 100%',
    formula: 'Credit = 1.0 on latest touchpoint',
  },
  LINEAR: {
    id: 'LINEAR',
    name: 'Linear',
    tagline: 'Equal distribution across all eligible customer interactions',
    description:
      'Distributes conversion revenue uniformly among every eligible touchpoint in the journey. Ensures balanced recognition across brand awareness, nurturing, and retargeting.',
    weighting: 'Even split: 1 / N per touchpoint',
    formula: 'Credit = 1 / N for all touches',
  },
  TIME_DECAY: {
    id: 'TIME_DECAY',
    name: 'Time Decay',
    tagline: 'Exponential 7-day half-life weighting favor recent touches',
    description:
      'Weights touchpoints based on recency using a 7-day exponential half-life. Interacted touchpoints closer to the transaction receive significantly higher attribution shares.',
    weighting: 'Half-life = 7 days (weights 2^(-age/7))',
    formula: 'w_i = 2^(-Δt_i / 7); Share = w_i / Σw',
  },
  POSITION_BASED: {
    id: 'POSITION_BASED',
    name: 'Position Based',
    tagline: 'U-shaped: 40% first touch, 40% last touch, 20% middle touches',
    description:
      'Assigns 40% credit to the introductory first touch, 40% to the concluding last touch, and distributes the remaining 20% equally among all intermediary nurturing touches.',
    weighting: 'First: 40% | Middle: 20% split | Last: 40%',
    formula: '0.40 first + 0.40 last + (0.20 / (N - 2)) middle',
  },
};

export interface IssueDetail {
  title: string;
  severity: 'high' | 'medium' | 'low';
  category: string;
  summary: string;
  safeguardAction: string;
  impact: string;
}

export const ISSUE_REGISTRY: Record<string, IssueDetail> = {
  CURRENCY_MISMATCH: {
    title: 'Currency Mismatch',
    severity: 'high',
    category: 'Cost Record Quarantine',
    summary:
      'Cost record currency differs from reporting currency (e.g., USD costs vs INR orders) without a validated spot exchange rate.',
    safeguardAction:
      'Quarantined from marketing spend aggregates. Campaign ROI is held as UNAVAILABLE_CURRENCY_MISMATCH.',
    impact: 'Prevents misleading cross-currency arithmetic in overall profit & ROI reporting.',
  },
  MISSING_CAMPAIGN_COST: {
    title: 'Missing Campaign Cost',
    severity: 'high',
    category: 'Spend Pipeline Gap',
    summary:
      'Campaign generated attributed orders and revenue, but no matching cost record was ingested in the cost pipeline.',
    safeguardAction:
      'Flagged as UNAVAILABLE_MISSING_COST. Cost is never assumed to be zero.',
    impact: 'Protects against artificial infinite (+∞) ROI claims in executive reporting.',
  },
  DUPLICATE_REVENUE: {
    title: 'Duplicate Revenue Event',
    severity: 'medium',
    category: 'Transaction Deduplication',
    summary:
      'Multiple order rows or webhook payloads share an identical revenue event key.',
    safeguardAction:
      'Deduplicated at calculation; counted exactly once while preserving duplicate entries for audit trail.',
    impact: 'Eliminates revenue double-counting while maintaining a complete financial audit log.',
  },
  POST_CONVERSION_TOUCH: {
    title: 'Post-Conversion Touchpoint',
    severity: 'medium',
    category: 'Temporal Anomaly',
    summary:
      'Touchpoint interaction timestamp occurs after the recorded order conversion timestamp.',
    safeguardAction:
      'Excluded from the attribution candidate set under rule version v2-eligible-90d.',
    impact: 'Guarantees that causality is respected; post-purchase marketing cannot claim conversion credit.',
  },
  UNSUPPORTED_IDENTITY_LINK: {
    title: 'Unsupported Identity Link',
    severity: 'high',
    category: 'Identity Resolution',
    summary:
      'Touchpoint-to-contact link lacks certified evidence (requires AUTHENTICATED, FORM_SUBMISSION, FIRST_PARTY_COOKIE, or CRM_MATCH).',
    safeguardAction:
      'Quarantined from the attribution pool until certified deterministic evidence is provided.',
    impact: 'Prevents probabilistic or unverified third-party touchpoints from polluting customer journeys.',
  },
};

export const SUPPORTED_DATASETS = [
  'channel',
  'audience',
  'creative',
  'contact',
  'campaign',
  'campaign_creative',
  'campaign_audience',
  'touchpoint',
  'web_session',
  'lead',
  'opportunity',
  'orders',
  'cost_record',
  'attribution_result',
  'ground_truth',
] as const;

