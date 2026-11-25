// Values are a transparent, shrinkage-stabilized scenario, not an airdrop prediction.
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y), i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};

// Published defaults initialize both the ranked board and the dashboard's scenario lab.
export const MODEL_DEFAULTS = {
  momentum_weight: 0.5,
  maturity_floor: 0.75,
  maturity_days: 730,
  unknown_age_days: 365,
  shrinkage_prior_peers: 3,
  ratio_cap: 12,
};

const noToken = (p: any) => !p.gecko_id && !p.symbol && !(p.mcap_usd > 0);

function chainGas(chain: string): { tx: string; weekly: string } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { tx: '$4–$12 gas', weekly: '$8–$15/week' };
  if (/solana|sui|aptos|ton|near|stellar/.test(c)) return { tx: '$0.01–$0.05 gas', weekly: '$0.10/week' };
  if (/base|arbitrum|optimism|polygon|bsc|avalanche|linea|scroll|zksync|blast|berachain|hyperliquid/.test(c)) {
    return { tx: '$0.05–$0.35 gas', weekly: '$0.50–$1/week' };
  }
  return { tx: '$0.25–$1.50 gas', weekly: '$1–$2/week' };
}

function plan(p: any, age: number | null): string[] {
  const chain = p.chains[0] || 'the primary supported chain';
  const extraChains = p.chains.length > 1 ? ` (also active on ${p.chains.slice(1, 3).join(', ')})` : '';
  const cat = (p.category || '').toLowerCase();
  const gas = chainGas(chain);
  const capital = p.tvl_usd >= 1e9 ? 200 : p.tvl_usd >= 1e8 ? 100 : 50;
  const action = /lend|cdp/.test(cat)
    ? `supply $${capital} to a liquid lending market and test a small borrow/repay cycle at conservative health factor`
    : /dex|amm/.test(cat)
      ? `execute 2–3 organic swaps totaling ~$${capital} across major pairs; only add LP after checking impermanent loss`
      : /prediction/.test(cat)
        ? `place 2–3 small, hedged market positions totaling ~$${capital} across liquid events and claim settled shares`
        : /bridge/.test(cat)
          ? `bridge ~$${capital} to ${chain} and confirm finality on the destination explorer`
          : /perpetual|derivative/.test(cat)
            ? `open and close a low-leverage (1x–2x) position sized around $${capital} to record active margin volume`
            : /staking|restaking/.test(cat)
              ? `stake ~$${capital} after verifying the withdrawal queue and unbonding window`
              : /yield|vault|curator|rwa/.test(cat)
                ? `deposit ~$${capital} into a flagship vault after reviewing curator fees, lockups, and underlying collateral`
                : `interact with ${p.name}'s core contract using ~$${capital} in liquid assets`;
  const weeks = age === null || age < 365 ? 8 : 4;
  return [
    `Verify ${p.name}'s official domain, contract audits, and ${chain} deployment${extraChains} before connecting. Cost: $0. Time: 10 minutes.`,
    `Fund a dedicated farming wallet on ${chain} with ~$${capital} plus native gas (${gas.tx}); keep seed phrase offline. Cost: $${capital} capital at risk + ${gas.tx}. Time: 10 minutes.`,
    `On ${p.name}, ${action}. Cost: up to $${capital} exposed + protocol fees and ${gas.tx}. Time: 15 minutes.`,
    `Maintain steady weekly activity for ${weeks} weeks (${weeks} distinct weekly epochs) instead of one-off bursts; log tx hashes. Cost: ${gas.weekly}. Time: 10 minutes/week.`,
    `Track official governance or points announcements, claim any earned yield, and unwind when risk-adjusted return fades; no token launch is guaranteed. Cost: ${gas.tx} exit. Time: 15 minutes.`,
  ];
}

export function build(snapshot: any) {
  const groups = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd > 0 && p.tvl_usd > 0) {
      const ratio = clamp(p.mcap_usd / p.tvl_usd, 0.05, MODEL_DEFAULTS.ratio_cap);
      allRatios.push(ratio);
      const k = p.category || 'Unclassified';
      const list = groups.get(k);
      if (list) list.push(ratio);
      else groups.set(k, [ratio]);
    }
  }
  const globalMedian = allRatios.length ? median(allRatios) : 1;
  const prior = MODEL_DEFAULTS.shrinkage_prior_peers;
  const watch = new Set(snapshot.watchlist);

  const rows = snapshot.protocols
    .filter((p: any) => noToken(p) || watch.has(p.slug))
    .map((p: any) => {
      const peers = groups.get(p.category || 'Unclassified') || [];
      const rawCatMedian = peers.length ? median(peers) : globalMedian;
      // Empirical-Bayes shrinkage toward global median prevents 1-peer outliers from distorting ranks.
      const multiple = peers.length
        ? (peers.length * rawCatMedian + prior * globalMedian) / (peers.length + prior)
        : globalMedian;
      const age =
        p.listed_at && Number.isFinite(Date.parse(p.listed_at))
          ? Math.max(0, Math.floor((Date.parse(snapshot.as_of) - Date.parse(p.listed_at)) / 86400000))
          : null;
      const growth = clamp(p.change_7d ?? 0, -50, 50);
      const momentum = 1 + growth / 200;
      const maturity = 0.75 + (0.25 * Math.min(age ?? 365, 730)) / 730;
      const breadth = 1 + 0.05 * Math.min(Math.max(p.chains.length - 1, 0), 4);
      const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * maturity * breadth));
      const confidence =
        peers.length >= 3 && p.change_7d !== null && age !== null && p.chains.length
          ? 'Higher'
          : peers.length && p.change_7d !== null && age !== null
            ? 'Medium'
            : 'Limited';
      return {
        ...p,
        watchlist: watch.has(p.slug),
        age_days: age,
        implied_value_usd: implied,
        confidence,
        model: { multiple, raw_category_median: rawCatMedian, global_median: globalMedian, peer_count: peers.length, growth, momentum, maturity, breadth },
        farm_steps: plan(p, age),
      };
    })
    .sort((a: any, b: any) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));

  rows.forEach((r: any, i: number) => {
    r.rank = i + 1;
  });

  const live = snapshot.protocols
    .filter((p: any) => !noToken(p) && !watch.has(p.slug))
    .map((p: any) => ({ ...p, implied_value_usd: p.mcap_usd > 0 ? p.mcap_usd : null }))
    .sort((a: any, b: any) => (b.mcap_usd || 0) - (a.mcap_usd || 0));

  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    watchlist_size: watch.size,
    model_defaults: MODEL_DEFAULTS,
    rows,
    live,
  };
}
