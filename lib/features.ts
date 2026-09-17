// Personal ledger is the default. Email workers are an opt-in legacy deployment feature.
export const ledgerOnly = process.env.NEXT_PUBLIC_LEDGER_ONLY !== 'false';
