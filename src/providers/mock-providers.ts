import citizen from '../data/demo-citizen.json';
import type { DataProviders, FolkeregisterProvider, IncomeProvider, MunicipalServiceProvider, ReadContext } from './contracts';
import type { CitizenData, Provenance } from '../domain/types';

function source(context: ReadContext, fields: Omit<Provenance, 'retrievedAt'>): Provenance {
  return { ...fields, retrievedAt: context.retrievedAt };
}
export class MockFolkeregisterProvider implements FolkeregisterProvider {
  async getFamily(context: ReadContext): Promise<CitizenData['family']> {
    return { value: structuredClone(citizen.family), source: source(context, {
      name: 'Folkeregisteret', detail: 'Simulert oppslag. Lokalt, syntetisk datasett.',
      kind: 'synthetic-register', period: 'Demogrunnlag for skoleåret 2026/2027',
      purpose: 'Finne barnet og den registrerte familien som SFO-vurderingen gjelder.',
    }) };
  }
}
export class MockIncomeProvider implements IncomeProvider {
  async getIncome(context: ReadContext): Promise<CitizenData['income']> {
    return { value: {
      annualNok: context.scenario === 'missing-income' ? null : context.scenario === 'high-income' ? 950000 : citizen.income.annualNok,
      year: citizen.income.year,
    }, source: source(context, {
      name: 'Skatteetaten via Fiks', detail: context.scenario === 'missing-income'
        ? 'Simulert manglende svar. Ingen inntektsverdi er hentet.' : 'Simulert oppslag. Samlet brutto person- og skattepliktig kapitalinntekt.',
      kind: 'synthetic-register', period: 'Inntektsåret 2025',
      purpose: 'Sammenligne husholdningens årsinntekt med betalingen for SFO.',
    }) };
  }
}
export class MockMunicipalServiceProvider implements MunicipalServiceProvider {
  async getSfo(context: ReadContext): Promise<CitizenData['sfo']> {
    return { value: structuredClone(citizen.sfo), source: source(context, {
      name: 'Kommunens oppvekstsystem', detail: 'Syntetisk plass og lokal demopris. Ingen kommunal prisliste er brukt.',
      kind: 'demo-price', period: 'Skoleåret 2026/2027',
      purpose: 'Finne klassetrinn, avtalt plass, timer og pris for barnets SFO.',
    }) };
  }
}
export const mockProviders: DataProviders = {
  family: new MockFolkeregisterProvider(), income: new MockIncomeProvider(), municipal: new MockMunicipalServiceProvider(),
};
