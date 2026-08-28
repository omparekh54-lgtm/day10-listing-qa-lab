export type Profile = 'amazon' | 'shopify' | 'social' | 'custom';
export type Severity = 'high' | 'medium' | 'low';
export type Confidence = 'Known' | 'Statistical estimate' | 'Heuristic';

export type Metrics = {
  width: number;
  height: number;
  meanLuma: number;
  darkClipPct: number;
  brightClipPct: number;
  blurVariance: number;
  backgroundStd: number;
  occupancyPct: number;
  clipped: boolean;
  colorCast: number;
  thumbnailContrast: number;
};

export type Issue = {
  code: string;
  title: string;
  detail: string;
  severity: Severity;
  confidence: Confidence;
};

export const profiles = {
  amazon: { label: 'Marketplace Main', minWidth: 1000, minHeight: 1000, minOccupancy: 62, maxOccupancy: 92, aspectTolerance: 0.18, whiteBgStd: 22 },
  shopify: { label: 'Storefront Product', minWidth: 900, minHeight: 900, minOccupancy: 52, maxOccupancy: 94, aspectTolerance: 0.35, whiteBgStd: 36 },
  social: { label: 'Social / Mobile', minWidth: 1080, minHeight: 1080, minOccupancy: 58, maxOccupancy: 95, aspectTolerance: 0.4, whiteBgStd: 55 },
  custom: { label: 'Custom QA', minWidth: 800, minHeight: 800, minOccupancy: 50, maxOccupancy: 95, aspectTolerance: 0.5, whiteBgStd: 60 }
} as const;

export function evaluateMetrics(metrics: Metrics, profile: Profile): Issue[] {
  const p = profiles[profile];
  const issues: Issue[] = [];
  const add = (issue: Issue) => issues.push(issue);
  if (metrics.width < p.minWidth || metrics.height < p.minHeight) add({ code:'resolution', title:'Resolution too low', detail:`${metrics.width}×${metrics.height}px; profile expects at least ${p.minWidth}×${p.minHeight}px.`, severity:'high', confidence:'Known' });
  const ratio = metrics.width / metrics.height;
  if (Math.abs(ratio - 1) > p.aspectTolerance) add({ code:'aspect', title:'Aspect ratio outside profile', detail:`Current ratio ${ratio.toFixed(2)}:1 may crop inconsistently across listing surfaces.`, severity:'medium', confidence:'Known' });
  if (metrics.blurVariance < 75) add({ code:'blur', title:'Image appears soft or blurry', detail:`Edge sharpness score ${metrics.blurVariance.toFixed(0)} is below the review threshold.`, severity:'high', confidence:'Statistical estimate' });
  if (metrics.meanLuma < 72 || metrics.darkClipPct > 8) add({ code:'dark', title:'Exposure is too dark', detail:`Mean luminance ${metrics.meanLuma.toFixed(0)}; ${(metrics.darkClipPct).toFixed(1)}% of pixels are near black.`, severity:'medium', confidence:'Statistical estimate' });
  if (metrics.meanLuma > 238 || metrics.brightClipPct > 24) add({ code:'bright', title:'Highlights may be blown out', detail:`Mean luminance ${metrics.meanLuma.toFixed(0)}; ${(metrics.brightClipPct).toFixed(1)}% of pixels are near white.`, severity:'medium', confidence:'Statistical estimate' });
  if (metrics.occupancyPct < p.minOccupancy) add({ code:'small-subject', title:'Product is too small in frame', detail:`Estimated subject occupancy is ${metrics.occupancyPct.toFixed(0)}%; target is at least ${p.minOccupancy}%.`, severity:'high', confidence:'Heuristic' });
  if (metrics.occupancyPct > p.maxOccupancy) add({ code:'large-subject', title:'Product is too tight in frame', detail:`Estimated subject occupancy is ${metrics.occupancyPct.toFixed(0)}%; this leaves little safe-crop margin.`, severity:'medium', confidence:'Heuristic' });
  if (metrics.clipped) add({ code:'clipped', title:'Subject may be clipped', detail:'Foreground estimate touches the image edge. Check packaging, caps, shadows and handles.', severity:'high', confidence:'Heuristic' });
  if (metrics.backgroundStd > p.whiteBgStd) add({ code:'background', title:'Background is inconsistent', detail:`Border variation score ${metrics.backgroundStd.toFixed(0)} exceeds this profile's tolerance.`, severity:'medium', confidence:'Statistical estimate' });
  if (metrics.colorCast > 28) add({ code:'cast', title:'Possible color cast', detail:`Channel imbalance score ${metrics.colorCast.toFixed(0)} suggests a strong overall tint.`, severity:'low', confidence:'Statistical estimate' });
  if (metrics.thumbnailContrast < 26) add({ code:'thumbnail', title:'Weak thumbnail separation', detail:'At small search-result size, the subject may merge into the background.', severity:'medium', confidence:'Heuristic' });
  return issues;
}

export function scoreIssues(issues: Issue[]): number {
  const penalty = issues.reduce((sum, issue) => sum + (issue.severity === 'high' ? 22 : issue.severity === 'medium' ? 11 : 5), 0);
  return Math.max(0, 100 - penalty);
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

export function parseSkuView(filename: string) {
  const stem = filename.replace(/\.[^.]+$/, '');
  const parts = stem.split(/[_\-]+/);
  const known = ['front','back','side','detail','packaging','pack','hero'];
  const idx = parts.findIndex(p => known.includes(p.toLowerCase()));
  if (idx < 0) return { sku: stem, view: 'unclassified' };
  const rawView = parts[idx].toLowerCase();
  const view = rawView === 'hero' ? 'front' : rawView === 'pack' ? 'packaging' : rawView;
  return { sku: parts.slice(0, idx).join('-') || stem, view };
}

export function missingViews(files: string[], required = ['front','back','detail']) {
  const grouped = new Map<string, Set<string>>();
  for (const f of files) {
    const { sku, view } = parseSkuView(f);
    if (!grouped.has(sku)) grouped.set(sku, new Set());
    grouped.get(sku)!.add(view);
  }
  return [...grouped.entries()].map(([sku, views]) => ({ sku, missing: required.filter(v => !views.has(v)), present:[...views] }));
}
