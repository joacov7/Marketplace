# Profitability Engine - escenarios V2 (marketplace, comercio externo).
# TODOS los valores son PARAMETROS (config), no constantes. Aca se fijan supuestos base.
# Moneda ARS. Montos representados en enteros (centavos en el sistema; aca en pesos p/ leer).

def money(x): return f"${x:,.0f}".replace(",", ".")

# --- Supuestos base (editables) ---
MARGIN      = 0.30    # margen bruto del comercio sobre GMV (pet retail ~25-35%)
PSP_RATE    = 0.055   # fee efectivo Mercado Pago sobre lo procesado (aprox; parametro)
CADETE_COST = 2500    # costo real de una entrega (lo que cobra el cadete)
AI_COST     = 100     # costo IA por pedido (de agent-core, atribuido)
# PSP lo absorbe el COMERCIO (default realista en MP Split: el vendedor paga el procesamiento).
# La plataforma toma comision limpia. Alternativa (plataforma absorbe PSP) se comenta aparte.

def scenario(gmv, commission, delivery_charge, subsidy_by):
    # subsidy_by: 'plataforma' o 'comercio' - quien cubre el gap (cadete_cost - delivery_charge)
    gap = CADETE_COST - delivery_charge  # >0 si hay subsidio
    # Plataforma corre la logistica: cobra delivery_charge, paga al cadete.
    plat_delivery_margin = delivery_charge - CADETE_COST  # negativo si subsidiada por plataforma
    merchant_subsidy = 0
    if subsidy_by == 'comercio' and gap > 0:
        # el comercio le paga el gap a la plataforma -> plataforma no pierde en delivery
        plat_delivery_margin += gap
        merchant_subsidy = gap

    commission_income = gmv * commission
    psp_fee = (gmv) * PSP_RATE   # sobre el GMV del comercio (lo que el comercio recibe/procesa)

    plat_contrib = commission_income + plat_delivery_margin - AI_COST
    merchant_net = gmv*MARGIN - commission_income - psp_fee - merchant_subsidy
    return {
        'gmv': gmv, 'comision%': commission, 'delivery_cli': delivery_charge,
        'cadete': CADETE_COST, 'subsidio_por': subsidy_by if gap>0 else '-', 'gap': max(gap,0),
        'plat_contrib': plat_contrib, 'merchant_net': merchant_net, 'psp': psp_fee,
    }

print("="*100)
print("MATRIZ PRINCIPAL — GMV=$30.000, margen comercio 30%, PSP 5,5% (lo paga el comercio), cadete $2.500, IA $100")
print("="*100)
print(f"{'Comision':>9} | {'Delivery(cli)':>13} | {'Subsidio':>18} | {'Contrib PLATAFORMA':>18} | {'Neto COMERCIO':>13}")
print("-"*100)
policies = [
    ("full pass (cliente paga costo real)", 2500, 'plataforma'),
    ("subsidio parcial (plataforma)", 1500, 'plataforma'),
    ("subsidio parcial (comercio)", 1500, 'comercio'),
    ("gratis (plataforma subsidia todo)", 0, 'plataforma'),
]
for comm in [0.05, 0.07, 0.10]:
    for label, dc, by in policies:
        r = scenario(30000, comm, dc, by)
        subs = f"{by} ${r['gap']:,.0f}" if r['gap']>0 else "-"
        flag = "  <-- NEG" if r['plat_contrib']<0 else ""
        print(f"{int(comm*100):>7}% | {money(dc):>13} | {subs:>18} | {money(r['plat_contrib']):>18}{flag:>8} | {money(r['merchant_net']):>13}")
    print("-"*100)

print()
print("="*100)
print("SENSIBILIDAD AL TICKET (AOV) — comision 7%, subsidio parcial plataforma (cliente paga $1.500)")
print("="*100)
print(f"{'GMV':>10} | {'Contrib PLATAFORMA':>18} | {'Neto COMERCIO':>13} | {'delivery % s/GMV':>16}")
print("-"*70)
for gmv in [15000, 30000, 50000, 80000]:
    r = scenario(gmv, 0.07, 1500, 'plataforma')
    print(f"{money(gmv):>10} | {money(r['plat_contrib']):>18} | {money(r['merchant_net']):>13} | {1500/gmv*100:>14.1f} %")

print()
print("="*100)
print("DELIVERY GRATIS CONDICIONADO A TICKET (free over threshold) — comision 7%, plataforma subsidia")
print("="*100)
for gmv in [30000, 50000, 80000]:
    r = scenario(gmv, 0.07, 0, 'plataforma')
    flag = " NEG" if r['plat_contrib']<0 else " OK"
    print(f"  GMV {money(gmv):>8}: contrib plataforma {money(r['plat_contrib']):>10}{flag}")

print()
print("="*100)
print("BREAK-EVEN — pedidos/mes para cubrir costo fijo de plataforma (infra+tooling)")
print("="*100)
for fixed in [300000, 500000, 800000]:
    print(f"  Costo fijo {money(fixed)}/mes:")
    for comm, dc, by, name in [(0.07,2500,'plataforma','7% full pass'),
                                (0.07,1500,'plataforma','7% subsidio parcial'),
                                (0.10,1500,'plataforma','10% subsidio parcial')]:
        c = scenario(30000, comm, dc, by)['plat_contrib']
        be = fixed / c if c>0 else float('inf')
        print(f"     {name:>22}: contrib/pedido {money(c):>8}  ->  {be:>6.0f} pedidos/mes" if c>0 else f"     {name}: contrib negativa")
