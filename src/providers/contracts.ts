import type { CitizenData, Scenario } from '../domain/types';

export type ReadContext = { scenario: Scenario; retrievedAt: string; purpose: 'sfo-moderation' };
export interface FolkeregisterProvider { getFamily(context: ReadContext): Promise<CitizenData['family']> }
export interface IncomeProvider { getIncome(context: ReadContext): Promise<CitizenData['income']> }
export interface MunicipalServiceProvider { getSfo(context: ReadContext): Promise<CitizenData['sfo']> }
export type DataProviders = {
  family: FolkeregisterProvider;
  income: IncomeProvider;
  municipal: MunicipalServiceProvider;
};
