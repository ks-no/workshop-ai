export type Scenario = 'standard' | 'missing-income' | 'high-income' | 'unavailable';
export type Topic = 'why' | 'data' | 'income-change' | 'source' | 'next' | 'privacy' | 'unknown';
export type Provenance = {
  name: string;
  detail: string;
  retrievedAt: string;
  period: string;
  purpose: string;
  kind: 'synthetic-register' | 'demo-price' | 'citizen';
};
export type Sourced<T> = { value: T; source: Provenance };
export type Family = {
  applicant: { id: string; name: string };
  child: { id: string; name: string; age: number };
  municipality: string;
  registeredAdults: number;
};
export type SfoPlace = {
  school: string;
  grade: number;
  placePercent: number;
  hoursPerWeek: number;
  monthlyPriceNok: number;
  paymentMonths: number;
  monthlyFoodNok: number;
};
export type CitizenData = {
  family: Sourced<Family>;
  sfo: Sourced<SfoPlace>;
  income: Sourced<{ annualNok: number | null; year: number }>;
};
export type Answers = {
  cohabitant?: 'no' | 'yes';
  currentIncomeNok?: number;
  correction?: 'income' | 'other';
  note?: string;
  informationConfirmed?: boolean;
};
export type Calculation = {
  incomeNok: number;
  annualPriceOre: number;
  annualCapOre: number;
  freeHours: number;
  monthlyBeforeOre: number;
  monthlyAfterOre: number;
  monthlySavingOre: number;
  monthlyFoodOre: number;
  paymentMonths: number;
};
export type Assessment = {
  status: 'missing' | 'manual' | 'eligible' | 'no-reduction' | 'out-of-scope';
  title: string;
  explanation: string;
  missing: ('cohabitant' | 'income' | 'confirmation')[];
  calculation: Calculation | null;
  ruleVersion: string;
  basedOn: 'registry' | 'citizen';
  reasons: string[];
};
export type AuditEntry = { id: string; at: string; action: string; detail: string };
export type Receipt = {
  reference: string;
  createdAt: string;
  status: 'ready-for-review' | 'manual-review';
  synthetic: true;
  event: 'application.confirmed';
  ruleVersion: string;
};
export type CaseSession = {
  id: string;
  createdAt: string;
  expiresAt: number;
  scenario: Scenario;
  data: CitizenData;
  answers: Answers;
  assessment: Assessment | null;
  receipt: Receipt | null;
  audit: AuditEntry[];
};
export type CaseView = Omit<CaseSession, 'expiresAt'>;
export type Explanation = { text: string; topic: Topic; mode: 'template' | 'local-ai'; source: string; fallback: boolean };
