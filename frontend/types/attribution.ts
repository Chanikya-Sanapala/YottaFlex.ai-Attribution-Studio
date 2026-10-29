export const SUPPORTED_MODELS = [
  'FIRST_TOUCH',
  'LAST_TOUCH',
  'LINEAR',
  'TIME_DECAY',
  'POSITION_BASED',
] as const;

export type AttributionModel = (typeof SUPPORTED_MODELS)[number];

export type NavigationPage = 'overview' | 'campaigns' | 'quality' | 'imports';

export interface MoneyRow {
  currency: string;
  revenue?: number;
  spend?: number;
  attributed_revenue?: number;
  attributed_orders?: number;
}

export interface DataIssueSummary {
  issue_type: string;
  issue_count: number;
}

export interface OverviewData {
  status: string;
  generatedAt: string;
  campaigns: number;
  contacts: number;
  orders: number;
  touchpoints: number;
  attributionResults: number;
  openDataIssues: number;
  revenueByCurrency: MoneyRow[];
  validSpendByCurrency: MoneyRow[];
  dataIssuesByType: DataIssueSummary[];
  attributionModels: string[];
  roiPolicy: string;
}

export interface CampaignData {
  campaign_code: string;
  campaign_name: string;
  status: string;
  start_at: string;
  end_at?: string;
  channel_name: string;
  channel_type: string;
  budget_amount: number;
  budget_currency: string;
  actualSpendByCurrency: MoneyRow[];
  attributedRevenueByCurrency: MoneyRow[];
  attributionModel: string;
  roiStatus: string;
  roiPercent: number | null;
  currencyMismatchCostRecords: number;
  missingCostIssueCount: number;
}

export interface StagedFile {
  file: File;
  rows: number;
  headers: string[];
  dataset: string;
  error: string;
}

