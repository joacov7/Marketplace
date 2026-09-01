import type { Db } from "@commerce/platform";
import { type Result, ok, err } from "@commerce/contracts";

/** Un asiento del ledger: una cuenta con débito O crédito (double-entry). */
export interface LedgerEntry {
  account: string;
  accountRef?: string;
  debitMinor?: bigint;
  creditMinor?: bigint;
  memo?: string;
}

/**
 * Postea un conjunto de asientos que DEBE balancear (sum débitos = sum créditos). Si no
 * balancea, no escribe nada (falla). El ledger es la fuente de verdad del dinero; payment
 * y refund son proyecciones. Convención de saldo: balance = Σcréditos − Σdébitos.
 */
export async function postLedger(
  db: Db,
  tenantId: string,
  paymentId: string,
  entries: readonly LedgerEntry[],
): Promise<Result<true, string>> {
  const debit = entries.reduce((a, e) => a + (e.debitMinor ?? 0n), 0n);
  const credit = entries.reduce((a, e) => a + (e.creditMinor ?? 0n), 0n);
  if (debit !== credit) return err(`ledger no balancea: débitos ${debit} ≠ créditos ${credit}`);

  for (const e of entries) {
    await db.query(
      `insert into ledger_entries (tenant_id, payment_id, account, account_ref, debit_minor, credit_minor, memo)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        tenantId,
        paymentId,
        e.account,
        e.accountRef ?? null,
        (e.debitMinor ?? 0n).toString(),
        (e.creditMinor ?? 0n).toString(),
        e.memo ?? null,
      ],
    );
  }
  return ok(true);
}

/** Saldo de una cuenta = Σcréditos − Σdébitos (para conciliación y payouts). */
export async function accountBalance(db: Db, account: string, accountRef?: string): Promise<bigint> {
  const [row] = await db.query<{ bal: string | null }>(
    `select coalesce(sum(credit_minor) - sum(debit_minor), 0)::text as bal
       from ledger_entries
      where account = $1 and account_ref is not distinct from $2`,
    [account, accountRef ?? null],
  );
  return BigInt(row?.bal ?? "0");
}

/** Suma de todos los saldos: DEBE ser 0 si el ledger está balanceado (invariante global). */
export async function ledgerIsBalanced(db: Db): Promise<boolean> {
  const [row] = await db.query<{ d: string; c: string }>(
    `select coalesce(sum(debit_minor),0)::text d, coalesce(sum(credit_minor),0)::text c from ledger_entries`,
  );
  return BigInt(row?.d ?? "0") === BigInt(row?.c ?? "0");
}
