import test from "node:test";
import assert from "node:assert/strict";
import { pointsFromColones } from "../src/lib/points.js";

test("convierte ₡100 en un punto", () => {
  assert.equal(pointsFromColones(100), 1);
  assert.equal(pointsFromColones(10_000), 100);
  assert.equal(pointsFromColones(28_500), 285);
});

test("redondea hacia abajo y rechaza montos inválidos", () => {
  assert.equal(pointsFromColones(42_750), 427);
  assert.equal(pointsFromColones(-100), 0);
  assert.equal(pointsFromColones("no"), 0);
});

