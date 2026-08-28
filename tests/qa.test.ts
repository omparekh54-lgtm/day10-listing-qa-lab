import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMetrics, hammingDistance, missingViews, parseSkuView, scoreIssues } from '../lib/qa';

const clean = {
  width: 1600, height: 1600, meanLuma: 180, darkClipPct: 1, brightClipPct: 8,
  blurVariance: 180, backgroundStd: 8, occupancyPct: 75, clipped: false,
  colorCast: 10, thumbnailContrast: 60
};

test('clean marketplace image passes without issues', () => {
  assert.equal(evaluateMetrics(clean, 'amazon').length, 0);
});

test('low-resolution blurry image receives high-severity findings', () => {
  const issues = evaluateMetrics({ ...clean, width: 600, height: 600, blurVariance: 30 }, 'amazon');
  assert.ok(issues.some(i => i.code === 'resolution' && i.severity === 'high'));
  assert.ok(issues.some(i => i.code === 'blur' && i.severity === 'high'));
  assert.ok(scoreIssues(issues) < 70);
});

test('subject occupancy and clipping are flagged independently', () => {
  const small = evaluateMetrics({ ...clean, occupancyPct: 30 }, 'amazon');
  const clipped = evaluateMetrics({ ...clean, clipped: true }, 'amazon');
  assert.ok(small.some(i => i.code === 'small-subject'));
  assert.ok(clipped.some(i => i.code === 'clipped'));
});

test('perceptual hash distance counts changed bits', () => {
  assert.equal(hammingDistance('101010', '101110'), 1);
  assert.equal(hammingDistance('101', '10'), Infinity);
});

test('filename convention identifies sku and listing view', () => {
  assert.deepEqual(parseSkuView('SKU-102_front.jpg'), { sku: 'SKU-102', view: 'front' });
});

test('listing completeness reports missing required views', () => {
  const result = missingViews(['A_front.jpg','A_back.jpg','B_front.jpg']);
  const a = result.find(x => x.sku === 'A');
  const b = result.find(x => x.sku === 'B');
  assert.deepEqual(a?.missing, ['detail']);
  assert.deepEqual(b?.missing, ['back','detail']);
});
